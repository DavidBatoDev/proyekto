import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  REPORT_REASONS,
  REPORT_TARGET_TYPES,
  type ReportReason,
  type ReportTargetType,
} from '../safety.tokens';

export class CreateReportDto {
  @IsIn(REPORT_TARGET_TYPES)
  target_type!: ReportTargetType;

  @IsUUID()
  target_id!: string;

  @IsIn(REPORT_REASONS)
  reason!: ReportReason;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;

  /** Block the author in the same step. */
  @IsOptional()
  @IsBoolean()
  also_block?: boolean;
}

export class BlockUserDto {
  @IsUUID()
  user_id!: string;
}
