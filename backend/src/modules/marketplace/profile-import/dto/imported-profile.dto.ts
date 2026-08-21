import { Type } from 'class-transformer';
import { FLUENCY_LEVELS, PROFICIENCY_LEVELS } from '../lib/profile-enums';
import type { FluencyLevel, ProficiencyLevel } from '../lib/profile-enums';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * The shared contract between the two extraction routes and the wizard.
 *
 * Both the deterministic LinkedIn parser and the LLM CV extractor emit exactly
 * this shape, so step 2 of the go-live wizard renders the same form regardless
 * of where the data came from — and a future third source (an uploaded JSON
 * resume, say) only has to produce this.
 *
 * Deliberately NOT the database shape. Skills and languages travel as NAMES,
 * not ids: `user_skills.skill_id` and `user_languages.language_id` are FKs whose
 * uuids are not stable across environments, and the skill may not exist yet at
 * all. Resolution happens once, inside `import_talent_profile`.
 */

export {
  FLUENCY_LEVELS,
  PROFICIENCY_LEVELS,
  type FluencyLevel,
  type ProficiencyLevel,
} from '../lib/profile-enums';

export class ImportedBasicsDto {
  @IsString() @IsOptional() @MaxLength(200) display_name?: string;
  /** Capped at 120 to match UpdateProfileBasicDto and the `headline` column. */
  @IsString() @IsOptional() @MaxLength(120) headline?: string;
  @IsString() @IsOptional() @MaxLength(2000) bio?: string;
  @IsString() @IsOptional() @MaxLength(100) country?: string;
  @IsString() @IsOptional() @MaxLength(100) city?: string;
}

export class ImportedSkillDto {
  @IsString() @MaxLength(120) name!: string;
  @IsIn(PROFICIENCY_LEVELS) @IsOptional() proficiency_level?: ProficiencyLevel;
  @IsInt() @Min(0) @Max(70) @IsOptional() years_experience?: number;
}

export class ImportedLanguageDto {
  @IsString() @MaxLength(80) name!: string;
  @IsIn(FLUENCY_LEVELS) @IsOptional() fluency_level?: FluencyLevel;
}

export class ImportedExperienceDto {
  @IsString() @MaxLength(200) company!: string;
  @IsString() @MaxLength(200) title!: string;
  @IsString() @IsOptional() @MaxLength(200) location?: string;
  @IsBoolean() @IsOptional() is_remote?: boolean;
  @IsString() @IsOptional() @MaxLength(5000) description?: string;
  /**
   * ISO `YYYY-MM-DD`. LinkedIn only ever gives month + year, so the parser
   * synthesises day 01 — `user_experiences.start_date` is DATE NOT NULL and
   * has nowhere to record that the day is unknown.
   */
  @IsString() start_date!: string;
  @IsString() @IsOptional() end_date?: string;
  @IsBoolean() @IsOptional() is_current?: boolean;
}

export class ImportedEducationDto {
  @IsString() @MaxLength(200) institution!: string;
  @IsString() @IsOptional() @MaxLength(200) degree?: string;
  @IsString() @IsOptional() @MaxLength(200) field_of_study?: string;
  @IsInt() @Min(1900) @Max(2100) @IsOptional() start_year?: number;
  @IsInt() @Min(1900) @Max(2100) @IsOptional() end_year?: number;
  @IsBoolean() @IsOptional() is_current?: boolean;
  @IsString() @IsOptional() @MaxLength(2000) description?: string;
}

export class ImportedCertificationDto {
  @IsString() @MaxLength(300) name!: string;
  /** Optional in every sense: the column is nullable as of 20260820100000. */
  @IsString() @IsOptional() @MaxLength(200) issuer?: string;
  @IsString() @IsOptional() issue_date?: string;
  @IsString() @IsOptional() expiry_date?: string;
  @IsString() @IsOptional() @MaxLength(200) credential_id?: string;
  @IsString() @IsOptional() @MaxLength(500) credential_url?: string;
}

export class ImportedSpecializationDto {
  @IsString() @IsOptional() category?: string;
  @IsString() @IsOptional() @MaxLength(200) sub_category?: string;
  @IsInt() @Min(0) @Max(70) @IsOptional() years_of_experience?: number;
}

export class ImportedProfileDto {
  @IsIn(['linkedin_pdf', 'cv_llm', 'manual']) @IsOptional() source?: string;

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => ImportedBasicsDto)
  basics?: ImportedBasicsDto;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ImportedSkillDto)
  skills?: ImportedSkillDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ImportedLanguageDto)
  languages?: ImportedLanguageDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ImportedExperienceDto)
  experiences?: ImportedExperienceDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ImportedEducationDto)
  educations?: ImportedEducationDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ImportedCertificationDto)
  certifications?: ImportedCertificationDto[];

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => ImportedSpecializationDto)
  specialization?: ImportedSpecializationDto;

  /** Contact URLs found in the document — portfolio-link candidates. */
  @IsArray() @IsString({ each: true }) @IsOptional() links?: string[];

  /**
   * What could not be parsed. Surfaced to the user rather than swallowed, so a
   * partial extraction reads as partial instead of as complete-but-wrong.
   * Response-only; ignored on the way in.
   */
  @IsArray() @IsString({ each: true }) @IsOptional() warnings?: string[];
}
