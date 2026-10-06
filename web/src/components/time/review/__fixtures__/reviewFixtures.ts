// Test fixtures for the review screen (not shipped: only *.test.* files import this).
//
// A weekly Asia/Manila sheet, Mon Sep 21 – Sun Sep 27 2026, for Maria Santos on
// the Prodigitality Services Inc. Team:
//
// | Entry | Project            | Day (Manila)  | Time         | Notes                          |
// |-------|--------------------|---------------|--------------|--------------------------------|
// | e1    | Acme Website       | Mon Sep 21    | 09:00–13:00  | 4:00                           |
// | e2    | Acme Website       | Thu Sep 24    | 08:00–16:10  | 8:10                           |
// | e3    | Internal ops       | Thu Sep 24    | 17:00–20:30  | 3:30 (Thu = 11:40 ⚠)           |
// | e4    | (hidden) p3        | Tue Sep 22    | 09:00–10:00  | 1:00                           |
// | e5    | (hidden) p4        | Wed Sep 23    | 09:00–09:20  | 0:20                           |
// | e6    | Internal ops       | Fri Sep 25    | 09:00–10:00  | 1:00, added Sep 27 (later)     |
//
// Total 18:00, 4 projects behind 3 grid rows.

import type {
	TimeEntryView,
	TimesheetDetail,
	TimesheetEventRow,
	TimesheetSummary,
} from "@/services/time.types";

export const TZ = "Asia/Manila";
export const MEMBER = "11111111-1111-4111-8111-111111111111";
export const DECIDER = "22222222-2222-4222-8222-222222222222";
export const SHEET_ID = "33333333-3333-4333-8333-333333333333";
export const ENGAGEMENT_ID = "44444444-4444-4444-8444-444444444444";
/** Tue Oct 6 2026, 12:00 in Manila. */
export const NOW = new Date("2026-10-06T04:00:00.000Z");

export function sheet(over: Partial<TimesheetSummary> = {}): TimesheetSummary {
	return {
		id: SHEET_ID,
		member_user_id: MEMBER,
		member_display_name_snapshot: "Maria Santos",
		scope_kind: "team",
		scope_ref: "t1",
		team_id: "t1",
		workspace_id: "w1",
		engagement_id: null,
		scope_label_snapshot: "Prodigitality Services Inc. Team",
		policy_workspace_id: "w1",
		period_kind: "weekly",
		period_start: "2026-09-21",
		period_end: "2026-09-27",
		timezone: TZ,
		week_start: 1,
		status: "submitted",
		approver_scope: "team",
		revision: 4,
		submitted_at: "2026-09-28T02:14:00.000Z",
		submitted_by: MEMBER,
		submission_kind: "manual",
		decided_at: null,
		decided_by: null,
		decision_kind: null,
		decision_note: null,
		overtime_approved: false,
		total_seconds: 18 * 3600,
		payable_seconds: null,
		origin: "app",
		created_at: "2026-09-21T01:00:00.000Z",
		updated_at: "2026-09-28T02:14:00.000Z",
		entry_count: 6,
		running_count: 0,
		logged_seconds: 18 * 3600,
		...over,
	};
}

/** Manila wall clock → ISO instant. */
export function manila(date: string, time: string): string {
	return new Date(`${date}T${time}:00+08:00`).toISOString();
}

export function entry(over: Partial<TimeEntryView> = {}): TimeEntryView {
	const started = over.started_at ?? manila("2026-09-21", "09:00");
	return {
		id: "e1",
		context_kind: "team",
		context_ref: "t1",
		context_label_snapshot: "Prodigitality Services Inc. Team",
		timesheet_id: SHEET_ID,
		work_item: "task",
		started_at: started,
		ended_at: manila("2026-09-21", "13:00"),
		paused_at: null,
		duration_seconds: 4 * 3600,
		break_seconds: 0,
		break_minutes: 0,
		payable_seconds: null,
		source: "timer",
		work_type_snapshot: "real_work",
		legacy_status: null,
		payout_id: null,
		flagged_reason: null,
		project_id: "p1",
		team_id: "t1",
		workspace_id: "w1",
		engagement_assignment_id: null,
		created_at: over.ended_at ?? manila("2026-09-21", "13:00"),
		updated_at: manila("2026-09-21", "13:00"),
		timesheet: {
			id: SHEET_ID,
			status: "submitted",
			period_start: "2026-09-21",
			period_end: "2026-09-27",
			decision_kind: null,
			decided_by: null,
			decided_at: null,
			decision_note: null,
			scope_label_snapshot: "Prodigitality Services Inc. Team",
		},
		locked_reason: "sheet_submitted",
		identity: "visible",
		member_user_id: MEMBER,
		member_display_name_snapshot: "Maria Santos",
		member: {
			id: MEMBER,
			display_name: "Maria Santos",
			avatar_url: null,
		},
		member_label: null,
		content: "visible",
		task_id: "task-1",
		note: null,
		task: {
			id: "task-1",
			title: "Fix login bug",
			work_type: "real_work",
			status: "todo",
		},
		project: { id: "p1", title: "Acme Website" },
		content_label: null,
		cost: "hidden",
		...over,
	};
}

