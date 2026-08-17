import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

// The global ValidationPipe runs whitelist + forbidNonWhitelisted, so any field
// not declared here makes the request a 400. Add fields to the DTO, not just to
// the service.

export const DELIVERABLE_STATUSES = [
  'not_started',
  'in_progress',
  'in_review',
  'approved',
  'changes_requested',
] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];

export const CHANGE_REQUEST_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'changes_requested',
  'withdrawn',
  'applied',
] as const;
export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];

export const RISK_KINDS = ['risk', 'issue'] as const;
export const RISK_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const RISK_LIKELIHOODS = ['low', 'medium', 'high'] as const;
export const RISK_STATUSES = [
  'open',
  'mitigating',
  'monitoring',
  'resolved',
  'accepted',
  'closed',
] as const;
export const VISIBILITIES = ['internal', 'shared'] as const;

/**
 * `superseded` is deliberately absent: it is reached only by creating the
 * replacement, never by asking for it directly.
 */
export const DECISION_STATUSES = ['proposed', 'final'] as const;
/** Token keys resolved by CATEGORY_ACCENT in web. Mirrors the table's CHECK. */
export const CATEGORY_COLORS = [
  'slate',
  'blue',
  'violet',
  'teal',
  'amber',
  'rose',
  'emerald',
  'indigo',
] as const;
/** Keys into CATEGORY_ICON in web. Mirrors the table's CHECK. */
export const CATEGORY_ICONS = [
  'tag',
  'cpu',
  'palette',
  'crosshair',
  'briefcase',
  'workflow',
  'shield',
  'database',
] as const;

// ─── Links ──────────────────────────────────────────────────────────────────

/**
 * Exactly one target must be set — enforced in the database by a
 * `num_nonnulls(...) = 1` CHECK and re-checked in the service so the caller
 * gets a 400 rather than a 500.
 */
export class LinkTargetDto {
  @IsOptional()
  @IsUUID()
  epic_id?: string;

  @IsOptional()
  @IsUUID()
  feature_id?: string;

  @IsOptional()
  @IsUUID()
  task_id?: string;

  @IsOptional()
  @IsUUID()
  milestone_id?: string;

  @IsOptional()
  @IsUUID()
  deliverable_id?: string;
}

// ─── Deliverables ───────────────────────────────────────────────────────────

export class CreateDeliverableDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  acceptance_criteria?: string;

  @IsOptional()
  @IsUUID()
  roadmap_id?: string;

  @IsOptional()
  @IsUUID()
  owner_id?: string;

  @IsOptional()
  @IsDateString()
  due_date?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LinkTargetDto)
  links?: LinkTargetDto[];

  /** Acceptance criteria labels, created in the order given. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  criteria?: string[];

  /** Project members who must sign this off. Any member may be named. */
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  reviewer_ids?: string[];
}

export class UpdateDeliverableDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  acceptance_criteria?: string;

  @IsOptional()
  @IsUUID()
  owner_id?: string | null;

  @IsOptional()
  @IsDateString()
  due_date?: string | null;

  @IsOptional()
  @IsInt()
  position?: number;

  /**
   * Only the non-review part of the ladder. Moving to in_review / approved /
   * changes_requested goes through the dedicated endpoints so the
   * submitted_by / reviewed_by stamps can never be skipped.
   */
  @IsOptional()
  @IsIn(['not_started', 'in_progress'])
  status?: 'not_started' | 'in_progress';
}

export class ReviewDeliverableDto {
  @IsIn(['approved', 'changes_requested'])
  decision!: 'approved' | 'changes_requested';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  review_note?: string;
}

export const EVIDENCE_CATEGORIES = [
  'github',
  'figma',
  'deployment',
  'docs',
  'demo',
  'other',
] as const;
export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number];

export class CreateDeliverableCriterionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  label!: string;
}

export class UpdateDeliverableCriterionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  label?: string;

  /** Ticking records who and when; un-ticking clears both. */
  @IsOptional()
  @IsBoolean()
  is_met?: boolean;
}

