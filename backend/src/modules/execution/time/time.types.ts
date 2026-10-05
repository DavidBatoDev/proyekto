// backend/src/modules/execution/time/time.types.ts
// The shared vocabulary of the time module. Types plus two constants.

export type ContextKind = 'assignment' | 'team' | 'workspace' | 'personal';
export type WorkItem = 'task' | 'meeting' | 'review' | 'admin' | 'other';
export type PresetWorkItem = Exclude<WorkItem, 'task'>;
export const PRESET_WORK_ITEMS: readonly PresetWorkItem[] = [
  'meeting',
  'review',
  'admin',
  'other',
];
export type WorkType = 'real_work' | 'training';
export type EntrySource = 'timer' | 'manual';
export type LegacyStatusMarker = 'rejected' | 'paid_outside';
export type FlaggedReason = 'auto_stopped_24h' | 'stopped_by_assignment_end';

export type SheetScopeKind = 'engagement' | 'team' | 'workspace';
export type TimesheetStatus = 'open' | 'submitted' | 'returned' | 'approved';
export type ApproverScope = 'team' | 'workspace' | 'hirer' | 'auto' | 'self';
export type SubmissionKind = 'manual' | 'auto' | 'on_deletion' | 'legacy';
export type DecisionKind = 'manual' | 'auto' | 'self' | 'legacy';
export type TimesheetOrigin = 'app' | 'legacy_migration';
export type TimesheetAction =
  | 'submit'
  | 'auto_submit'
  | 'submit_on_deletion'
  | 'withdraw'
  | 'approve'
  | 'return'
  | 'reopen'
  | 'request_reopen';
export type TimesheetEventKind =
  | 'submitted'
  | 'auto_submitted'
  | 'withdrawn'
  | 'approved'
  | 'returned'
  | 'reopened'
  | 'reopen_requested'
  | 'legacy_import';

export type ResolvePurpose = 'timer' | 'manual' | 'edit' | 'alias' | 'read';
export type WritePurpose = Exclude<ResolvePurpose, 'read'>;
export type UnavailableReason =
  | 'team_time_off'
  | 'plan'
  | 'contract_disabled'
  | 'engagement_inactive'
  | 'no_settings';
export type ClientHoursLevel = 'none' | 'summary' | 'detailed';
export type PolicySource =
  | 'default'
  | 'workspace'
  | 'team'
  | 'contract'
  | 'member';
export type PeriodKind = 'weekly' | 'biweekly' | 'semi_monthly' | 'monthly';
export type RateSource = 'team_member_rates' | 'engagement_cost' | 'none';
export type RateType = 'hourly' | 'fixed';

/** Legacy per-entry status as the old web reads it (alias only). */
export type LegacyEntryStatus = 'pending' | 'approved' | 'paid' | 'rejected';

export interface SheetScopeRef {
  kind: SheetScopeKind;
  ref: string;
}

/** time_sheet_scope_for output (M1). */
export interface SheetScopeResult {
  scope_kind: SheetScopeKind;
  scope_ref: string;
  policy_workspace_id: string | null;
  scope_label: string;
}

// ── For resolver ────────────────────────────────────────────────────────────
export interface LoggingForRequest {
  kind: ContextKind;
  id?: string | null;
}

export interface LoggingOption {
  kind: ContextKind;
  /** team id, workspace id, assignment id; null for personal. */
  id: string | null;
  /** "Rico for Pixel", "Design team", "Acme", "Just me". */
  label: string;
  sheet_scope: SheetScopeRef | null; // null only for personal
  rate_source: RateSource;
  /** Governing workspace name when it differs from the project's workspace (L57). */
  workspace_tag: string | null;
  approver_hint: ApproverScope | null;
}

export interface UnavailableOption {
  kind: ContextKind;
  id: string | null;
  label: string;
  reason: UnavailableReason;
}

export interface LoggingForResult {
  options: LoggingOption[];
  selected: LoggingOption | null;
  /** Remembered default awaiting one tap (L38). */
  prefill: LoggingOption | null;
  reason?: 'required' | 'confirm' | 'none';
  personal_reason?: 'plan' | 'no_governed_option';
  unavailable: UnavailableOption[];
}