function hidden(over: Partial<TimeEntryView>): TimeEntryView {
	return entry({
		content: "hidden",
		task: null,
		task_id: null,
		note: null,
		project: null,
		content_label: "A project you can't open",
		...over,
	});
}

export function entries(): TimeEntryView[] {
	return [
		entry(),
		entry({
			id: "e2",
			started_at: manila("2026-09-24", "08:00"),
			ended_at: manila("2026-09-24", "16:10"),
			created_at: manila("2026-09-24", "16:10"),
			duration_seconds: 8 * 3600 + 10 * 60,
		}),
		entry({
			id: "e3",
			project_id: "p2",
			project: { id: "p2", title: "Internal ops" },
			task: {
				id: "task-3",
				title: "Write runbook",
				work_type: "real_work",
				status: "todo",
			},
			task_id: "task-3",
			started_at: manila("2026-09-24", "17:00"),
			ended_at: manila("2026-09-24", "20:30"),
			created_at: manila("2026-09-24", "20:30"),
			duration_seconds: 3.5 * 3600,
		}),
		hidden({
			id: "e4",
			project_id: "p3",
			started_at: manila("2026-09-22", "09:00"),
			ended_at: manila("2026-09-22", "10:00"),
			created_at: manila("2026-09-22", "10:00"),
			duration_seconds: 3600,
		}),
		hidden({
			id: "e5",
			project_id: "p4",
			started_at: manila("2026-09-23", "09:00"),
			ended_at: manila("2026-09-23", "09:20"),
			created_at: manila("2026-09-23", "09:20"),
			duration_seconds: 20 * 60,
		}),
		entry({
			id: "e6",
			project_id: "p2",
			project: { id: "p2", title: "Internal ops" },
			task: {
				id: "task-6",
				title: "Interview loop",
				work_type: "real_work",
				status: "todo",
			},
			task_id: "task-6",
			source: "manual",
			started_at: manila("2026-09-25", "09:00"),
			ended_at: manila("2026-09-25", "10:00"),
			created_at: manila("2026-09-27", "18:00"),
			duration_seconds: 3600,
		}),
	];
}

export function event(
	over: Partial<TimesheetEventRow> = {},
): TimesheetEventRow {
	return {
		id: 1,
		timesheet_id: SHEET_ID,
		actor_user_id: MEMBER,
		event: "submitted",
		from_status: "open",
		to_status: "submitted",
		note: null,
		total_seconds: 18 * 3600,
		payable_seconds: null,
		revision: 4,
		created_at: "2026-09-28T02:14:00.000Z",
		...over,
	};
}

export function rules(
	over: Partial<NonNullable<TimesheetDetail["rules"]>> = {},
): NonNullable<TimesheetDetail["rules"]> {
	return {
		tracking_enabled: true,
		period_kind: "weekly",
		week_start: 1,
		timezone: TZ,
		period_anchor: null,
		approval_required: true,
		approver_scope: "team",
		allow_manual_entries: true,
		retroactive_days: 7,
		rounding_minutes: 0,
		weekly_limit_minutes: null,
		reminder_days: 1,
		hidden_presets: [],
		tracking_mode: null,
		sources: { weekly_limit_minutes: "default", period_kind: "workspace" },
		plan: { time_tracking: true, time_team_rules: true },
		policy_workspace_id: "w1",
		team_override_applied: true,
		...over,
	};
}

/** The detail a team lead (a decider) reads for Maria's submitted sheet. */
export function deciderDetail(
	over: Partial<TimesheetDetail> = {},
): TimesheetDetail {
	return {
		sheet: sheet(),
		entries: entries(),
		events: [event()],
		rules: rules(),
		routing: {
			base: "team",
			cost_money: false,
			deciders_count: 2,
			fallback: "none",
		},
		viewer: {
			is_member: false,
			can_decide: true,
			actions: ["approve", "return"],
		},
		freeze_preview: {
			timesheet_id: SHEET_ID,
			entries: [],
			over_cap_seconds: 0,
		},
		deciders_count: 2,
		...over,
	};
}

/** The same sheet as Maria reads it while it is submitted. */
export function memberDetail(
	over: Partial<TimesheetDetail> = {},
): TimesheetDetail {
	return {
		...deciderDetail(),
		viewer: { is_member: true, can_decide: false, actions: ["withdraw"] },
		freeze_preview: undefined,
		deciders: [{ id: DECIDER, display_name: "Ana Reyes" }],
		...over,
	};
}
