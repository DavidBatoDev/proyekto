import {
  IsBoolean,
  IsDefined,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class LegacyOnboardingIntentDto {
  @IsBoolean()
  freelancer: boolean;

  @IsBoolean()
  client: boolean;
}

export type OnboardingLane =
  | 'client'
  | 'talent'
  | 'consultant'
  | 'client_freelancer';

export class CompleteOnboardingDto {
  @IsEnum(['client', 'talent', 'consultant', 'client_freelancer'])
  lane: OnboardingLane;

  @ValidateIf((dto: CompleteOnboardingDto) => dto.lane === 'client_freelancer')
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => LegacyOnboardingIntentDto)
  intent?: LegacyOnboardingIntentDto;
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