// ── Policy ──────────────────────────────────────────────────────────────────
export interface MemberCaps {
  weekly_limit_hours: number | null;
  monthly_limit_hours: number | null;
  overtime_requires_approval: boolean;
}

/** time_resolve_policy jsonb (M1) + the two TS layers (D24). */
export interface ResolvedTimePolicy {
  tracking_enabled: boolean;
  period_kind: PeriodKind;
  week_start: number; // 1..7 ISO
  timezone: string;
  period_anchor: string | null; // YYYY-MM-DD
  approval_required: boolean;
  approver_scope: 'team' | 'workspace';
  allow_manual_entries: boolean;
  retroactive_days: number | null; // null or 0 = no limit
  rounding_minutes: number; // 0,5,6,10,15,30
  weekly_limit_minutes: number | null;
  reminder_days: number;
  hidden_presets: PresetWorkItem[];
  tracking_mode: 'disabled' | 'optional' | 'required' | null;
  sources: Record<string, PolicySource>;
  plan: { time_tracking: boolean; time_team_rules: boolean };
  policy_workspace_id: string | null;
  team_override_applied: boolean;
  /** TS layer: team context only, from team_member_rates in force on the local date. */
  member: MemberCaps | null;
  /** TS layer: engagement scope only, from settingsInForceOn; legacy contracts 'none'. */
  client_hours_detail_level: ClientHoursLevel | null;
}

export interface WorkspacePolicyView {
  workspace_id: string;
  policy: ResolvedTimePolicy;
  /** Row missing or updated_by IS NULL (CHANGE-11). */
  policy_unconfirmed: boolean;
  can_edit: boolean;
}

export interface TeamPolicyView {
  team_id: string;
  /** The stored override row, null when none. NULL fields = inherit. */
  override: Record<string, unknown> | null;
  effective: ResolvedTimePolicy;
  can_edit_money_fields: boolean; // team owner
  has_team_rules: boolean; // plan key on the team's plan subject
}

// ── Rates and freeze ────────────────────────────────────────────────────────
export interface RateEstimate {
  rate_snapshot: number;
  rate_type_snapshot: RateType;
  currency_snapshot: string;
}

export interface FrozenRate {
  rate: number;
  rateType: RateType;
  currency: string;
  /** false for fixed and for client-only governing engagements → amount NULL. */
  amountable: boolean;
}

/** One entry's freeze values, as sent to time_timesheet_transition. */
export interface FreezeEntryValue {
  payable_seconds: number; // integer ≥ 0, ≤ duration + 900
  rate_snapshot: number; // ≥ 0
  rate_type_snapshot: RateType;
  currency_snapshot: string;
  /** Only NULL-ness is used by the RPC (it recomputes the value). */
  amount_snapshot: number | null;
}
/** { "<entry id>": FreezeEntryValue } */
export type SheetFreeze = Record<string, FreezeEntryValue>;
/** { "<timesheet id>": SheetFreeze } — the p_freeze argument (D10). */
export type FreezePayload = Record<string, SheetFreeze>;

export interface FreezePreviewEntry {
  entry_id: string;
  rounded_seconds: number;
  payable_seconds: number;
  over_cap_seconds: number;
}
export interface FreezePreview {
  timesheet_id: string;
  entries: FreezePreviewEntry[];
  over_cap_seconds: number;
  /** Present only when the viewer is costVisible for every entry of the sheet. */
  amounts_by_currency?: Record<string, number>;
}

// ── Entries ─────────────────────────────────────────────────────────────────
/** Internal authorisation row; never returned to clients. */
export interface EntryAuthRow {
  id: string;
  member_user_id: string | null;
  project_id: string | null;
  context_kind: ContextKind;
  context_ref: string | null;
  team_id: string | null;
  workspace_id: string | null;
  engagement_assignment_id: string | null;
  timesheet_id: string | null;
  started_at: string;
}

export interface EntrySheetRef {
  id: string;
  status: TimesheetStatus;
  period_start: string;
  period_end: string;
  decision_kind: DecisionKind | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  scope_label_snapshot: string;
}

export interface EntryMember {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  /** Self and team-manager views only. */
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}
export interface EntryTask {
  id: string;
  title: string;
  work_type: WorkType | null;
  status: string | null;
}
export interface EntryProject {
  id: string;
  title: string;
}

