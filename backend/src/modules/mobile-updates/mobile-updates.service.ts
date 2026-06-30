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
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { R2_CLIENT, R2_CONFIG, type R2Config } from '../../config/r2.module';
import type {
  CapgoCheckBody,
  CapgoStatsBody,
  CheckResult,
} from './dto/capgo.types';
import { PresignBundleDto, RegisterBundleDto } from './dto/publish-bundle.dto';

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