export class AddDeliverableReviewerDto {
  @IsUUID()
  reviewer_id!: string;
}

export class AddDeliverableAttachmentDto {
  @IsIn(['file', 'link'])
  kind!: 'file' | 'link';

  /** What kind of proof this is, so evidence can be grouped. */
  @IsOptional()
  @IsIn(EVIDENCE_CATEGORIES as unknown as string[])
  category?: EvidenceCategory;

  @IsString()
  @MaxLength(2000)
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  storage_key?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  mime_type?: string;

  @IsOptional()
  @IsInt()
  size_bytes?: number;
}

export class ListDeliverablesQueryDto {
  @IsOptional()
  @IsIn(DELIVERABLE_STATUSES as unknown as string[])
  status?: DeliverableStatus;
}

// ─── Change requests ────────────────────────────────────────────────────────

export class CreateChangeRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  impact_scope?: string;

  /** Signed: negative pulls the schedule in. Never a cost. */
  @IsOptional()
  @IsInt()
  impact_timeline_days?: number;

  @IsOptional()
  @IsDateString()
  target_date_before?: string;

  @IsOptional()
  @IsDateString()
  target_date_after?: string;

  @IsOptional()
  @IsUUID()
  roadmap_id?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LinkTargetDto)
  links?: LinkTargetDto[];

  /** Submit immediately instead of saving a draft. */
  @IsOptional()
  @IsBoolean()
  submit?: boolean;
}

export class UpdateChangeRequestDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  impact_scope?: string;

  @IsOptional()
  @IsInt()
  impact_timeline_days?: number | null;

  @IsOptional()
  @IsDateString()
  target_date_before?: string | null;

  @IsOptional()
  @IsDateString()
  target_date_after?: string | null;

  /**
   * A draft raised before a roadmap was attached to the project needs to be
   * able to acquire one — the roadmap is what `Apply to roadmap` commits against.
   */
  @IsOptional()
  @IsUUID()
  roadmap_id?: string | null;
}

export class DecideChangeRequestDto {
  @IsIn(['approved', 'rejected', 'changes_requested'])
  decision!: 'approved' | 'rejected' | 'changes_requested';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  decision_note?: string;
}

export class MarkChangeRequestAppliedDto {
  /**
   * The roadmap_change_history commit that carried this onto the roadmap.
   *
   * Supplied by the caller AFTER a normal preview -> commit round trip, which
   * is what keeps approval from blind-clobbering the roadmap with a stale
   * revision token.
   */
  @IsUUID()
  applied_change_id!: string;
}

export class ListChangeRequestsQueryDto {
  @IsOptional()
  @IsIn(CHANGE_REQUEST_STATUSES as unknown as string[])
  status?: ChangeRequestStatus;

  /**
   * Coarse grouping the list page's filter chips use, so "everything still in
   * play" is one request rather than four. Ignored when `status` is given —
   * an exact status is always the more specific intent.
   */
  @IsOptional()
  @IsIn(['open', 'awaiting_decision', 'decided', 'closed', 'all'])
  view?: 'open' | 'awaiting_decision' | 'decided' | 'closed' | 'all';

  @IsOptional()
  @IsUUID()
  requested_by?: string;
}

// ─── Risks & issues ─────────────────────────────────────────────────────────

export class CreateRiskDto {
  @IsIn(RISK_KINDS as unknown as string[])
  kind!: 'risk' | 'issue';

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsIn(RISK_SEVERITIES as unknown as string[])
  severity?: 'low' | 'medium' | 'high' | 'critical';

  /** Required when kind is 'risk'; rejected when kind is 'issue'. */
  @IsOptional()
  @IsIn(RISK_LIKELIHOODS as unknown as string[])
  likelihood?: 'low' | 'medium' | 'high';

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  impact?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  mitigation?: string;

  @IsOptional()
  @IsUUID()
  owner_id?: string;

  @IsOptional()
  @IsDateString()
  due_date?: string;

  @IsOptional()
  @IsIn(VISIBILITIES as unknown as string[])
  visibility?: 'internal' | 'shared';

