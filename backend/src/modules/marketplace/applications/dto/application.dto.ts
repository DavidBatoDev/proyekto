import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateApplicationDto {
  @IsString() @IsOptional() @MaxLength(2000) cover_letter?: string;
  @IsOptional() years_of_experience?: number;
  @IsString() @IsOptional() primary_niche?: string;
  @IsString() @IsOptional() linkedin_url?: string;
  @IsString() @IsOptional() website_url?: string;
  @IsString() @IsOptional() @MaxLength(2000) why_join?: string;
}
