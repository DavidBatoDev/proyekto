import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  AvailabilityStatus,
  FluencyLevel,
  LicenseType,
  ProficiencyLevel,
  SpecializationCategory,
} from '../../../common/entities';

export class UpdateProfileBasicDto {
  @IsString() @IsOptional() @MaxLength(2000) bio?: string;
  @IsString() @IsOptional() @MaxLength(120) headline?: string;
  @ValidateIf((o) => !!o.phone_number)
  @Matches(/^\+[1-9]\d{1,14}$/, {
    message: 'Phone number must be in E.164 format (e.g. +639123456789)',
  })
  @IsOptional()
  phone_number?: string;
  @IsString() @IsOptional() country?: string;
  @IsString() @IsOptional() city?: string;
  @IsString() @IsOptional() zip_code?: string;
  @IsString() @IsOptional() gender?: string;
  @IsDateString() @IsOptional() date_of_birth?: string;
}

class ReplaceSkillItemDto {
  @IsString()
  skill_id: string;

  @IsEnum(['beginner', 'intermediate', 'advanced', 'expert'])
  @IsOptional()
  proficiency_level?: ProficiencyLevel;

  @IsInt()
  @Min(0)
  @IsOptional()
  years_experience?: number;
}

export class ReplaceSkillsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReplaceSkillItemDto)
  skills: ReplaceSkillItemDto[];
}

export class AddLanguageDto {
  @IsString() language_id: string;
  @IsEnum(['basic', 'conversational', 'fluent', 'native'])
  fluency_level: FluencyLevel;
}

export class UpdateLanguageDto {
  @IsEnum(['basic', 'conversational', 'fluent', 'native'])
  @IsOptional()
  fluency_level?: FluencyLevel;
}

export class AddEducationDto {
  @IsString() institution: string;
  @IsString() @IsOptional() degree?: string;
  @IsString() @IsOptional() field_of_study?: string;
  @IsNumber() @IsOptional() start_year?: number;
  @IsNumber() @IsOptional() end_year?: number;
  @IsBoolean() @IsOptional() is_current?: boolean;
  @IsString() @IsOptional() description?: string;
}

export class UpdateEducationDto {
  @IsString() @IsOptional() institution?: string;
  @IsString() @IsOptional() degree?: string;
  @IsString() @IsOptional() field_of_study?: string;
  @IsNumber() @IsOptional() start_year?: number;
  @IsNumber() @IsOptional() end_year?: number;
  @IsBoolean() @IsOptional() is_current?: boolean;
  @IsString() @IsOptional() description?: string;
}

export class AddCertificationDto {
  @IsString() name: string;
  @IsString() @IsOptional() issuer?: string;
  @IsDateString() @IsOptional() issue_date?: string;
  @IsDateString() @IsOptional() expiry_date?: string;
  @IsString() @IsOptional() credential_id?: string;
  @IsUrl() @IsOptional() credential_url?: string;
}

export class UpdateCertificationDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() issuer?: string;
  @IsDateString() @IsOptional() issue_date?: string;
  @IsDateString() @IsOptional() expiry_date?: string;
  @IsString() @IsOptional() credential_id?: string;
  @IsUrl() @IsOptional() credential_url?: string;
}

export class AddExperienceDto {
  @IsString() company: string;
  @IsString() title: string;
  @IsString() @IsOptional() location?: string;
  @IsBoolean() @IsOptional() is_remote?: boolean;
  @IsString() @IsOptional() description?: string;
  @IsDateString() start_date: string;
  @IsDateString() @IsOptional() end_date?: string;
  @IsBoolean() @IsOptional() is_current?: boolean;
}

export class UpdateExperienceDto {
  @IsString() @IsOptional() company?: string;
  @IsString() @IsOptional() title?: string;
  @IsString() @IsOptional() location?: string;
  @IsBoolean() @IsOptional() is_remote?: boolean;
  @IsString() @IsOptional() description?: string;
  @IsDateString() @IsOptional() start_date?: string;
  @IsDateString() @IsOptional() end_date?: string;
  @IsBoolean() @IsOptional() is_current?: boolean;
}

