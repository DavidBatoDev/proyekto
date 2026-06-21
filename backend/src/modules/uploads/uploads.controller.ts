import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { R2_CLIENT, R2_CONFIG, type R2Config } from '../../config/r2.module';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import {
  ConfirmAvatarDto,
  ConfirmBannerDto,
  ConfirmProjectBannerDto,
  SignedUrlDto,
} from './dto/upload.dto';

const BUCKET_CONFIG: Record<
  string,
  { maxSize: number; allowedTypes: string[] }
> = {
  avatars: {
    maxSize: 5 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  },
  banners: {
    maxSize: 10 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  project_banners: {
    maxSize: 10 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  portfolio_projects: {
    maxSize: 20 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  },
  identity_documents: {
    maxSize: 10 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  },
  roadmap_previews: {
    maxSize: 10 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  task_attachments: {
    maxSize: 5 * 1024 * 1024,
    allowedTypes: [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'text/csv',
      'application/zip',
      'application/octet-stream',
    ],
  },
};

/** Buckets that must NOT be publicly readable — uploaded to the private R2 bucket. */
const PRIVATE_BUCKETS = new Set<string>(['identity_documents']);

/** Presigned upload URLs are valid for 10 minutes. */
const SIGNED_UPLOAD_TTL_SECONDS = 600;

@Injectable()
export class UploadsService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    @Inject(R2_CLIENT) private readonly r2: S3Client,
    @Inject(R2_CONFIG) private readonly r2Config: R2Config,
  ) {}

  async createSignedUrl(userId: string, dto: SignedUrlDto) {
    const config = BUCKET_CONFIG[dto.bucket];
    if (!config) throw new BadRequestException('Invalid bucket');

    if (dto.fileSize > config.maxSize) {
      throw new BadRequestException(
        `File too large. Max size for ${dto.bucket} is ${config.maxSize / 1024 / 1024}MB`,
      );
    }

    if (!config.allowedTypes.includes(dto.fileType)) {
      throw new BadRequestException(
        `Invalid file type. Allowed: ${config.allowedTypes.join(', ')}`,
      );
    }

    const ext = dto.fileName.split('.').pop();
    // Keep the old bucket name as the R2 key prefix so existing public URLs map
    // to `${publicBaseUrl}/${bucket}/...` with a single host rewrite.
    const key = `${dto.bucket}/${userId}/${Date.now()}.${ext}`;
    const isPrivate = PRIVATE_BUCKETS.has(dto.bucket);
    const bucket = isPrivate
      ? this.r2Config.privateBucket
      : this.r2Config.publicBucket;

    // Presigned PUT — the browser uploads the bytes directly to R2. ContentType
    // is signed, so the client must send a matching Content-Type header (it does).
    const signedUrl = await getSignedUrl(
      this.r2,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: dto.fileType,
      }),
      { expiresIn: SIGNED_UPLOAD_TTL_SECONDS },
    );

    // Public buckets resolve over the custom domain; private buckets have no
    // public URL, so we return the bare key (reads use a presigned GET later).
    const publicUrl = isPrivate
      ? key
      : `${this.r2Config.publicBaseUrl}/${key}`;

    return {
      signedUrl,
      path: key,
      publicUrl,
    };
  }

  async confirmAvatar(userId: string, dto: ConfirmAvatarDto) {
    const { data, error } = await this.supabase
      .from('profiles')
      .update({ avatar_url: dto.avatar_url })
      .eq('id', userId)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async confirmBanner(userId: string, dto: ConfirmBannerDto) {
    const { data, error } = await this.supabase
      .from('profiles')
      .update({ banner_url: dto.banner_url })
      .eq('id', userId)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateProjectBanner(userId: string, dto: ConfirmProjectBannerDto) {
    // Verify the user is the client or consultant on this project
    const { data: project, error: projectError } = await this.supabase
      .from('projects')
      .select('id, client_id, consultant_id')
      .eq('id', dto.project_id)
      .single();

    if (projectError || !project) {
      throw new BadRequestException('Project not found');
    }

    const p = project as {
      id: string;
      client_id: string;
      consultant_id: string | null;
    };

    // Slice 3b: project_shares is the source of truth for project authz.
    // Banner edits require admin+ role.
    let canEdit = false;
    const { data: share } = await this.supabase
      .from('project_access')
      .select('role')
      .eq('project_id', dto.project_id)
      .eq('user_id', userId)
      .maybeSingle();

    if (share) {
      const role = (share as { role: string }).role;
      canEdit = role === 'owner' || role === 'admin';
    }

    if (!canEdit) {
      throw new BadRequestException(
        'You do not have permission to update this project banner',
      );
    }

    const { data, error } = await this.supabase
      .from('projects')
      .update({ banner_url: dto.banner_url })
      .eq('id', dto.project_id)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async deleteAvatar(userId: string) {
    const { data: profile } = await this.supabase
      .from('profiles')
      .select('avatar_url')
      .eq('id', userId)
      .single();

    const avatarUrl = (profile as Record<string, string> | null)?.avatar_url;
    if (avatarUrl) {
      // Derive the R2 object key from the stored URL. Works for both the new
      // custom-domain URLs (`${publicBaseUrl}/avatars/...`) and any legacy
      // Supabase URLs (`.../object/public/avatars/...`) by slicing from the
      // `avatars/` prefix. Best-effort: skip if the marker isn't present.
      const idx = avatarUrl.indexOf('avatars/');
      if (idx !== -1) {
        const key = avatarUrl.slice(idx);
        await this.r2.send(
          new DeleteObjectCommand({
            Bucket: this.r2Config.publicBucket,
            Key: key,
          }),
        );
      }
    }

    const { data, error } = await this.supabase
      .from('profiles')
      .update({ avatar_url: null })
      .eq('id', userId)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }
}

@Controller('uploads')
@UseGuards(SupabaseAuthGuard)
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('signed-url')
  createSignedUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SignedUrlDto,
  ) {
    return this.uploadsService.createSignedUrl(user.id, dto);
  }

  @Post('confirm-avatar')
  confirmAvatar(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmAvatarDto,
  ) {
    return this.uploadsService.confirmAvatar(user.id, dto);
  }

  @Post('confirm-banner')
  confirmBanner(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmBannerDto,
  ) {
    return this.uploadsService.confirmBanner(user.id, dto);
  }

  @Post('confirm-project-banner')
  confirmProjectBanner(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmProjectBannerDto,
  ) {
    return this.uploadsService.updateProjectBanner(user.id, dto);
  }

  @Delete('avatar')
  @HttpCode(HttpStatus.OK)
  deleteAvatar(@CurrentUser() user: AuthenticatedUser) {
    return this.uploadsService.deleteAvatar(user.id);
  }
}
