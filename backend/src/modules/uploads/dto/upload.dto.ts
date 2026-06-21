import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

type BucketName =
  | 'avatars'
  | 'banners'
  | 'project_banners'
  | 'portfolio_projects'
  | 'identity_documents'
  | 'roadmap_previews'
  | 'task_attachments';

export class SignedUrlDto {
  @IsEnum([
    'avatars',
    'banners',
    'project_banners',
    'portfolio_projects',
    'identity_documents',
    'roadmap_previews',
    'task_attachments',
  ])
  bucket: BucketName;

  @IsString() fileName: string;
  @IsString() fileType: string;
  @IsNumber() @Min(1) @Max(20 * 1024 * 1024) fileSize: number;
}

export class ConfirmAvatarDto {
  @IsString() avatar_url: string;
}

export class ConfirmBannerDto {
  @IsString() banner_url: string;
}

export class ConfirmProjectBannerDto {
  @IsString() project_id: string;
  @IsString() banner_url: string;
}
