import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export const ENGAGEMENT_KINDS = ['client_services', 'talent_services'] as const;
export const ENGAGEMENT_STATUSES = ['active', 'ended', 'cancelled'] as const;

export type EngagementKind = (typeof ENGAGEMENT_KINDS)[number];
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];

export class EngagementListQueryDto {
  @IsOptional()
  @IsIn(ENGAGEMENT_KINDS)
  kind?: EngagementKind;

  @IsOptional()
  @IsIn(ENGAGEMENT_STATUSES)
  status?: EngagementStatus;

  /** Narrow to engagements linked to one project. */
  @IsOptional()
  @IsUUID()
  project_id?: string;
}

/**
 * Put a signed client engagement to work: create a project under the team the
 * contract was signed for, or link one the consultant already owns.
 */
export class SetUpEngagementProjectDto {
  @IsIn(['create', 'link'])
  mode!: 'create' | 'link';

  /** create: the new project's name. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  /** create: defaults to the contract's currency. */
  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @IsOptional()
  @IsUUID()
  workspace_id?: string;

  /** link: a project the caller owns. */
  @IsOptional()
  @IsUUID()
  project_id?: string;

  /**
   * Only for contracts signed before seats carried a team: which of the
   * caller's own teams the project lands under.
   */
  @IsOptional()
  @IsUUID()
  team_id?: string;
}

/**
 * Put a worker on a project under this engagement (backend.md › Assignment
 * Creation). On a talent engagement the worker is always its talent provider
 * and `client_engagement_id` is picked automatically when exactly one client
 * agreement on the project qualifies (L8); on a client engagement the worker
 * is the consultant provider themselves.
 */
export class CreateAssignmentDto {
  @IsUUID()
  project_id!: string;

  /** Optional confirmation; must equal the worker the engagement implies. */
  @IsOptional()
  @IsUUID()
  worker_user_id?: string;

  /** Talent engagements only: which client agreement the work bills through. */
  @IsOptional()
  @IsUUID()
  client_engagement_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  role_title?: string;

  /** Defaults to the team the hirer (talent) or provider (client) seat signed for. */
  @IsOptional()
  @IsUUID()
  team_id?: string;

  /** Defaults to now; may be backdated, never before the agreement starts. */
  @IsOptional()
  @IsISO8601({ strict: true })
  started_at?: string;
}

/** End an active assignment; any running timer under it stops at `ended_at`. */
export class EndAssignmentDto {
  /** Defaults to now; never in the future, never before the assignment started. */
  @IsOptional()
  @IsISO8601({ strict: true })
  ended_at?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
