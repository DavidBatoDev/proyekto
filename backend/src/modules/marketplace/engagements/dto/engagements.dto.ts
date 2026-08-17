import { IsIn, IsOptional, IsUUID } from 'class-validator';

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
