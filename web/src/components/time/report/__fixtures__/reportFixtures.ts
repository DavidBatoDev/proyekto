// Test data for the report kit's suites (never imported by app code).

import type {
	ReportSummary,
	ReportSummaryGroup,
	TimeEntryView,
} from "@/services/time.types";

export const U1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const U2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const TEAM_ID = "11111111-1111-4111-8111-111111111111";
export const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
export const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
export const ENGAGEMENT_ID = "44444444-4444-4444-8444-444444444444";

/** Tue Oct 6 2026, 18:00 in Manila. */
export const NOW = new Date("2026-10-06T10:00:00.000Z");

export function group(over: Partial<ReportSummaryGroup>): ReportSummaryGroup {
	return {
		key: "k",
		label: "Label",
		total_seconds: 0,
		payable_seconds: 0,
		...over,
	};
}

export function summary(over: Partial<ReportSummary> = {}): ReportSummary {
	return {
		scope: { kind: "team", id: TEAM_ID },
		timezone: "Asia/Manila",
		total_seconds: 0,
		payable_seconds: 0,
		groups: [],
		sheet_status_counts: { open: 0, submitted: 0, returned: 0, approved: 0 },
		...over,
	};
}

export function entry(over: Partial<TimeEntryView> = {}): TimeEntryView {
	return {
		id: "e1",
		context_kind: "team",
		context_ref: "t1",
		context_label_snapshot: "Design",
		timesheet_id: "s1",
		work_item: "task",
		started_at: "2026-10-05T01:00:00.000Z",
		ended_at: "2026-10-05T02:00:00.000Z",
		paused_at: null,
		duration_seconds: 3600,
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
		workspace_id: null,
		engagement_assignment_id: null,
		created_at: "2026-10-05T02:00:00.000Z",
		updated_at: "2026-10-05T02:00:00.000Z",
		timesheet: null,
		locked_reason: null,
		identity: "visible",
		member_user_id: U1,
		member_display_name_snapshot: "Maria Santos",
		member: { id: U1, display_name: "Maria Santos", avatar_url: null },
		member_label: null,
		content: "visible",
		task_id: "task1",
		note: null,
		task: {
			id: "task1",
			title: "Fix login bug",
			work_type: null,
			status: null,
		},
		project: { id: "p1", title: "Acme Website" },
		content_label: null,
		cost: "hidden",
		...over,
	};
}

/** A placed talent's agreement entry, masked from the viewer. */
export function maskedAgreementEntry(
	over: Partial<TimeEntryView> = {},
): TimeEntryView {
	return entry({
		context_kind: "assignment",
		context_ref: "as1",
		context_label_snapshot: "Acme Corp",
		identity: "masked",
		member_user_id: null,
		member: null,
		member_display_name_snapshot: null,
		member_label: "Delivery team",
		...over,
	});
}