/** Every read of an entry returns this; classes outside the viewer's grant are null/absent (D32). */
export interface TimeEntryView {
  // base (anyone who can view the entry)
  id: string;
  context_kind: ContextKind;
  context_ref: string | null;
  context_label_snapshot: string | null;
  timesheet_id: string | null;
  work_item: WorkItem;
  started_at: string;
  ended_at: string | null;
  paused_at: string | null;
  duration_seconds: number | null;
  break_seconds: number;
  break_minutes: number;
  payable_seconds: number | null;
  source: EntrySource;
  work_type_snapshot: WorkType;
  legacy_status: LegacyStatusMarker | null;
  payout_id: string | null;
  flagged_reason: string | null;
  project_id: string | null;
  team_id: string | null;
  workspace_id: string | null;
  engagement_assignment_id: string | null;
  created_at: string;
  updated_at: string;
  timesheet: EntrySheetRef | null;
  /** Derived in TS: 'paid' | 'billed' | 'legacy' | 'frozen' | 'sheet_submitted' | 'sheet_approved' | null. */
  locked_reason: string | null;
  // identity
  identity: 'visible' | 'masked';
  member_user_id: string | null;
  member_display_name_snapshot: string | null;
  member: EntryMember | null;
  member_label: string | null; // 'Delivery team' when masked
  // content
  content: 'visible' | 'hidden';
  task_id: string | null;
  note: string | null;
  task: EntryTask | null;
  project: EntryProject | null;
  content_label: string | null; // "A project you can't open" when hidden
  // cost (keys present only when costVisible)
  cost: 'visible' | 'hidden';
  rate_snapshot?: number;
  rate_type_snapshot?: RateType;
  currency_snapshot?: string;
  amount_snapshot?: number | null;
}

export type EntryWarning =
  | { code: 'OVERLAP'; entry_ids: string[] }
  | {
      code: 'CONTRACT_WEEKLY_LIMIT';
      limit_minutes: number;
      logged_minutes: number;
    };

export type EntryWithWarnings = TimeEntryView & { warnings: EntryWarning[] };

export interface SegmentRow {
  id: string;
  entry_id: string;
  kind: 'work' | 'break';
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

export interface CommentRow {
  id: string;
  entry_id: string;
  author_user_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
  author: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  } | null;
}

/** The old TimeLogLimitContext shape; also the new cap-context shape. */
export interface CapContext {
  over_limit: boolean;
  limit_window: 'weekly' | 'monthly' | null;
  limit_hours: number | null;
  logged_hours_in_window: number | null;
  overtime_requires_approval: boolean;
  window_start: string | null; // YYYY-MM-DD local
  window_end: string | null;
}

export interface ProjectTaskOption {
  id: string;
  title: string;
  work_type: WorkType | null;
  feature_id: string | null;
  feature_title: string | null;
  epic_id: string | null;
  epic_title: string | null;
}
export interface WorkItemsResult {
  tasks: ProjectTaskOption[];
  presets: PresetWorkItem[];
}

export interface UserTimePreferences {
  user_id: string;
  timezone: string;
  week_start: number | null;
  updated_at: string;
}

export interface MySummary {
  timezone: string;
  from: string;
  to: string;
  total_seconds: number;
  payable_seconds: number; // Approved (CHANGE-5)
  by_day: Array<{ date: string; total_seconds: number }>;
  by_context: Array<{
    kind: ContextKind;
    ref: string | null;
    label: string;
    total_seconds: number;
  }>;
  by_project: Array<{
    project_id: string | null;
    title: string | null;
    total_seconds: number;
  }>;
  by_sheet_status: Record<TimesheetStatus | 'personal', number>;
}

// ── Timesheets ──────────────────────────────────────────────────────────────
export interface TimesheetRow {
  id: string;
  member_user_id: string | null;
  member_display_name_snapshot: string | null;
  scope_kind: SheetScopeKind;
  scope_ref: string;
  team_id: string | null;
  workspace_id: string | null;
  engagement_id: string | null;
  scope_label_snapshot: string;
  policy_workspace_id: string | null;
  period_kind: PeriodKind;
  period_start: string;
  period_end: string;
  timezone: string;
  week_start: number;
  status: TimesheetStatus;
  approver_scope: ApproverScope | null;
  revision: number;
  submitted_at: string | null;
  submitted_by: string | null;
  submission_kind: SubmissionKind | null;
  decided_at: string | null;
  decided_by: string | null;
  decision_kind: DecisionKind | null;
  decision_note: string | null;
  overtime_approved: boolean;
  total_seconds: number | null;
  payable_seconds: number | null;
  origin: TimesheetOrigin;
  created_at: string;
  updated_at: string;
}

