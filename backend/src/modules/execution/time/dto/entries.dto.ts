// dto/entries.dto.ts
import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsTimeZone,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type {
  FlaggedReason,
  LoggingForRequest,
  PresetWorkItem,
  WorkType,
} from '../time.types';
import { LOGGING_FOR_REF_PATTERN, LoggingForDto } from './logging-for.dto';

export interface StartEntryInput {
  project_id: string;
  task_id?: string | null;
  work_item?: PresetWorkItem;
  logging_for?: LoggingForRequest;
  remember?: boolean;
  work_type?: WorkType;
  note?: string | null;
}
export interface CreateEntryInput extends StartEntryInput {
  started_at: string;
  ended_at: string;
  break_seconds?: number;
  break_minutes?: number;
}
export interface UpdateEntryInput {
  task_id?: string | null;
  work_item?: PresetWorkItem;
  started_at?: string;
  ended_at?: string;
  break_seconds?: number;
  break_minutes?: number;
  note?: string | null;
  work_type?: WorkType;
  logging_for?: LoggingForRequest;
  expected_updated_at?: string;
}
export interface StopEntryOptions {
  endedAt?: string;
  breakMinutes?: number;
  flaggedReason?: FlaggedReason;
  /** System actor (cron / assignment end): skips the member check. */
  system?: boolean;
}

export class StartEntryDto implements StartEntryInput {
  @IsUUID() project_id!: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() task_id?:
    | string
    | null;
  @IsOptional()
  @IsIn(['meeting', 'review', 'admin', 'other'])
  work_item?: PresetWorkItem;
  @IsOptional()
  @ValidateNested()
  @Type(() => LoggingForDto)
  logging_for?: LoggingForDto;
  @IsOptional() @IsBoolean() remember?: boolean;
  @IsOptional() @IsIn(['real_work', 'training']) work_type?: WorkType;
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  note?: string | null;
} // service rejects task_id AND work_item together → 422 WORK_ITEM_INVALID

export class CreateEntryDto extends StartEntryDto implements CreateEntryInput {
  @IsISO8601() started_at!: string;
  @IsISO8601() ended_at!: string;
  @IsOptional() @IsInt() @Min(0) @Max(86400) break_seconds?: number;
  /** Deprecated; break_seconds wins when both are sent. */
  @IsOptional() @IsInt() @Min(0) @Max(1440) break_minutes?: number;
}

export class UpdateEntryDto implements UpdateEntryInput {
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() task_id?:
    | string
    | null;
  @IsOptional()
  @IsIn(['meeting', 'review', 'admin', 'other'])
  work_item?: PresetWorkItem;
  @IsOptional() @IsISO8601() started_at?: string;
  @IsOptional() @IsISO8601() ended_at?: string;
  @IsOptional() @IsInt() @Min(0) @Max(86400) break_seconds?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1440) break_minutes?: number;
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  note?: string | null;
  @IsOptional() @IsIn(['real_work', 'training']) work_type?: WorkType;
  @IsOptional()
  @ValidateNested()
  @Type(() => LoggingForDto)
  logging_for?: LoggingForDto;
  @IsISO8601() expected_updated_at!: string; // required on /api/time (D42)
}

/** The body must be empty or {}. The one never-sent sentinel field exists only so the class carries validation
 *  metadata: class-validator ≥ 0.14 defaults forbidUnknownValues to true, so a DTO class with no decorated field
 *  fails every request with "an unknown value was passed to the validate function". Any real field is refused
 *  by forbidNonWhitelisted. */
export class StopEntryDto {
  @IsOptional() @Equals(undefined) readonly _empty?: never;
}

export class CreateCommentDto {
  @IsString() @MinLength(1) @MaxLength(4000) body!: string;
}

export class ListMyEntriesQueryDto {
  @IsISO8601({ strict: true }) from!: string; // YYYY-MM-DD local
  @IsISO8601({ strict: true }) to!: string;
  @IsOptional() @IsUUID() project_id?: string;
  @IsOptional() @Matches(LOGGING_FOR_REF_PATTERN) for?: string;
  @IsOptional() @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @IsInt() @Min(1) @Max(200) limit?: number = 100;
}

export class MySummaryQueryDto {
  @IsISO8601({ strict: true }) from!: string;
  @IsISO8601({ strict: true }) to!: string;
}

export class OverviewQueryDto {
  @IsOptional() @IsTimeZone() tz?: string;
}
