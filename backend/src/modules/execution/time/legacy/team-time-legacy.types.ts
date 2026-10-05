// backend/src/modules/execution/time/legacy/team-time-legacy.types.ts
//
// The response shapes the /api/team-time routes returned before PR-1 (team-time.service.ts:29-234 at 91d227aa), which
// the alias (P15) must keep returning to the deployed web and old OTA bundles. Field names are frozen: the
// old web reads them by name. Compat inventory: scratchpad pr1/compat.md §1 ("Row").
import type {
  CapContext,
  LegacyEntryStatus,
  ProjectTaskOption,
  WorkType,
} from '../time.types';

/** Old TimeLogLimitContext (HourCapBanner); the same shape as CapContext. */
export type LegacyLimitContext = CapContext;

export interface LegacyTaskEmbed {
  id: string;
  title: string;
  work_type: WorkType | null;
  status: string | null;
}

export interface LegacyProject {
  id: string;
  title: string;
}

export interface LegacyMemberEmbed {
  id: string;
  /** Filled from member_display_name_snapshot when the profile's is null (compat rule 3). */
  display_name: string | null;
  avatar_url: string | null;
  first_name: string | null;
  last_name: string | null;
  /** Self and team-manager routes only (compat rule 4). */
  email?: string | null;
}

export interface LegacyReviewerEmbed {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

/** The old TaskTimeLog row (TimeLogRow). Cost keys are absent, never zero, when cost is hidden (D05). */
export interface LegacyTaskTimeLog {
  // core
  id: string;
  project_id: string | null;
  task_id: string | null;
  team_id: string | null;
  /** 'masked:' + context_ref for a masked assignment row (D32); never null, the web groups by it. */
  member_user_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  /** Rounded display/edit mirror of break_seconds (D43). */
  break_minutes: number;
  break_seconds: number;
  paused_at: string | null;
  /** Derived from column predicates (D03); never read from time_entries.status. */
  status: LegacyEntryStatus;
  source: 'timer' | 'manual';
  work_type_snapshot: WorkType;
  member_display_name_snapshot: string | null;
  flagged_reason: string | null;
  created_at: string;
  updated_at: string;
  // cost (present only when costVisible)
  rate_snapshot?: number;
  rate_type_snapshot?: 'hourly' | 'fixed';
  currency_snapshot?: string;
  // review (compat rule 2: the sheet decision, else legacy_reviewed_*)
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  // embeds
  task: LegacyTaskEmbed | null;
  project: LegacyProject | null;
  member: LegacyMemberEmbed | null;
  reviewer: LegacyReviewerEmbed | null;
  // extras
  limit_context?: LegacyLimitContext;
}

/** Per-currency fee totals, split by legacy status (old SummaryBucket). */
export interface LegacySummaryBucket {
  pendingFees: number;
  approvedFees: number;
  paidFees: number;
  rejectedFees: number;
  totalFees: number;
}

/** Old LogStatusCounts. */
export interface LegacyStatusCounts {
  pending: number;
  approved: number;
  paid: number;
  rejected: number;
}

/** Old LogsSummary. `statusCounts` is always present (team-time.service.ts:61-66); with hidden cost
 *  `buckets` is {} and `currencies` is [] (D05). */
export interface LegacyLogsSummary {
  buckets: Record<string, LegacySummaryBucket>;
  currencies: string[];
  totalHours: number;
  statusCounts: LegacyStatusCounts;
}

export interface LegacyListResult {
  items: LegacyTaskTimeLog[];
  total: number;
}

/** Old TimeLogSegmentRow: `log_id` = entry_id. */
export interface LegacySegment {
  id: string;
  log_id: string;
  kind: 'work' | 'break';
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

/** Old TimeLogCommentRow: `log_id` = entry_id. */
export interface LegacyComment {
  id: string;
  log_id: string;
  author_user_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
  author: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    first_name: string | null;
    last_name: string | null;
    email?: string | null;
  } | null;
}

/**
 * Old team/project member option: label = display_name || email || id. Email for managers only.
 * `avatar_url` is on every row (today's queries select it; the web's member filters read it); a masked
 * member gets `avatar_url: null` (D32, D75).
 */
export interface LegacyMember {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  email?: string | null;
}

/** Old project-contract-status; the alias always answers { enforcement: 'off', engagement_status: 'engaged' } (D01). */
export interface LegacyContractStatus {
  enforcement: 'off' | 'warn' | 'enforce';
  engagement_status: 'engaged' | 'grandfathered' | 'ineligible';
}

/** Old timer-picker task option (#17, #28): tasks only, flat. */
export type LegacyProjectTaskOption = ProjectTaskOption;

/** POST cron/heal-orphaned-logs: always { scanned: 0, healed: 0 } (D02). */
export interface LegacyHealResult {
  scanned: number;
  healed: number;
}
