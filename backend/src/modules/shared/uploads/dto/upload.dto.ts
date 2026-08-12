import { IsString } from 'class-validator';

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
