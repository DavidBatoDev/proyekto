// web/src/services/time.types.ts
//
// The wire vocabulary of `/api/time`, mirrored from the backend's
// `backend/src/modules/execution/time/time.types.ts` (PR-1). Server-internal
// types (auth rows, freeze payloads, report scopes, export buffers) are left
// out; request bodies and query shapes that the DTOs accept are added.
//
// Fields from the PR-1 additions (web blueprint §1, A1–A12) are OPTIONAL here:
// the web must render correctly against a backend that does not send them yet.

// ── Vocabulary ──────────────────────────────────────────────────────────────

export type ContextKind = "assignment" | "team" | "workspace" | "personal";
export type WorkItem = "task" | "meeting" | "review" | "admin" | "other";
export type PresetWorkItem = Exclude<WorkItem, "task">;
export const PRESET_WORK_ITEMS: readonly PresetWorkItem[] = [
	"meeting",
	"review",
	"admin",
	"other",
];
export type WorkType = "real_work" | "training";
export type EntrySource = "timer" | "manual";
export type LegacyStatusMarker = "rejected" | "paid_outside";
export type FlaggedReason = "auto_stopped_24h" | "stopped_by_assignment_end";

export type SheetScopeKind = "engagement" | "team" | "workspace";
export type TimesheetStatus = "open" | "submitted" | "returned" | "approved";
export type ApproverScope = "team" | "workspace" | "hirer" | "auto" | "self";
export type SubmissionKind = "manual" | "auto" | "on_deletion" | "legacy";
export type DecisionKind = "manual" | "auto" | "self" | "legacy";
export type TimesheetOrigin = "app" | "legacy_migration";
export type TimesheetAction =
	| "submit"
	| "auto_submit"
	| "submit_on_deletion"
	| "withdraw"
	| "approve"
	| "return"
	| "reopen"
	| "request_reopen";
/** The actions a person can take from the web (the other two are system actions). */
export type TimesheetUserAction = Exclude<
	TimesheetAction,
	"auto_submit" | "submit_on_deletion"
>;
export type TimesheetEventKind =
	| "submitted"
	| "auto_submitted"
	| "withdrawn"
	| "approved"
	| "returned"
	| "reopened"
	| "reopen_requested"
	| "legacy_import";

export type UnavailableReason =
	| "team_time_off"
	| "plan"
	| "contract_disabled"
	| "engagement_inactive"
	| "no_settings";
export type ClientHoursLevel = "none" | "summary" | "detailed";
export type PolicySource =
	| "default"
	| "workspace"
	| "team"
	| "contract"
	| "member";
export type PeriodKind = "weekly" | "biweekly" | "semi_monthly" | "monthly";
export type RateSource = "team_member_rates" | "engagement_cost" | "none";
export type RateType = "hourly" | "fixed";

/**
 * Why an entry can't change, in trg_40's order: paid → billed → legacy →
 * frozen → sheet status. Derived by the backend (`lockedReason`).
 */
export type EntryLockedReason =
	| "paid"
	| "billed"
	| "legacy"
	| "frozen"
	| "sheet_submitted"
	| "sheet_approved";

export interface SheetScopeRef {
	kind: SheetScopeKind;
	ref: string;
}

/** A person shown as a decider (A1, A2). At most 5, deleted profiles skipped. */
export interface TimeDecider {
	id: string;
	display_name: string | null;
}

// ── For resolver ────────────────────────────────────────────────────────────

/** What a write asks the time to be for. `id` is null (or absent) for personal. */
export interface LoggingForRequest {
	kind: ContextKind;
	id?: string | null;
}

export interface LoggingOption {
	kind: ContextKind;
	/** Team id, workspace id or assignment id; null for personal. */
	id: string | null;
	/** "Rico for Pixel", "Design team", "Acme", "Just me". */
	label: string;
	/** Null only for personal. */
	sheet_scope: SheetScopeRef | null;
	rate_source: RateSource;
	/** The governing workspace's name when it differs from the project's workspace (L57). */
	workspace_tag: string | null;
	approver_hint: ApproverScope | null;
	/** A8: assignment options only, the engagement whose terms govern ("View terms →"). */
	engagement_id?: string | null;
}

