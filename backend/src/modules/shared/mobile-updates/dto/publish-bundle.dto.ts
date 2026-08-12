import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export type BundlePlatform = 'android' | 'ios';

export class PresignBundleDto {
  @IsIn(['android', 'ios'])
  platform: BundlePlatform;

  @IsString()
  @MaxLength(64)
  version: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  channel?: string;
}

export class RegisterBundleDto {
  @IsIn(['android', 'ios'])
  platform: BundlePlatform;

  @IsString()
  @MaxLength(64)
  version: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  channel?: string;

  @IsInt()
  @Min(1)
  @Max(2_000_000_000)
  native_build_min: number;

  @IsString()
  @MaxLength(512)
  r2_key: string;

  @IsString()
  @MaxLength(2048)
  url: string;

  @Matches(/^[a-f0-9]{64}$/, {
    message: 'checksum must be lowercase sha256 hex',
  })
  checksum: string;

  @IsInt()
  @Min(0)
  size_bytes: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  changelog?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  created_by?: string;
}
