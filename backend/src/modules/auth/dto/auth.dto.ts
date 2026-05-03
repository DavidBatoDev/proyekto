import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OnboardingDto {
  @IsEnum(['client', 'freelancer'])
  active_persona: 'client' | 'freelancer';

  @IsString()
  @MaxLength(100)
  display_name: string;
}

class CompleteOnboardingIntentDto {
  @IsBoolean()
  freelancer: boolean;

  @IsBoolean()
  client: boolean;
}

export type OnboardingLane = 'client_freelancer' | 'consultant';

export class CompleteOnboardingDto {
  @IsEnum(['client_freelancer', 'consultant'])
  lane: OnboardingLane;

  @IsObject()
  @ValidateNested()
  @Type(() => CompleteOnboardingIntentDto)
  intent: CompleteOnboardingIntentDto;
}

export class SwitchPersonaDto {
  @IsEnum(['client', 'freelancer', 'consultant'])
  persona: 'client' | 'freelancer' | 'consultant';
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