export interface UnavailableOption {
	kind: ContextKind;
	id: string | null;
	label: string;
	reason: UnavailableReason;
	/**
	 * A-4, team rows only: the workspace the row answers to (its plan's for
	 * `plan`, the team's own for `team_time_off`), for "Prodigitality's plan
	 * doesn't include timesheets." / "Prodigitality has time tracking off for
	 * this team." Omitted when unknown or unnamed.
	 */
	workspace_name?: string;
}

export interface LoggingForResult {
	options: LoggingOption[];
	selected: LoggingOption | null;
	/** Remembered default awaiting one tap (L38). Shown, never applied silently. */
	prefill: LoggingOption | null;
	/** `none` = no `time.log`; `required` = several options, no valid default; `confirm` = several with a prefill. */
	reason?: "required" | "confirm" | "none";
	personal_reason?: "plan" | "no_governed_option";
	unavailable: UnavailableOption[];
}

// ── Policy ──────────────────────────────────────────────────────────────────

export interface MemberCaps {
	weekly_limit_hours: number | null;
	monthly_limit_hours: number | null;
	overtime_requires_approval: boolean;
}

export interface ResolvedTimePolicy {
	tracking_enabled: boolean;
	period_kind: PeriodKind;
	/** 1..7, ISO (1 = Monday). */
	week_start: number;
	timezone: string;
	/** YYYY-MM-DD. */
	period_anchor: string | null;
	approval_required: boolean;
	approver_scope: "team" | "workspace";
	allow_manual_entries: boolean;
	/** Null or 0 = no limit. */
	retroactive_days: number | null;
	/** 0, 5, 6, 10, 15 or 30. */
	rounding_minutes: number;
	weekly_limit_minutes: number | null;
	reminder_days: number;
	hidden_presets: PresetWorkItem[];
	tracking_mode: "disabled" | "optional" | "required" | null;
	/** Field name → where its value came from. */
	sources: Record<string, PolicySource>;
	plan: { time_tracking: boolean; time_team_rules: boolean };
	policy_workspace_id: string | null;
	team_override_applied: boolean;
	/** Team context only, from the team member rate in force. */
	member: MemberCaps | null;
	/** Engagement scope only; legacy contracts 'none'. */
	client_hours_detail_level: ClientHoursLevel | null;
	/** A8: set when the context is an assignment (the engagement whose terms govern). */
	engagement_id?: string | null;
}

export interface WorkspacePolicyView {
	workspace_id: string;
	policy: ResolvedTimePolicy;
	/** Row missing or never confirmed (CHANGE-11). A4: also true for a member reading defaults. */
	policy_unconfirmed: boolean;
	/** A4: false for a plain workspace member (read-only view). */
	can_edit: boolean;
}

/** The stored team override row: null fields inherit from the workspace. */
export type TeamPolicyOverride = Partial<TeamTimePolicyInput> &
	Record<string, unknown>;

export interface TeamPolicyView {
	team_id: string;
	/** Null when the team has no override. */
	override: TeamPolicyOverride | null;
	effective: ResolvedTimePolicy;
	/** Team owner only (D62: approval, approver, retroactive and rounding fields). */
	can_edit_money_fields: boolean;
	/** `time_team_rules` on the team's plan subject. */
	has_team_rules: boolean;
}

/** A7: what a policy history row records. */
export type PolicyHistoryKind = "created" | "changed" | "confirmed" | "deleted";

/** A7: one row of `GET time/policies/workspaces/:id/history`. */
export interface PolicyHistoryRow {
	/** `time_policy_events.id` (bigint). */
	id: number | string;
	created_at: string;
	actor: { id: string; display_name: string | null } | null;
	/** Field → [before, after]. */
	changes: Record<string, [unknown, unknown]>;
	scope: "workspace" | "team";
	team_id: string | null;
	team_name: string | null;
	/** A7 (additive): `created` rows read [null, value]; `deleted` [value, null]; `confirmed` {}. */
	kind?: PolicyHistoryKind;
}

// ── Freeze preview ──────────────────────────────────────────────────────────

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
	/** Only when the viewer can see cost on every entry of the sheet. */
	amounts_by_currency?: Record<string, number>;
}

