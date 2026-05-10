import { Type } from 'class-transformer';
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
} from 'class-validator';

export const TIME_LOG_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type TimeLogStatus = (typeof TIME_LOG_STATUSES)[number];

export const TIME_LOG_REVIEW_DECISIONS = [
  'pending',
  'approved',
  'rejected',
] as const;
export type TimeLogReviewDecision =
  (typeof TIME_LOG_REVIEW_DECISIONS)[number];

export class StartTimeLogDto {
  @IsUUID()
  project_id!: string;

  @IsUUID()
  task_id!: string;
}

export class StopTimeLogDto {
  @IsOptional()
  @IsDateString()
  ended_at?: string;
}

export class UpdateTimeLogDto {
  @IsOptional()
  @IsUUID()
  task_id?: string;

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

  @IsUUID()
  task_id!: string;

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
