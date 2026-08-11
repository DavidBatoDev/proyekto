import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  display_name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  bio?: string;

  @IsOptional()
  @IsUrl()
  avatar_url?: string;
}