// ── Entries ─────────────────────────────────────────────────────────────────

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

/**
 * Every read of an entry. Classes outside the viewer's grant are null or
 * absent (D32): `identity: 'masked'` nulls the member fields and sets
 * `member_label` to "Delivery team"; `content: 'hidden'` nulls task, note and
 * project and sets `content_label`; cost keys exist only when `cost: 'visible'`.
 */
export interface TimeEntryView {
	// base
	id: string;
	context_kind: ContextKind;
	context_ref: string | null;
	context_label_snapshot: string | null;
	timesheet_id: string | null;
	work_item: WorkItem;
	started_at: string;
	/** Null while the timer runs. */
	ended_at: string | null;
	/** Non-null while on a break. */
	paused_at: string | null;
	duration_seconds: number | null;
	break_seconds: number;
	break_minutes: number;
	/** Set by the freeze (approved time). */
	payable_seconds: number | null;
	source: EntrySource;
	work_type_snapshot: WorkType;
	legacy_status: LegacyStatusMarker | null;
	payout_id: string | null;
	flagged_reason: FlaggedReason | (string & {}) | null;
	project_id: string | null;
	team_id: string | null;
	workspace_id: string | null;
	engagement_assignment_id: string | null;
	created_at: string;
	/** Send back as `expected_updated_at` on PATCH (D42). */
	updated_at: string;
	timesheet: EntrySheetRef | null;
	locked_reason: EntryLockedReason | null;
	// identity
	identity: "visible" | "masked";
	member_user_id: string | null;
	member_display_name_snapshot: string | null;
	member: EntryMember | null;
	/** "Delivery team" when masked. */
	member_label: string | null;
	// content
	content: "visible" | "hidden";
	task_id: string | null;
	note: string | null;
	task: EntryTask | null;
	project: EntryProject | null;
	/** "A project you can't open" when hidden. */
	content_label: string | null;
	// cost (keys present only when visible)
	cost: "visible" | "hidden";
	rate_snapshot?: number;
	rate_type_snapshot?: RateType;
	currency_snapshot?: string;
	amount_snapshot?: number | null;
}

export type EntryWarning =
	| { code: "OVERLAP"; entry_ids: string[] }
	| {
			code: "CONTRACT_WEEKLY_LIMIT";
			limit_minutes: number;
			logged_minutes: number;
	  }
	| {
			/** A6: the workspace or team policy limit (indicator only, never blocks, D65). */
			code: "POLICY_WEEKLY_LIMIT";
			limit_minutes: number;
			logged_minutes: number;
			/** The scope label ("Prodigitality Services Inc. Team"). */
			label: string;
	  };

export type EntryWarningCode = EntryWarning["code"];

/** Start and manual create always answer warnings (possibly empty). */
export type EntryWithWarnings = TimeEntryView & { warnings: EntryWarning[] };

/** PATCH answers the entry; A6 may add `warnings`. */
export type UpdatedEntry = TimeEntryView & { warnings?: EntryWarning[] };

export interface SegmentRow {
	id: string;
	entry_id: string;
	kind: "work" | "break";
	started_at: string;
	/** Null while this is the running interval. */
	ended_at: string | null;
	created_at: string;
}

export interface CommentRow {
	id: string;
	entry_id: string;
	/** Null for a masked worker's comments. */
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
	/** The presets the policy shows (`hidden_presets` removed). */
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
	/** Approved (CHANGE-5). */
	payable_seconds: number;
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
	by_sheet_status: Record<TimesheetStatus | "personal", number>;
}

/** A9: one project the caller can log time on. */
export interface MyTimeProject {
	id: string;
	title: string;
	workspace_id: string | null;
	/** Available logging options. */
	options: number;
	default_kind: ContextKind | null;
	/** A9 (additive): `projects.status`, so the picker can sink or hide archived projects. */
	status?: string | null;
	/** A9 (additive): when the caller last logged here; null when never. The list is ordered by it. */
	last_logged_at?: string | null;
}

export interface MyTimeProjectsResult {
	projects: MyTimeProject[];
	/** A9 (additive): more than 200 loggable projects; the least recently logged were left out. */
	truncated?: true;
}