  @IsOptional()
  @IsIn(['manual', 'blocked_task', 'at_risk_milestone'])
  source_kind?: 'manual' | 'blocked_task' | 'at_risk_milestone';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LinkTargetDto)
  links?: LinkTargetDto[];
}

export class UpdateRiskDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsIn(RISK_SEVERITIES as unknown as string[])
  severity?: 'low' | 'medium' | 'high' | 'critical';

  @IsOptional()
  @IsIn(RISK_LIKELIHOODS as unknown as string[])
  likelihood?: 'low' | 'medium' | 'high';

  @IsOptional()
  @IsIn(RISK_STATUSES as unknown as string[])
  status?: (typeof RISK_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  impact?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  mitigation?: string;

  @IsOptional()
  @IsUUID()
  owner_id?: string | null;

  @IsOptional()
  @IsDateString()
  due_date?: string | null;

  @IsOptional()
  @IsIn(VISIBILITIES as unknown as string[])
  visibility?: 'internal' | 'shared';
}

export class ListRisksQueryDto {
  @IsOptional()
  @IsIn(RISK_KINDS as unknown as string[])
  kind?: 'risk' | 'issue';

  @IsOptional()
  @IsIn(RISK_STATUSES as unknown as string[])
  status?: (typeof RISK_STATUSES)[number];
}

// ─── Decisions ──────────────────────────────────────────────────────────────

export class CreateDecisionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  decision!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  context?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  rationale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  alternatives_considered?: string;

  @IsOptional()
  @IsDateString()
  decided_on?: string;

  @IsOptional()
  @IsUUID()
  decided_by?: string;

  /** Marks the named decision superseded and links this one back to it. */
  @IsOptional()
  @IsUUID()
  supersedes_decision_id?: string;

  @IsOptional()
  @IsUUID()
  source_chat_message_id?: string;

  @IsOptional()
  @IsIn(VISIBILITIES as unknown as string[])
  visibility?: 'internal' | 'shared';

  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsIn(DECISION_STATUSES as unknown as string[])
  status?: (typeof DECISION_STATUSES)[number];

  /** Work this decision bears on. Any of the five targets is allowed here. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LinkTargetDto)
  links?: LinkTargetDto[];

  /** What was weighed, created in the order given. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DecisionOptionInputDto)
  options?: DecisionOptionInputDto[];
}

export class DecisionOptionInputDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  detail?: string;

  @IsOptional()
  @IsBoolean()
  is_selected?: boolean;
}

export class UpdateDecisionOptionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  detail?: string;

  /**
   * Setting this true clears the sibling in the same write — the partial unique
   * index `uq_decision_options_selected` rejects a second selected row.
   */
  @IsOptional()
  @IsBoolean()
  is_selected?: boolean;
}

export class ListDecisionsDto {
  @IsOptional()
  @IsIn(['proposed', 'final', 'superseded'])
  status?: 'proposed' | 'final' | 'superseded';

  @IsOptional()
  @IsUUID()
  category_id?: string;
}

export class CreateDecisionCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsIn(CATEGORY_COLORS as unknown as string[])
  color?: (typeof CATEGORY_COLORS)[number];

  @IsOptional()
  @IsIn(CATEGORY_ICONS as unknown as string[])
  icon?: (typeof CATEGORY_ICONS)[number];
}

export class UpdateDecisionCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsIn(CATEGORY_COLORS as unknown as string[])
  color?: (typeof CATEGORY_COLORS)[number];

  @IsOptional()
  @IsIn(CATEGORY_ICONS as unknown as string[])
  icon?: (typeof CATEGORY_ICONS)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

export class UpdateDecisionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  decision?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  context?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  rationale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  alternatives_considered?: string;

  @IsOptional()
  @IsDateString()
  decided_on?: string;

  @IsOptional()
  @IsIn(VISIBILITIES as unknown as string[])
  visibility?: 'internal' | 'shared';

  /**
   * Null clears the category. `status` is absent on purpose: moving to final is
   * `POST :id/finalize`, so the stamps cannot be skipped.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  category_id?: string | null;
}