export class AddPortfolioDto {
  @IsString() title: string;
  @IsString() @IsOptional() description?: string;
  @IsUrl() @IsOptional() url?: string;
  @IsUrl() @IsOptional() image_url?: string;
  @IsOptional() tags?: string[];
  @IsNumber() @IsOptional() @Min(0) position?: number;
}

export class UpdatePortfolioDto {
  @IsString() @IsOptional() title?: string;
  @IsString() @IsOptional() description?: string;
  @IsUrl() @IsOptional() url?: string;
  @IsUrl() @IsOptional() image_url?: string;
  @IsOptional() tags?: string[];
  @IsNumber() @IsOptional() @Min(0) position?: number;
}

export class UpsertRateSettingsDto {
  @IsNumber() @IsOptional() @Min(0) hourly_rate?: number;
  @IsString() @IsOptional() currency?: string;
  @IsNumber() @IsOptional() @Min(0) min_project_budget?: number;
  @IsEnum(['available', 'partially_available', 'unavailable'])
  @IsOptional()
  availability?: AvailabilityStatus;
  @IsNumber() @IsOptional() @Min(0) weekly_hours?: number;
}

export class AddLicenseDto {
  @IsString() name: string;
  @IsEnum([
    'legal',
    'engineering',
    'medical',
    'financial',
    'real_estate',
    'other',
  ])
  type: LicenseType;
  @IsString() @IsOptional() issuing_authority?: string;
  @IsString() @IsOptional() license_number?: string;
  @IsDateString() @IsOptional() issue_date?: string;
  @IsDateString() @IsOptional() expiry_date?: string;
  @IsBoolean() @IsOptional() is_active?: boolean;
}

export class UpdateLicenseDto {
  @IsString() @IsOptional() name?: string;
  @IsEnum([
    'legal',
    'engineering',
    'medical',
    'financial',
    'real_estate',
    'other',
  ])
  @IsOptional()
  type?: LicenseType;
  @IsString() @IsOptional() issuing_authority?: string;
  @IsString() @IsOptional() license_number?: string;
  @IsDateString() @IsOptional() issue_date?: string;
  @IsDateString() @IsOptional() expiry_date?: string;
  @IsBoolean() @IsOptional() is_active?: boolean;
}

export class AddSpecializationDto {
  @IsEnum([
    'fintech',
    'healthcare',
    'e_commerce',
    'saas',
    'education',
    'real_estate',
    'legal',
    'marketing',
    'logistics',
    'media',
    'gaming',
    'ai_ml',
    'cybersecurity',
    'blockchain',
    'other',
  ])
  category: SpecializationCategory;
  @IsString() @IsOptional() sub_category?: string;
  @IsNumber() @IsOptional() years_of_experience?: number;
  @IsString() @IsOptional() description?: string;
}

export class UpdateSpecializationDto {
  @IsEnum([
    'fintech',
    'healthcare',
    'e_commerce',
    'saas',
    'education',
    'real_estate',
    'legal',
    'marketing',
    'logistics',
    'media',
    'gaming',
    'ai_ml',
    'cybersecurity',
    'blockchain',
    'other',
  ])
  @IsOptional()
  category?: SpecializationCategory;
  @IsString() @IsOptional() sub_category?: string;
  @IsNumber() @IsOptional() years_of_experience?: number;
  @IsString() @IsOptional() description?: string;
}

export class AddIdentityDocumentDto {
  @IsString() type: string;
  @IsString() storage_path: string;
  @IsDateString() @IsOptional() expires_at?: string;
}

export class PhoneVerificationConfirmDto {
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'Code must be a 6-digit number.' })
  code: string;
}