/** timesheets.policy_snapshot minus `routing`: the SQL jsonb only, so no TS layers (critic CC15). */
export type PolicySnapshot = Omit<
  ResolvedTimePolicy,
  'member' | 'client_hours_detail_level'
> & { legacy?: true };

/** policy_snapshot.routing, written by the transition at submit (§2.10). */
export interface SheetRouting {
  base: ApproverScope;
  cost_money: boolean;
  deciders_count: number;
  fallback: 'none' | 'self' | 'auto' | 'workspace' | 'wait';
}

export interface TimesheetEventRow {
  id: number;
  timesheet_id: string;
  actor_user_id: string | null;
  event: TimesheetEventKind;
  from_status: TimesheetStatus | null;
  to_status: TimesheetStatus;
  note: string | null;
  total_seconds: number | null;
  payable_seconds: number | null;
  revision: number;
  created_at: string;
}

export interface TimesheetSummary extends TimesheetRow {
  entry_count: number;
  running_count: number;
  logged_seconds: number; // Σ duration of its entries now
}

export interface TimesheetDetail {
  sheet: TimesheetSummary;
  entries: TimeEntryView[];
  events: TimesheetEventRow[];
  /** From policy_snapshot (frozen at submit, minus `routing`); null while open. */
  rules: PolicySnapshot | null;
  routing: SheetRouting | null;
  viewer: {
    is_member: boolean;
    can_decide: boolean;
    actions: TimesheetAction[]; // what this viewer may do now
  };
  /** Deciders only. */
  freeze_preview?: FreezePreview;
  deciders_count?: number;
}

export interface ApprovalRow extends TimesheetSummary {
  member: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  /** Set when the sheet's policy workspace differs from the viewer's current one (E27). */
  policy_workspace: { id: string; name: string } | null;
}

export interface OverviewContext {
  kind: ContextKind;
  id: string | null;
  label: string;
  sheet_scope: SheetScopeRef | null;
  current_sheet: {
    id: string;
    status: TimesheetStatus;
    period_start: string;
    period_end: string;
    total_seconds: number;
  } | null;
}
export interface WorkspaceTimeAdmin {
  workspace_id: string;
  name: string;
  slug: string | null;
  has_time_tracking: boolean;
  policy_unconfirmed: boolean;
}
export interface TimeOverview {
  can_log: boolean;
  approver_mode: boolean;
  contexts: OverviewContext[];
  approvals_waiting: number;
  workspace_time_admin: WorkspaceTimeAdmin[];
}
export const EMPTY_TIME_OVERVIEW: TimeOverview = {
  can_log: false,
  approver_mode: false,
  contexts: [],
  approvals_waiting: 0,
  workspace_time_admin: [],
};

// ── Reports ─────────────────────────────────────────────────────────────────
export type ReportScope =
  | {
      kind: 'team';
      id: string;
      planRef: unknown /* EntitlementRef */;
      timezone: string;
    }
  | { kind: 'project'; id: string; planRef: unknown; timezone: string }
  | { kind: 'workspace'; id: string; planRef: unknown; timezone: string }
  | {
      kind: 'engagement';
      id: string;
      planRef: unknown;
      timezone: string;
      viewerPosition: 'hirer' | 'provider';
      clientLevel: ClientHoursLevel | null;
    };

export interface ReportSummary {
  scope: { kind: ReportScope['kind']; id: string };
  timezone: string;
  total_seconds: number;
  payable_seconds: number;
  groups: Array<{
    key: string;
    label: string;
    total_seconds: number;
    payable_seconds: number;
    amounts_by_currency?: Record<string, number>;
  }>;
  sheet_status_counts: Record<TimesheetStatus, number>;
  under_agreements_seconds?: number; // team scope (E34)
}

export interface ExportFile {
  filename: string;
  contentType: string;
  body: Buffer;
}

// ── Paging ──────────────────────────────────────────────────────────────────
export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