/** A11: why a person can log on the project ('none' = holds `time.log` but no option resolves). */
export type ProjectLoggerReason =
	| "team"
	| "workspace"
	| "agreement"
	| "personal"
	| "none";

export interface ProjectLogger {
	/** May be `masked:<id>` (masked talent rows, L22). */
	user_id: string;
	display_name: string | null;
	role: "owner" | "admin" | "editor" | "commenter" | "viewer" | (string & {});
	reason: ProjectLoggerReason;
	/** The primary option's label ("agreement with Pixel Studio", "just you"). */
	label: string;
	/** A11 (additive): how many options they have here (several = they pick per entry); 0 for `none`. */
	options?: number;
}

export interface ProjectLoggersResult {
	people: ProjectLogger[];
	/** A11 (additive): more than 200 people hold `time.log`; the rest were not resolved. */
	truncated?: true;
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
	/** Send back as `expected_revision` on every action. */
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

/** `timesheets.policy_snapshot` minus `routing`: the SQL layer only. */
export type PolicySnapshot = Omit<
	ResolvedTimePolicy,
	"member" | "client_hours_detail_level" | "engagement_id"
> & { legacy?: true };

/** `policy_snapshot.routing`, written at submit. */
export interface SheetRouting {
	base: ApproverScope;
	cost_money: boolean;
	deciders_count: number;
	fallback: "none" | "self" | "auto" | "workspace" | "wait";
}

/** A1: where a submit would go now (the member's own open or returned sheet). */
export interface SheetRoutingPreview {
	approver_scope: ApproverScope;
	cost_money: boolean;
	/** At most 5. */
	deciders: TimeDecider[];
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
	/** Σ duration of its entries now. */
	logged_seconds: number;
	/** A1 (on `me/timesheets` items too). */
	routing_preview?: SheetRoutingPreview;
	/** A2: the member's submitted sheet. At most 5. */
	deciders?: TimeDecider[];
	/**
	 * D85, so "sends itself <date>" is exact. Submitted and approved sheets: the
	 * `policy_snapshot` frozen at submit. Open and returned sheets: the sheet
	 * scope's live policy, which the auto-submit and reminder checks read (an
	 * open sheet's snapshot is empty; A-5 deviation 1). Absent when unknown.
	 */
	reminder_days?: number | null;
}

export interface TimesheetDetail {
	sheet: TimesheetSummary;
	entries: TimeEntryView[];
	events: TimesheetEventRow[];
	/** Frozen at submit (minus `routing`); null while open. */
	rules: PolicySnapshot | null;
	routing: SheetRouting | null;
	viewer: {
		is_member: boolean;
		can_decide: boolean;
		/** What this viewer may do now. */
		actions: TimesheetAction[];
	};
	/** Deciders only. */
	freeze_preview?: FreezePreview;
	/** Deciders, and the member of a submitted sheet (0 → "No one else can approve this"). */
	deciders_count?: number;
	/** A1: the member, own `open` or `returned` sheet; omitted when no route resolves. */
	routing_preview?: SheetRoutingPreview;
	/** A2: the member, while `submitted`. At most 5. */
	deciders?: TimeDecider[];
}

/** A3: what the decider should look at before approving. */
export interface ApprovalFlags {
	/** Entries of ≥ 10 h, or flagged (auto-stopped, stopped by an assignment end). */
	needs_review: number;
	over_cap_seconds: number;
	/** Entries still running. */
	running: number;
	/** True when `over_cap_seconds` was skipped (set to 0) for this row. */
	flags_partial?: boolean;
}

export interface ApprovalRow extends TimesheetSummary {
	member: {
		id: string;
		display_name: string | null;
		avatar_url: string | null;
	} | null;
	/** The sheet's policy workspace when it differs from the viewer's current one (E27). */
	policy_workspace: { id: string; name: string } | null;
	/** A3. */
	flags?: ApprovalFlags;
	/** A3: tolerated here too, in case the marker lands on the row. */
	flags_partial?: boolean;
}

export interface ApprovalsCount {
	waiting: number;
}

// ── Overview ────────────────────────────────────────────────────────────────

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
	/**
	 * D85: the context's resolved policy, so the page needn't guess it from
	 * sheets. Null for `personal` (the person's preferences apply); absent
	 * from a server without D85.
	 */
	timezone?: string | null;
	week_start?: number | null;
	period_kind?: PeriodKind | null;
	period_anchor?: string | null;
	reminder_days?: number | null;
}

