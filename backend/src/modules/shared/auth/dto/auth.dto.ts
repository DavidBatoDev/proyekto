import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CompleteOnboardingDto {
  /**
   * Legacy compatibility only. Older web/mobile bundles still send a signup
   * lane; the global ValidationPipe runs forbidNonWhitelisted, so the field
   * must stay declared or those clients 400. The value is ignored — onboarding
   * no longer records a role or lane.
   */
  @IsOptional()
  @IsIn(['client', 'talent', 'consultant', 'client_freelancer'])
  lane?: string;

  /** Legacy compatibility only (client_freelancer intent). Ignored. */
  @IsOptional()
  @IsObject()
  intent?: Record<string, unknown>;
}

export class UpdateProfileDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  display_name?: string;

  @IsString()
  @IsOptional()
  avatar_url?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  bio?: string;
}
