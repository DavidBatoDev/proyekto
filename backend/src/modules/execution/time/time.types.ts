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
  /** A8, assignment options only: the engagement whose terms govern the time (talent, else client), for the
   *  web-only "View terms →" link. Absent on every other kind. */
  engagement_id?: string | null;
}

export interface UnavailableOption {
  kind: ContextKind;
  id: string | null;
  label: string;
  reason: UnavailableReason;
  /** A-4, team rows only: the workspace the row answers to (its plan's for `plan`, the team's own for
   *  `team_time_off`), for "Prodigitality's plan doesn't include timesheets." / "Prodigitality has time tracking
   *  off for this team." Omitted when unknown or unnamed. */
  workspace_name?: string;
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

// ── Projects and loggers (A9, A11) ──────────────────────────────────────────
/** A9: one project the caller can log time on (`time.log` and at least one option after the step-7 collapse). */
export interface LoggableProject {
  id: string;
  title: string;
  workspace_id: string | null;
  /** Additive: the project's workspace name, so a project shared from a workspace the caller isn't in can be
   *  labelled ("Website · Acme Inc."). Null when there is no workspace or the name lookup failed. */
  workspace_name?: string | null;
  /** How many For options the picker offers (the resolver's `options.length`, always ≥ 1). */
  options: number;
  /** The option a new entry uses without asking (the single option), else the remembered prefill awaiting one
   *  tap; null when the picker must ask. */
  default_kind: ContextKind | null;
  /** Additive: `projects.status`, so the picker can sink or hide archived projects. */
  status: string | null;
  /** Additive: when the caller last logged here (`started_at` of their newest entry among their latest 1000),
   *  for "the default is the most recently logged project". Null when none. */
  last_logged_at: string | null;
}

/** A9 `GET /time/me/projects`: most recently logged first, then by title. */
export interface MyProjectsResult {
  projects: LoggableProject[];
  /** Additive: the caller can log on more than MY_PROJECTS_MAX projects; the least recently logged were left out. */
  truncated?: true;
}

/** A11: what a person's primary option is. `none` only when Proyekto could not resolve them just now. */
export type ProjectLoggerReason =
  | 'team'
  | 'workspace'
  | 'agreement'
  | 'personal'
  | 'none';

/** project_access roles (the share ladder). */
export type ProjectShareRole =
  | 'viewer'
  | 'commenter'
  | 'editor'
  | 'admin'
  | 'owner';

/** A11: one person who can log time on the project. */
export interface ProjectLogger {
  /** The person's id, or `masked:<project_access id>` for placed talent the viewer may not name (L22), as on the
   *  project roster. */
  user_id: string;
  /** "Delivery team member" when masked. */
  display_name: string | null;
  role: ProjectShareRole;
  reason: ProjectLoggerReason;
  /** The primary option as a phrase: the team or workspace name, "agreement with Pixel Studio", "just you";
   *  '' for `none`. */
  label: string;
  /** Additive: how many options they have here (several = they pick per entry). 0 for `none`. */
  options: number;
}

/** A11 `GET /time/projects/:projectId/loggers`. */
export interface ProjectLoggersResult {
  people: ProjectLogger[];
  /** Additive: more than LOGGERS_MAX people hold `time.log`; the rest were not resolved. */
  truncated?: true;
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
  /** A8, `GET …/policy?for=assignment:<id>` only: the engagement whose terms govern (the sheet scope's
   *  engagement), for the web-only "View terms →" link. Absent for every other context. */
  engagement_id?: string | null;
}

export interface WorkspacePolicyView {
  workspace_id: string;
  policy: ResolvedTimePolicy;
  /** Row missing or updated_by IS NULL (CHANGE-11). Members see it too (A4). */
  policy_unconfirmed: boolean;
  /** True for workspace managers (`can_manage_workspace`); false for a plain member's read-only view (A4). */
  can_edit: boolean;
}

/** A7: what one policy audit row did. `confirmed` = an update that changed no setting ("Looks right"). */
export type PolicyHistoryKind = 'created' | 'changed' | 'confirmed' | 'deleted';

/** A7: one `time_policy_events` row of the workspace policy or one of the workspace's team overrides. */
export interface PolicyHistoryRow {
  id: number;
  created_at: string;
  /** Null for a system write (no actor) or an actor whose profile is gone. */
  actor: { id: string; display_name: string | null } | null;
  /** Setting → [before, after], bookkeeping columns (ids, scope, created/updated stamps) removed. `created`
   *  rows read [null, value] for each set field; `deleted` rows read [value, null]; `confirmed` rows are {}. */
  changes: Record<string, [unknown, unknown]>;
  scope: 'workspace' | 'team';
  team_id: string | null;
  /** The team's current name; null on workspace rows. */
  team_name: string | null;
  kind: PolicyHistoryKind;
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
    }
  | {
      /** A6 (D65): the workspace or team policy weekly limit. An indicator only; it never blocks or cuts. */
      code: 'POLICY_WEEKLY_LIMIT';
      limit_minutes: number;
      /** The member's minutes on that sheet scope in the policy week, this write included. */
      logged_minutes: number;
      /** The sheet scope's label ("Prodigitality Services Inc. Team", "Acme"). */
      label: string;
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

/** A person who decides (or would decide) a sheet, as shown to its member (A1, A2). At most
 *  DECIDER_NAMES_MAX per list, deleted profiles skipped, sorted by display name. */
export interface DeciderName {
  id: string;
  display_name: string | null;
}

/** A1: where submitting the member's own `open`/`returned` sheet now would go
 *  (`time_sheet_routing_preview(id, 'submit')` plus the names of that scope's deciders).
 *  `deciders` is empty for `auto` and `self`, and for a scope nobody can decide ("No one else can approve this"). */
export interface RoutingPreview {
  approver_scope: ApproverScope;
  cost_money: boolean;
  deciders: DeciderName[];
}

export interface TimesheetSummary extends TimesheetRow {
  entry_count: number;
  running_count: number;
  logged_seconds: number; // Σ duration of its entries now
  /** A1, `GET /time/me/timesheets` only: the member's `open`/`returned` sheets. Absent when the preview failed. */
  routing_preview?: RoutingPreview;
  /** A2, `GET /time/me/timesheets` only: the member's `submitted` sheets (time_timesheet_deciders). */
  deciders?: DeciderName[];
  /** D85 (`me/timesheets`, the approval rows, the detail's `sheet`): the reminder and auto-submit delay in days
   *  (0..14), for "sends itself <period_end + max(reminder_days, 1)>". `open` and `returned` sheets carry their
   *  scope's resolved policy now (an open sheet has no snapshot yet, and the reminder and auto-submit checks
   *  resolve when they run); `submitted` and `approved` ones carry `policy_snapshot.reminder_days`, frozen at
   *  submit. Absent when unknown (a failed policy read, or a snapshot without it). */
  reminder_days?: number;
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
  /** Deciders, and the member while the sheet is `submitted`. */
  deciders_count?: number;
  /** A1: the member only, on their own `open`/`returned` sheet. Absent when the preview failed. */
  routing_preview?: RoutingPreview;
  /** A2: the member only, while their sheet is `submitted` (at most 5 of `deciders_count`). */
  deciders?: DeciderName[];
}

/** A3: what a decider should look at before approving a waiting sheet. */
export interface ApprovalFlags {
  /** Entries with `duration_seconds` ≥ 10 h or a `flagged_reason`. */
  needs_review: number;
  /** The freeze preview's over-cap total (the detail's `freeze_preview.over_cap_seconds`). */
  over_cap_seconds: number;
  /** Running entries (same as `running_count`). */
  running: number;
}

export interface ApprovalRow extends TimesheetSummary {
  member: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  /** Set when the sheet's policy workspace differs from the viewer's current one (E27). */
  policy_workspace: { id: string; name: string } | null;
  /** A3: on the `submitted` queue only (the `decided` queue carries none). */
  flags?: ApprovalFlags;
  /** A3: `over_cap_seconds` was not computed for this row (past the first 50 waiting rows of the page, or the
   *  freeze preview failed) and reads 0. */
  flags_partial?: true;
}

/** Error extras of 409 `STALE_REVISION` from a timesheet transition (A10). `timesheet_id` names the sheet that
 *  changed, so bulk approve can say "Nothing was approved: Leo Cruz's timesheet changed." */
export interface TimesheetStaleExtras {
  timesheet_id: string;
  /** Revision mismatch. */
  expected?: number;
  actual?: number;
  /** The sheet's entries changed after the freeze was built. */
  reason?: 'entry_set';
}

/** Error extras of 409 `TIMESHEET_HAS_SETTLED_ENTRIES` (A12). The lookups are best effort: any of the optional
 *  keys may be missing. `reason` 'paid' with `payout_id` → "in payout …"; 'paid' with `paid_outside` → "paid
 *  outside Proyekto"; 'billed' with `invoice_number` and `invoice_status` ('draft' or issued) → the invoice copy. */
export interface TimesheetSettledExtras {
  timesheet_id: string;
  reason: 'paid' | 'billed' | 'legacy';
  /** reason 'paid': the payout of the earliest paid entry on the sheet. */
  payout_id?: string;
  /** reason 'paid' with no payout: an entry was paid outside Proyekto (legacy marker). */
  paid_outside?: true;
  /** reason 'billed': the invoice of the sheet's earliest reservation. D80: the invoice keys go to a decider
   *  only, never on the member's own auto/self reopen (a worker never learns the client's invoice numbers). */
  invoice_id?: string;
  invoice_number?: string;
  invoice_status?: string;
}

/** D85: the period rules of an overview context, from its resolved policy: the context's routed sheet scope
 *  (time_sheet_scope_for now) resolved now, the same policy `me/entries?for=<context>` reads its dates in.
 *  Every field is null for `personal` (the web uses the person's preferences) and when the scope or policy
 *  read failed (an assignment that no longer exists reads in the person's zone on `me/entries` too). */
export interface OverviewContextPolicy {
  /** IANA zone; an invalid stored zone reads as 'UTC', as the server reads it. */
  timezone: string | null;
  /** 1..7 ISO weekday (1 = Monday). */
  week_start: number | null;
  period_kind: PeriodKind | null;
  /** `YYYY-MM-DD`; null for the default biweekly anchor and for every other period kind without one. */
  period_anchor: string | null;
  /** 0..14 days after period end; "sends itself" is period end + max(reminder_days, 1). */
  reminder_days: number | null;
}

export interface OverviewContext extends OverviewContextPolicy {
  kind: ContextKind;
  id: string | null;
  label: string;
  sheet_scope: SheetScopeRef | null;
  /** V10, assignment contexts: the assignment's project (`engagement_assignments.project_id`), so two
   *  assignments under one agreement (same label, same sheet scope) can be told apart. Null once the project is
   *  deleted, for every other kind, and when the lookup failed (best effort; the overview still answers). The
   *  server always sends it; optional for older answers. */
  project_id?: string | null;
  /** V10, assignment contexts: that project's live title, else the assignment's `project_title_snapshot` (a
   *  deleted project). Null for every other kind and when the lookup failed. */
  project_title?: string | null;
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

export type ReportGroupBy =
  | 'day'
  | 'week'
  | 'member'
  | 'project'
  | 'task'
  | 'context';

export interface ReportSummary {
  scope: { kind: ReportScope['kind']; id: string };
  timezone: string;
  total_seconds: number;
  payable_seconds: number;
  groups: Array<{
    /** `week` (A5): the week-start date `YYYY-MM-DD` in the scope's policy timezone and week start. */
    key: string;
    /** `week` (A5): "Sep 22–28", "Sep 29–Oct 5", or with years when the week spans two years. */
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
