import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export type DevicePlatform = 'ios' | 'android' | 'web';

export class RegisterDeviceTokenDto {
  @IsString()
  @MaxLength(4096)
  token: string;

  @IsIn(['ios', 'android', 'web'])
  platform: DevicePlatform;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  device_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  app_version?: string;
}

export class UnregisterDeviceTokenDto {
  @IsString()
  @MaxLength(4096)
  token: string;
}
