import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export const TIME_LOG_STATUSES = [
  'pending',
  'approved',
  'paid',
  'rejected',
] as const;
export type TimeLogStatus = (typeof TIME_LOG_STATUSES)[number];

export const TIME_LOG_REVIEW_DECISIONS = [
  'pending',
  'approved',
  'paid',
  'rejected',
] as const;
export type TimeLogReviewDecision =
  (typeof TIME_LOG_REVIEW_DECISIONS)[number];

const normalizeNullableTaskId = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === 'null' || lower === 'undefined') return null;
  return trimmed;
};

export class StartTimeLogDto {
  @IsUUID()
  project_id!: string;

  @Transform(normalizeNullableTaskId)
  @ValidateIf((_, value) => value !== '' && value !== null && value !== undefined)
  @IsOptional()
  @IsUUID()
  task_id?: string | null;
}

export class StopTimeLogDto {
  @IsOptional()
  @IsDateString()
  ended_at?: string;
}

export class UpdateTimeLogDto {
  @Transform(normalizeNullableTaskId)
  @ValidateIf((_, value) => value !== '' && value !== null && value !== undefined)
  @IsOptional()
  @IsUUID()
  task_id?: string | null;

  @IsOptional()
  @IsDateString()
  started_at?: string;

  @IsOptional()
  @IsDateString()
  ended_at?: string;
}

export class CreateManualTimeLogDto {
  @IsUUID()
  project_id!: string;

  @Transform(normalizeNullableTaskId)
  @ValidateIf((_, value) => value !== '' && value !== null && value !== undefined)
  @IsOptional()
  @IsUUID()
  task_id?: string | null;

  @IsDateString()
  started_at!: string;

  @IsDateString()
  ended_at!: string;
}

export class ReviewTimeLogDto {
  @IsIn(TIME_LOG_REVIEW_DECISIONS)
  decision!: TimeLogReviewDecision;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class ReviewTimeLogsBulkDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  log_ids!: string[];

  @IsIn(TIME_LOG_REVIEW_DECISIONS)
  decision!: TimeLogReviewDecision;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class ListLogsQueryDto {
  @IsOptional()
  @IsIn(TIME_LOG_STATUSES)
  status?: TimeLogStatus;

  @IsOptional()
  @IsUUID()
  project_id?: string;

  @IsOptional()
  @IsUUID()
  member_user_id?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
