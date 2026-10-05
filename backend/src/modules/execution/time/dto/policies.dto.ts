// dto/policies.dto.ts
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsTimeZone,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import type { PeriodKind, PresetWorkItem } from '../time.types';

export interface WorkspaceTimePolicyInput {
  tracking_enabled?: boolean;
  period_kind?: PeriodKind;
  week_start?: number;
  timezone?: string;
  period_anchor?: string | null;
  approval_required?: boolean;
  allow_manual_entries?: boolean;
  retroactive_days?: number | null;
  rounding_minutes?: number;
  weekly_limit_minutes?: number | null;
  reminder_days?: number;
  hidden_presets?: PresetWorkItem[];
  confirm?: boolean;
}

export class WorkspaceTimePolicyDto implements WorkspaceTimePolicyInput {
  @IsOptional() @IsBoolean() tracking_enabled?: boolean;
  @IsOptional()
  @IsIn(['weekly', 'biweekly', 'semi_monthly', 'monthly'])
  period_kind?: PeriodKind;
  @IsOptional() @IsInt() @Min(1) @Max(7) week_start?: number;
  @IsOptional() @IsTimeZone() timezone?: string;
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsISO8601({ strict: true })
  period_anchor?: string | null;
  @IsOptional() @IsBoolean() approval_required?: boolean;
  @IsOptional() @IsBoolean() allow_manual_entries?: boolean;
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(3650)
  retroactive_days?: number | null;
  @IsOptional() @IsIn([0, 5, 6, 10, 15, 30]) rounding_minutes?: number;
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  weekly_limit_minutes?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(14) reminder_days?: number;
  @IsOptional()
  @IsArray()
  @IsIn(['meeting', 'review', 'admin', 'other'], { each: true })
  hidden_presets?: PresetWorkItem[];
  /** "Looks right": stamps updated_by without changing values. */
  @IsOptional() @IsBoolean() confirm?: boolean;
}

export interface TeamTimePolicyInput {
  period_kind?: PeriodKind | null;
  week_start?: number | null;
  timezone?: string | null;
  period_anchor?: string | null;
  approval_required?: boolean | null;
  approver_scope?: 'team' | null;
  allow_manual_entries?: boolean | null;
  retroactive_days?: number | null;
  rounding_minutes?: number | null;
  weekly_limit_minutes?: number | null;
  reminder_days?: number | null;
}

/** Every field: @IsOptional() @ValidateIf(v !== null) + the workspace validator for the same field (null =
 *  inherit); approver_scope: @IsIn(['team']). No tracking_enabled, hidden_presets. */
export class TeamTimePolicyDto implements TeamTimePolicyInput {
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsIn(['weekly', 'biweekly', 'semi_monthly', 'monthly'])
  period_kind?: PeriodKind | null;
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(7)
  week_start?: number | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsTimeZone() timezone?:
    | string
    | null;
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsISO8601({ strict: true })
  period_anchor?: string | null;
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsBoolean()
  approval_required?: boolean | null;
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsIn(['team'])
  approver_scope?: 'team' | null;
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsBoolean()
  allow_manual_entries?: boolean | null;
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(3650)
  retroactive_days?: number | null;
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsIn([0, 5, 6, 10, 15, 30])
  rounding_minutes?: number | null;
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  weekly_limit_minutes?: number | null;
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(14)
  reminder_days?: number | null;
}