export interface WorkspaceTimeAdmin {
	workspace_id: string;
	name: string;
	slug: string | null;
	has_time_tracking: boolean;
	policy_unconfirmed: boolean;
}

export interface TimeOverview {
	/** `time.log` on any project. */
	can_log: boolean;
	/** L36: decider anywhere (or waiting > 0) with no own entries in 30 days. */
	approver_mode: boolean;
	contexts: OverviewContext[];
	approvals_waiting: number;
	workspace_time_admin: WorkspaceTimeAdmin[];
}

/** What guests get, and a safe placeholder while loading. */
export const EMPTY_TIME_OVERVIEW: TimeOverview = Object.freeze({
	can_log: false,
	approver_mode: false,
	contexts: [],
	approvals_waiting: 0,
	workspace_time_admin: [],
}) as TimeOverview;

// ── Reports ─────────────────────────────────────────────────────────────────

export type ReportScopeKind = "team" | "project" | "workspace" | "engagement";

/** Serialised as `?scope=<kind>:<id>`. */
export interface ReportScopeRef {
	kind: ReportScopeKind;
	id: string;
}

/** `week` is A5 (key = week-start date, label "Sep 22–28"). */
export type ReportGroupBy =
	| "day"
	| "member"
	| "project"
	| "task"
	| "context"
	| "week";

export interface ReportSummaryGroup {
	key: string;
	label: string;
	total_seconds: number;
	payable_seconds: number;
	amounts_by_currency?: Record<string, number>;
}

export interface ReportSummary {
	scope: { kind: ReportScopeKind; id: string };
	timezone: string;
	total_seconds: number;
	payable_seconds: number;
	groups: ReportSummaryGroup[];
	/** Distinct sheets per status among the entries in range (D69). */
	sheet_status_counts: Record<TimesheetStatus, number>;
	/** Team scope (E34): logged seconds under agreements. */
	under_agreements_seconds?: number;
}

export type TimeExportFormat = "csv" | "xlsx";

/** A downloaded export. */
export interface TimeExportFile {
	blob: Blob;
	filename: string;
	contentType: string;
}

// ── Paging ──────────────────────────────────────────────────────────────────

export interface Paged<T> {
	items: T[];
	total: number;
	page: number;
	limit: number;
}

export interface PageQuery {
	page?: number;
	limit?: number;
}

// ── Request shapes (DTOs) ───────────────────────────────────────────────────

export interface StartEntryInput {
	project_id: string;
	/** XOR `work_item` (both → 422 WORK_ITEM_INVALID). */
	task_id?: string | null;
	work_item?: PresetWorkItem;
	logging_for?: LoggingForRequest;
	/** Remember this For choice for the project. */
	remember?: boolean;
	work_type?: WorkType;
	/** ≤ 2000 characters. */
	note?: string | null;
}

export interface CreateEntryInput extends StartEntryInput {
	started_at: string;
	ended_at: string;
	/** 0..86400. */
	break_seconds?: number;
	/** @deprecated Send `break_seconds`; it wins when both are sent. */
	break_minutes?: number;
}

export interface UpdateEntryInput {
	task_id?: string | null;
	work_item?: PresetWorkItem;
	started_at?: string;
	ended_at?: string;
	break_seconds?: number;
	/** @deprecated Send `break_seconds`. */
	break_minutes?: number;
	note?: string | null;
	work_type?: WorkType;
	logging_for?: LoggingForRequest;
	/** Required (D42): the `updated_at` of the copy being edited; stale → 409 STALE_REVISION. */
	expected_updated_at: string;
}

export interface DateRangeQuery {
	/** YYYY-MM-DD. */
	from: string;
	to: string;
}

export interface MyEntriesQuery extends DateRangeQuery, PageQuery {
	project_id?: string;
	/** Filters to one context; also switches the range to that context's timezone. */
	for?: LoggingForRequest | null;
}

