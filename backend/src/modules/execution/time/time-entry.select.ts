// backend/src/modules/execution/time/time-entry.select.ts
// Redaction is by select class (backend.md rule 4): hidden classes are never fetched.
// Column hints only (never *_fkey names — they rename in M5).

export const ENTRY_AUTH_SELECT =
  'id, member_user_id, project_id, context_kind, context_ref, team_id, workspace_id, ' +
  'engagement_assignment_id, timesheet_id, started_at';

export const ENTRY_SHEET_EMBED =
  'timesheet:timesheets!timesheet_id(id, status, period_start, period_end, decision_kind, ' +
  'decided_by, decided_at, decision_note, scope_label_snapshot)';

export const ENTRY_BASE_SELECT =
  'id, context_kind, context_ref, context_label_snapshot, timesheet_id, work_item, started_at, ended_at, ' +
  'paused_at, duration_seconds, break_seconds, break_minutes, payable_seconds, source, work_type_snapshot, ' +
  'legacy_status, payout_id, flagged_reason, project_id, team_id, workspace_id, engagement_assignment_id, ' +
  'created_at, updated_at, ' +
  ENTRY_SHEET_EMBED;

export const ENTRY_IDENTITY_SELECT =
  'id, member_user_id, member_display_name_snapshot, ' +
  'member:profiles!member_user_id(id, display_name, avatar_url, first_name, last_name)';

export const ENTRY_IDENTITY_EMAIL_SELECT =
  'id, member_user_id, member_display_name_snapshot, ' +
  'member:profiles!member_user_id(id, display_name, avatar_url, first_name, last_name, email)';

export const ENTRY_CONTENT_SELECT =
  'id, task_id, note, task:roadmap_tasks!task_id(id, title, work_type, status), ' +
  'project:projects!project_id(id, title)';

export const ENTRY_COST_SELECT =
  'id, rate_snapshot, rate_type_snapshot, currency_snapshot, amount_snapshot';

/** Own rows: one query, every class (the member sees all of their own entry). */
export const ENTRY_SELF_SELECT =
  ENTRY_BASE_SELECT +
  ', member_user_id, member_display_name_snapshot, ' +
  'member:profiles!member_user_id(id, display_name, avatar_url, first_name, last_name, email), ' +
  'task_id, note, task:roadmap_tasks!task_id(id, title, work_type, status), ' +
  'project:projects!project_id(id, title), rate_snapshot, rate_type_snapshot, currency_snapshot, amount_snapshot';

/** Legacy reviewer embed (alias rule 2). */
export const ENTRY_LEGACY_REVIEW_SELECT =
  'id, legacy_reviewed_by, legacy_reviewed_at, legacy_review_note, ' +
  'legacy_reviewer:profiles!legacy_reviewed_by(id, display_name, avatar_url)';

export const SEGMENT_SELECT =
  'id, entry_id, kind, started_at, ended_at, created_at';

export const COMMENT_SELECT =
  'id, entry_id, author_user_id, body, created_at, updated_at, ' +
  'author:profiles!author_user_id(id, display_name, avatar_url, first_name, last_name)';
/** Self and team-manager views add the email. */
export const COMMENT_SELECT_WITH_EMAIL =
  'id, entry_id, author_user_id, body, created_at, updated_at, ' +
  'author:profiles!author_user_id(id, display_name, avatar_url, first_name, last_name, email)';

export const TIMESHEET_SELECT =
  'id, member_user_id, member_display_name_snapshot, scope_kind, scope_ref, team_id, workspace_id, ' +
  'engagement_id, scope_label_snapshot, policy_workspace_id, period_kind, period_start, period_end, timezone, ' +
  'week_start, status, approver_scope, revision, submitted_at, submitted_by, submission_kind, decided_at, ' +
  'decided_by, decision_kind, decision_note, overtime_approved, total_seconds, payable_seconds, origin, ' +
  'created_at, updated_at';
export const TIMESHEET_DETAIL_SELECT = TIMESHEET_SELECT + ', policy_snapshot';
export const TIMESHEET_EVENT_SELECT =
  'id, timesheet_id, actor_user_id, event, from_status, to_status, note, total_seconds, payable_seconds, ' +
  'revision, created_at';
