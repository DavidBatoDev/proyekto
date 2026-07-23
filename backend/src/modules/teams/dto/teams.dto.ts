import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/**
 * A single payout cut-off period. Kept as a plain interface (not a validated
 * nested DTO) because `end_day` is a `number | 'EOM'` union that class-validator
 * models awkwardly; the whole config is validated field-by-field in
 * TeamsService.validatePayPeriodConfig instead.
 */
export interface PayPeriodInput {
  id: string;
  label: string;
  start_day: number;
  end_day: number | 'EOM';
  pay_day: number;
  pay_month_offset: number;
}

export interface PayPeriodConfigInput {
  cadence: 'monthly';
  periods: PayPeriodInput[];
}

export class CreateTeamDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsOptional()
  @IsString()
  avatar_url?: string;
}

export class UpdateTeamDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsOptional()
  @IsString()
  avatar_url?: string;

  @IsOptional()
  @IsBoolean()
  time_tracking_enabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  retroactive_log_days?: number;

  @IsOptional()
  @IsIn(['USD', 'CAD', 'PHP'])
  default_currency?: 'USD' | 'CAD' | 'PHP';

  // Payout cut-off schedule. `null` resets to the client default. The shape is
  // validated in TeamsService.validatePayPeriodConfig (see PayPeriodConfigInput).
  @IsOptional()
  @IsObject()
  pay_period_config?: PayPeriodConfigInput | null;
}

export const TEAM_MEMBER_ROLES = ['owner', 'admin', 'member'] as const;
export type TeamMemberRole = (typeof TEAM_MEMBER_ROLES)[number];

// Email-based invite DTOs (mirror project_invites). The
// AddTeamMemberDto below is retained for service-internal direct
// inserts only — no public endpoint accepts it anymore.
export class InviteTeamMemberDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsIn(TEAM_MEMBER_ROLES)
  role?: TeamMemberRole;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  position?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

export const TEAM_INVITE_RESPONSE_STATUSES = [
  'accepted',
  'declined',
] as const;
export type TeamInviteResponseStatus =
  (typeof TEAM_INVITE_RESPONSE_STATUSES)[number];

export class RespondTeamInviteDto {
  @IsIn(TEAM_INVITE_RESPONSE_STATUSES)
  status!: TeamInviteResponseStatus;
}

export class AddTeamMemberDto {
  @IsUUID()
  user_id!: string;

  @IsOptional()
  @IsIn(TEAM_MEMBER_ROLES)
  role?: TeamMemberRole;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  position?: string;
}

export class UpdateTeamMemberDto {
  @IsOptional()
  @IsIn(['admin', 'member'])
  role?: 'admin' | 'member';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  position?: string;
}

export class CreateTeamMemberRateDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  project_ids!: string[];

  @IsNumber()
  @Min(0)
  hourly_rate!: number;

  @IsNumber()
  @Min(0)
  training_hourly_rate!: number;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  custom_id?: string;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weekly_limit_hours?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  monthly_limit_hours?: number;

  @IsOptional()
  @IsBoolean()
  overtime_requires_approval?: boolean;
}

export class UpdateTeamMemberRateDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  hourly_rate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  training_hourly_rate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  custom_id?: string;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  // `null` clears the cap; a number sets it. ValidateIf lets null through the
  // @IsNumber check (the service maps `?? null`).
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(0)
  weekly_limit_hours?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(0)
  monthly_limit_hours?: number | null;

  @IsOptional()
  @IsBoolean()
  overtime_requires_approval?: boolean;
}

export class UpdateWorkspaceDefaultsDto {
  @IsOptional()
  @IsUUID()
  default_team_id?: string | null;

  @IsOptional()
  @IsUUID()
  default_project_id?: string | null;

  @IsOptional()
  @IsUUID()
  last_team_id?: string | null;
}

export const PROJECT_TEAM_DEFAULT_ROLES = [
  'admin',
  'editor',
  'commenter',
  'viewer',
] as const;
export type ProjectTeamDefaultRole =
  (typeof PROJECT_TEAM_DEFAULT_ROLES)[number];

export class AttachTeamMemberRoleDto {
  @IsUUID()
  user_id!: string;

  /**
   * Picked role for the new project_access row. Honored only when the
   * user has no existing grant on the project — when they do, the
   * existing role wins and this value is ignored. Optional because
   * the frontend omits it for already-on-project users.
   */
  @IsOptional()
  @IsIn(PROJECT_TEAM_DEFAULT_ROLES)
  role?: ProjectTeamDefaultRole;
}

export class AttachTeamDto {
  @IsUUID()
  team_id!: string;

  @IsOptional()
  @IsBoolean()
  is_primary?: boolean;

  /**
   * Per-member role pairs for the curated rows. The role is written to
   * the new project_access row for users without a prior grant; users
   * already on the project keep their existing yoked role and the role
   * here is ignored.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachTeamMemberRoleDto)
  members?: AttachTeamMemberRoleDto[];
}

export class UpdateProjectTeamDto {
  @IsOptional()
  @IsBoolean()
  is_primary?: boolean;
}

export class AddCuratedMemberDto {
  @IsUUID()
  user_id!: string;

  /** Role for new users. Ignored for users already on the project. */
  @IsOptional()
  @IsIn(PROJECT_TEAM_DEFAULT_ROLES)
  role?: ProjectTeamDefaultRole;
}