export interface MyTimesheetsQuery {
	from?: string;
	to?: string;
}

export interface UpdateTimePreferencesInput {
	/** An IANA timezone. */
	timezone: string;
	/** 1..7; omitted keeps the stored value. */
	week_start?: number | null;
}

export interface TimesheetActionInput {
	expected_revision: number;
	/** ≤ 2000. Required for `return` and a decider's `reopen`. */
	note?: string;
	/** Approve only. */
	approve_overtime?: boolean;
}

export interface ApproveBulkInput {
	/** 1..100 distinct ids. */
	ids: string[];
	/** Same length and order as `ids`. */
	expected_revisions: number[];
	note?: string;
	approve_overtime?: boolean;
}

export interface ApprovalsQuery extends PageQuery {
	/** Defaults to `submitted` (waiting on the caller). */
	status?: "submitted" | "decided";
	/** YYYY-MM-DD; with `decided`, recent decisions only. */
	since?: string;
	scope_kind?: SheetScopeKind;
}

export interface ReportQuery extends DateRangeQuery, PageQuery {
	scope: ReportScopeRef;
	member_user_id?: string;
	status?: TimesheetStatus;
	context_kind?: Exclude<ContextKind, "personal">;
	group_by?: ReportGroupBy;
}

export type ReportExportQuery = Omit<ReportQuery, "page" | "limit"> & {
	format?: TimeExportFormat;
};

export interface AuditExportQuery extends DateRangeQuery {
	workspace_id: string;
	format?: TimeExportFormat;
}

export interface WorkspacePolicyQuery {
	/** A manager's browser timezone, used only to materialise a missing row. */
	tz?: string;
}

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
	/** "Looks right": stamps the policy as confirmed without changing values. */
	confirm?: boolean;
}

/** Null = inherit from the workspace. No `tracking_enabled` or `hidden_presets`. */
export interface TeamTimePolicyInput {
	period_kind?: PeriodKind | null;
	week_start?: number | null;
	timezone?: string | null;
	period_anchor?: string | null;
	approval_required?: boolean | null;
	approver_scope?: "team" | null;
	allow_manual_entries?: boolean | null;
	retroactive_days?: number | null;
	rounding_minutes?: number | null;
	weekly_limit_minutes?: number | null;
	reminder_days?: number | null;
}

// ── Error codes ─────────────────────────────────────────────────────────────

/** Mirrors the backend's `TimeErrorCode` (time-errors.ts). */
export const TIME_ERROR_CODES = [
	// 403
	"NO_LOGGING_CONTEXT",
	"MANUAL_ENTRIES_DISABLED",
	"TIME_ENTRY_NO_PROJECT_ACCESS",
	"TIME_ENTRY_NOT_ON_PROJECT_TEAM",
	"TIME_ENTRY_NOT_WORKSPACE_MEMBER",
	"PAYOUT_SELF_NOT_ALLOWED",
	// 404
	"TIME_NOT_FOUND",
	"TIMESHEET_NOT_FOUND",
	// 409
	"LOGGING_FOR_REQUIRED",
	"TIMESHEET_LOCKED",
	"TIMER_ALREADY_RUNNING",
	"TIMER_NOT_RUNNING",
	"TIMESHEET_HAS_SETTLED_ENTRIES",
	"STALE_REVISION",
	"TIMESHEET_TRANSITION_INVALID",
	"LEGACY_CONTRACT_AMBIGUOUS",
	"APPROVED_TIME_ASSIGNMENT_LOCKED",
	"INVOICE_TIME_ENTRY_NOT_BILLABLE",
	// 410
	"TIMESHEETS_REPLACED_REVIEW",
	"APP_UPDATE_REQUIRED",
	// 422
	"LOGGING_FOR_INVALID",
	"RETROACTIVE_WINDOW",
	"HOUR_CAP_EXCEEDED",
	"TEAM_RATES_REQUIRE_APPROVAL",
	"FIXED_RATE_NOT_PAYABLE_BY_ENTRY",
	"ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED",
	"ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER",
	"TIME_POLICY_INVALID",
	"WORK_ITEM_INVALID",
	"TIME_LOG_ASSIGNMENT_INVALID",
	"TIME_LOG_OUTSIDE_ASSIGNMENT_WINDOW",
] as const;

