import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { WORKSPACE_PLANS } from '../../../execution/workspaces/dto/workspaces.dto';
import type { CompPlan, PlanId } from '../entitlement-keys';

/**
 * Request shapes for the entitlements HTTP surface.
 *
 * These check SHAPE only. Whether a change fits its key's kind, respects a
 * floor, or names a key the database knows is decided by
 * EntitlementsAdminService against the live matrix, because the key registry
 * lives in the database and a DTO cannot see it.
 *
 * The global ValidationPipe runs whitelist + forbidNonWhitelisted with
 * implicit conversion, so every query number carries an explicit @Type.
 */

export const ADMIN_WORKSPACE_FILTERS = [
  'all',
  'comped',
  'paid',
  'free',
] as const;
export type AdminWorkspaceFilter = (typeof ADMIN_WORKSPACE_FILTERS)[number];

export const COMP_PLANS: readonly CompPlan[] = [
  'pro',
  'business',
  'enterprise',
];

export const PLAN_LIMIT_CHANGES_MAX = 200;
export const ADMIN_NOTE_MAX_LENGTH = 1000;
export const DISPLAY_LABEL_MAX_LENGTH = 40;
export const ADMIN_WORKSPACES_PAGE_SIZE_MAX = 100;
export const ADMIN_WORKSPACES_PAGE_SIZE_DEFAULT = 25;
/** Keeps page * page_size inside an int4 OFFSET. */
export const ADMIN_WORKSPACES_PAGE_MAX = 100_000;

/** Mirrors the plan_limit_keys_key_format CHECK. */
const LIMIT_KEY_PATTERN = /^[a-z][a-z0-9_]{1,62}$/;
const NOT_BLANK = /\S/;

/**
 * One cell edit. Omitted fields keep the cell's current value; `value: null`
 * means unlimited. Numeric kinds take `value`, features take `enabled`.
 */
export class PlanLimitChangeDto {
  @IsIn(WORKSPACE_PLANS)
  plan!: PlanId;

  @IsString()
  @Matches(LIMIT_KEY_PATTERN, { message: 'key is not a limit key' })
  key!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  value?: number | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  per_seat?: boolean;

  /** Marketing copy such as "Negotiated". An empty string clears it. */
  @IsOptional()
  @IsString()
  @MaxLength(DISPLAY_LABEL_MAX_LENGTH)
  display_label?: string | null;
}

export class UpdatePlanLimitsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PLAN_LIMIT_CHANGES_MAX)
  @ValidateNested({ each: true })
  @Type(() => PlanLimitChangeDto)
  changes!: PlanLimitChangeDto[];

  @IsOptional()
  @IsString()
  @MaxLength(ADMIN_NOTE_MAX_LENGTH)
  note?: string;

  /**
   * The `version` the editor loaded. A newer save in between answers 409
   * plan_limits_stale. Null or absent skips the check.
   */
  @IsOptional()
  @IsISO8601()
  base_version?: string | null;
}

export class AdminWorkspacesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(ADMIN_WORKSPACE_FILTERS)
  filter?: AdminWorkspaceFilter;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADMIN_WORKSPACES_PAGE_MAX)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADMIN_WORKSPACES_PAGE_SIZE_MAX)
  page_size?: number;
}

export class SetWorkspaceCompDto {
  @IsIn(COMP_PLANS)
  plan!: CompPlan;

  /** When the comp lapses. Null or absent means it never does. */
  @IsOptional()
  @IsISO8601()
  until?: string | null;

  /** Why. Lands in the admin audit log, never on the workspace row. */
  @IsString()
  @Length(1, ADMIN_NOTE_MAX_LENGTH)
  @Matches(NOT_BLANK, { message: 'note must not be blank' })
  note!: string;
}

/** DELETE /admin/workspaces/:id/comp accepts the note in the body or the query. */
export class ClearWorkspaceCompDto {
  @IsOptional()
  @IsString()
  @MaxLength(ADMIN_NOTE_MAX_LENGTH)
  note?: string;
}
