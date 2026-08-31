import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { R2_CLIENT, R2_CONFIG, type R2Config } from '../../../config/r2.module';
import type {
  CapgoCheckBody,
  CapgoStatsBody,
  CheckResult,
} from './dto/capgo.types';
import { PresignBundleDto, RegisterBundleDto } from './dto/publish-bundle.dto';
import {
  NO_UPDATE_REQUIRED,
  type RequirementQuery,
  type RequirementResult,
} from './dto/requirements.types';

const NO_UPDATE: CheckResult = {
  error: 'no_new_version_available',
  message: 'up to date',
};

const PRESIGN_EXPIRY_SECONDS = 900;

@Injectable()
export class MobileUpdatesService {
  private readonly logger = new Logger(MobileUpdatesService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    @Inject(R2_CLIENT) private readonly r2: S3Client,
    @Inject(R2_CONFIG) private readonly r2Config: R2Config,
  ) {}

  /**
   * Capgo update-check. Returns the latest published, native-compatible bundle
   * for the device's platform/channel, or a no-update sentinel. Never throws —
   * any bad input resolves to "no update" so a malformed check can't break the
   * device's update loop.
   */
  async resolveUpdate(body: CapgoCheckBody): Promise<CheckResult> {
    const platform =
      body.platform === 'ios'
        ? 'ios'
        : body.platform === 'android'
          ? 'android'
          : null;
    const channel =
      typeof body.defaultChannel === 'string' && body.defaultChannel.trim()
        ? body.defaultChannel.trim()
        : 'production';
    const nativeBuild = Number.parseInt(String(body.version_build ?? ''), 10);
    const activeVersion =
      typeof body.version_name === 'string' ? body.version_name : '';

    if (!platform || Number.isNaN(nativeBuild)) {
      return NO_UPDATE;
    }

    const { data, error } = await this.supabase
      .from('mobile_app_bundles')
      .select('version, url, checksum')
      .eq('platform', platform)
      .eq('channel', channel)
      .eq('status', 'published')
      .lte('native_build_min', nativeBuild) // native-compat guard
      .order('created_at', { ascending: false }) // monotonic, no-downgrade
      .limit(1)
      .maybeSingle();

    if (error) {
      this.logger.warn(`resolveUpdate query failed: ${error.message}`);
      return NO_UPDATE;
    }

    if (!data || data.version === activeVersion) {
      return NO_UPDATE;
    }

    return {
      version: data.version as string,
      url: data.url as string,
      checksum: data.checksum as string,
    };
  }

  /**
   * Native-shell update gate. Answers "is the app itself too old?", which the
   * Capgo check deliberately cannot: `resolveUpdate` silently filters shells
   * below a bundle's `native_build_min`, so those devices stop receiving OTA
   * updates with no signal. This is that signal.
   *
   * Fails open in every failure mode. A blocking dialog is the most damaging
   * thing this service can produce, so an unknown platform, an unparseable
   * build, a missing row or a dead query all resolve to "ok".
   */
  async resolveRequirement(
    query: RequirementQuery,
  ): Promise<RequirementResult> {
    const platform =
      query.platform === 'ios'
        ? 'ios'
        : query.platform === 'android'
          ? 'android'
          : null;
    const channel =
      typeof query.channel === 'string' && query.channel.trim()
        ? query.channel.trim()
        : 'production';
    const build = Number.parseInt(String(query.build ?? ''), 10);

    if (!platform || Number.isNaN(build)) {
      return NO_UPDATE_REQUIRED;
    }

    const { data, error } = await this.supabase
      .from('mobile_app_requirements')
      .select(
        'min_supported_build, latest_build, latest_version, store_url, message',
      )
      .eq('platform', platform)
      .eq('channel', channel)
      .maybeSingle();

    if (error) {
      this.logger.warn(`resolveRequirement query failed: ${error.message}`);
      return NO_UPDATE_REQUIRED;
    }

    if (!data) return NO_UPDATE_REQUIRED;

    const minSupported = Number(data.min_supported_build);
    const latestBuild = Number(data.latest_build);
    const storeUrl = typeof data.store_url === 'string' ? data.store_url : '';

    // Without somewhere to send the user, a prompt is a dead end — say "ok".
    if (!storeUrl) return NO_UPDATE_REQUIRED;

    const status: RequirementResult['status'] =
      build < minSupported
        ? 'required'
        : build < latestBuild
          ? 'optional'
          : 'ok';

    return {
      status,
      latestVersion: (data.latest_version as string) ?? null,
      latestBuild: Number.isFinite(latestBuild) ? latestBuild : null,
      storeUrl,
      message: (data.message as string | null) ?? null,
    };
  }

  /** Capgo stats sink — fire-and-forget log only (never touch the DB here). */
  recordStat(body: CapgoStatsBody): void {
    this.logger.log(
      `ota-stat platform=${body.platform ?? '?'} action=${body.action ?? '?'} version=${body.version ?? body.version_name ?? '?'}`,
    );
  }

  /**
   * Presign a direct R2 PUT so CI uploads the bundle zip without holding R2
   * credentials and without routing the bytes through Cloud Run (32 MB cap).
   */
  async presign(dto: PresignBundleDto): Promise<{
    key: string;
    uploadUrl: string;
    downloadUrl: string;
  }> {
    const channel = dto.channel?.trim() || 'production';
    const key = `mobile-bundles/${dto.platform}/${channel}/${dto.version}.zip`;

    const uploadUrl = await getSignedUrl(
      this.r2,
      new PutObjectCommand({
        Bucket: this.r2Config.publicBucket,
        Key: key,
        ContentType: 'application/zip',
      }),
      { expiresIn: PRESIGN_EXPIRY_SECONDS },
    );

    return {
      key,
      uploadUrl,
      downloadUrl: `${this.r2Config.publicBaseUrl}/${key}`,
    };
  }

  /** Register a published bundle's metadata (called by CI after the R2 PUT). */
  async register(dto: RegisterBundleDto) {
    const channel = dto.channel?.trim() || 'production';

    const { data, error } = await this.supabase
      .from('mobile_app_bundles')
      .insert({
        platform: dto.platform,
        channel,
        version: dto.version,
        native_build_min: dto.native_build_min,
        r2_key: dto.r2_key,
        url: dto.url,
        checksum: dto.checksum,
        size_bytes: dto.size_bytes,
        changelog: dto.changelog ?? null,
        created_by: dto.created_by ?? null,
        status: 'published',
      })
      .select('id, platform, channel, version, native_build_min')
      .single();

    if (error) {
      // 23505 = unique_violation (same platform+channel+version already exists)
      if (error.code === '23505') {
        throw new ConflictException(
          `Bundle ${dto.platform}/${channel}/${dto.version} already exists.`,
        );
      }
      throw new BadRequestException(error.message);
    }

    return data;
  }
}