export type TimeErrorCode = (typeof TIME_ERROR_CODES)[number];

/** An unmapped database failure: always a 500 with fixed Proyekto copy (D55). */
export const TIME_INTERNAL_CODE = "TIME_INTERNAL";

/** No response at all (offline, timeout, CORS). Status 0. */
export const TIME_NETWORK_ERROR_CODE = "NETWORK_ERROR";

/** Not an HTTP failure (a bug in the caller or a thrown non-axios error). Status 0. */
export const TIME_CLIENT_ERROR_CODE = "CLIENT_ERROR";

/**
 * Every `code` a `TimeApiError` can carry: the time codes, the 500, the shared
 * plan and permission 403s, and fallbacks. A response without a code (DTO
 * validation, a missing note, a pipe 404) reads as `HTTP_<status>`.
 */
export type TimeApiErrorCode =
	| TimeErrorCode
	| typeof TIME_INTERNAL_CODE
	| typeof TIME_NETWORK_ERROR_CODE
	| typeof TIME_CLIENT_ERROR_CODE
	| "plan_limit"
	| "missing_permission"
	| `HTTP_${number}`;

/** Why a transition was refused (M3 §2.10 list). */
export type TimesheetTransitionInvalidReason =
	| "action"
	| "arguments"
	| "note_too_long"
	| "not_allowed"
	| "state"
	| "empty"
	| "running_entry"
	| "too_early"
	| "not_auto"
	| "note_required"
	| "freeze_required"
	| "freeze_invalid"
	| "use_request_reopen";

/**
 * The extras each code carries in its error body, as the backend sends them.
 * They are server data, not validated at runtime: read them defensively.
 */
export interface TimeErrorExtrasMap {
	LOGGING_FOR_REQUIRED: {
		options: LoggingOption[];
		prefill: LoggingOption | null;
	};
	LOGGING_FOR_INVALID: { options?: LoggingOption[]; detail?: unknown };
	TIMESHEET_LOCKED:
		| {
				reason: "entry";
				lock: EntryLockedReason | (string & {}) | null;
				entry_id: string | null;
		  }
		| {
				reason: "period";
				timesheet_id: string | null;
				sheet_status: TimesheetStatus | null;
		  };
	STALE_REVISION: {
		/** Entry edits (D42). */
		entry_id?: string;
		updated_at?: string;
		/** Timesheet actions; A10 keeps it on bulk approve. */
		timesheet_id?: string;
		expected?: number;
		actual?: number;
		/** The freeze's entry set changed under the decider. */
		reason?: "entry_set";
	};
	TIMESHEET_TRANSITION_INVALID: {
		reason: TimesheetTransitionInvalidReason;
		timesheet_id?: string;
		sheet_status?: TimesheetStatus;
		detail?: string;
	};
	TIMESHEET_HAS_SETTLED_ENTRIES: {
		timesheet_id?: string;
		reason: "paid" | "billed" | "legacy";
		/** A12. */
		payout_id?: string;
		/** A12: reason 'paid' with no payout (legacy paid-outside marker). */
		paid_outside?: true;
		invoice_id?: string;
		invoice_number?: string | null;
		/** A12: 'draft', or any issued status. */
		invoice_status?: string;
	};
	RETROACTIVE_WINDOW: { earliest_date: string };
	HOUR_CAP_EXCEEDED: {
		limit_window: "weekly" | "monthly";
		limit_hours: number;
		logged_hours: number;
		window_start: string;
		window_end: string;
	};
	TIME_POLICY_INVALID: { fields?: string[] };
	TIME_LOG_ASSIGNMENT_INVALID: { detail?: string };
	LEGACY_CONTRACT_AMBIGUOUS: { reason?: "teams" | "contracts" };
	ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED: { client_engagements?: unknown[] };
}

export type TimeErrorExtras<C extends string> =
	C extends keyof TimeErrorExtrasMap
		? TimeErrorExtrasMap[C] & Record<string, unknown>
		: Record<string, unknown>;
