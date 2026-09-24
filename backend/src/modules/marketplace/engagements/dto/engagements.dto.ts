import {
  IsIn,
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
