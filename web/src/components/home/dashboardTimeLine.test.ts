import { describe, expect, it } from "vitest";
import { DASHBOARD_DEMO_DATASET } from "@/lib/tours/demo/dashboardDemoDataset";
import type { ApprovalRow, TimesheetSummary } from "@/services/time.types";
import {
	approvalRowName,
	approvalRowSeconds,
	DASHBOARD_APPROVAL_ROWS,
	moreApprovalsText,
	policyWorkspaceTag,
	submitNudge,
	submittedAgo,
	TIME_APPROVALS_REVIEW_ALL,
	TIME_APPROVALS_TITLE,
	TIME_DEMO_KEYS,
	timesheetsWaitingText,
} from "./dashboardTimeLine";

const TZ = "Asia/Manila";
// Tue Oct 6, 2026, 11:00 in Manila.
const NOW = new Date("2026-10-06T03:00:00.000Z");

function sheet(over: Partial<TimesheetSummary> = {}): TimesheetSummary {
	return {
		id: "s1",
		member_user_id: "u1",
		member_display_name_snapshot: "Maria Santos",
		scope_kind: "team",
		scope_ref: "t1",
		team_id: "t1",
		workspace_id: null,
		engagement_id: null,
		scope_label_snapshot: "Prodigitality Services Inc. Team",
		policy_workspace_id: "w1",
		period_kind: "weekly",
		period_start: "2026-09-28",
		period_end: "2026-10-04",
		timezone: TZ,
		week_start: 1,
		status: "open",
		approver_scope: null,
		revision: 1,
		submitted_at: null,
		submitted_by: null,
		submission_kind: null,
		decided_at: null,
		decided_by: null,
		decision_kind: null,
		decision_note: null,
		overtime_approved: false,
		total_seconds: null,
		payable_seconds: null,
		origin: "app",
		created_at: "2026-09-28T01:00:00.000Z",
		updated_at: "2026-10-04T10:00:00.000Z",
		entry_count: 9,
		running_count: 0,
		logged_seconds: 28 * 3600 + 45 * 60,
		routing_preview: {
			approver_scope: "team",
			cost_money: false,
			deciders: [{ id: "a1", display_name: "Ana Reyes" }],
		},
		...over,
	};
}

function approval(over: Partial<ApprovalRow> = {}): ApprovalRow {
	return {
		...sheet({ status: "submitted", routing_preview: undefined }),
		submitted_at: "2026-10-05T02:00:00.000Z",
		total_seconds: 38 * 3600 + 15 * 60,
		member: { id: "u1", display_name: "Maria Santos", avatar_url: null },
		policy_workspace: { id: "w1", name: "Prodigitality Workspace" },
		...over,
	};
}

describe("copy", () => {
	it("uses the ux.md card and welcome-line words", () => {
		expect(TIME_APPROVALS_TITLE).toBe("Waiting for your approval");
		expect(TIME_APPROVALS_REVIEW_ALL).toBe("Review all");
		expect(timesheetsWaitingText(3)).toBe("3 timesheets waiting");
		expect(timesheetsWaitingText(1)).toBe("1 timesheet waiting");
		expect(timesheetsWaitingText(Number.NaN)).toBe("0 timesheets waiting");
		expect(moreApprovalsText(1)).toBe("+1 more");
		expect(DASHBOARD_APPROVAL_ROWS).toBe(2);
	});
});

describe("submittedAgo", () => {
	it("reads today, yesterday, N days ago, then the date", () => {
		const at = (iso: string) => submittedAgo(iso, { now: NOW, timezone: TZ });
		expect(at("2026-10-06T00:30:00.000Z")).toBe("today");
		expect(at("2026-10-05T03:00:00.000Z")).toBe("yesterday");
		expect(at("2026-10-04T03:00:00.000Z")).toBe("2 days ago");
		expect(at("2026-09-30T03:00:00.000Z")).toBe("6 days ago");
		expect(at("2026-09-28T03:00:00.000Z")).toBe("Sep 28");
		expect(at("2025-12-28T03:00:00.000Z")).toBe("Dec 28, 2025");
	});

	it("counts days in the reader's timezone", () => {
		// 23:30 UTC on Oct 5 is already Oct 6 in Manila.
		expect(
			submittedAgo("2026-10-05T23:30:00.000Z", { now: NOW, timezone: TZ }),
		).toBe("today");
		expect(
			submittedAgo("2026-10-05T23:30:00.000Z", { now: NOW, timezone: "UTC" }),
		).toBe("yesterday");
	});

	it("is empty when the sheet has no submit time", () => {
		expect(submittedAgo(null)).toBe("");
		expect(submittedAgo(undefined)).toBe("");
	});
});

describe("approval rows", () => {
	it("shows the total frozen at submit, else what is logged", () => {
		expect(approvalRowSeconds(approval())).toBe(38 * 3600 + 15 * 60);
		expect(
			approvalRowSeconds(approval({ total_seconds: null, logged_seconds: 60 })),
		).toBe(60);
	});

	it("names the member from the profile, then the snapshot", () => {
		expect(approvalRowName(approval())).toBe("Maria Santos");
		expect(
			approvalRowName(
				approval({ member: null, member_display_name_snapshot: "Leo Cruz" }),
			),
		).toBe("Leo Cruz");
		expect(
			approvalRowName(
				approval({ member: null, member_display_name_snapshot: null }),
			),
		).toBe("Someone");
	});

	it("tags a row only when its workspace is not the dashboard's (E27)", () => {
		const row = approval({ policy_workspace: { id: "w2", name: "Pixel" } });
		expect(policyWorkspaceTag(row, "w1")).toBe("Pixel");
		expect(policyWorkspaceTag(row, "w2")).toBeNull();
		// No current workspace: every row that has one is tagged.
		expect(policyWorkspaceTag(row, null)).toBe("Pixel");
		// Still loading: nothing is tagged yet.
		expect(policyWorkspaceTag(row, undefined)).toBeNull();
		expect(
			policyWorkspaceTag(approval({ policy_workspace: null }), "w1"),
		).toBeNull();
	});
});

describe("submitNudge", () => {
	it("nudges an overdue Open sheet of last week, with its hours", () => {
		const nudge = submitNudge([sheet()], { now: NOW });
		expect(nudge).toEqual({
			weekStart: "2026-09-28",
			seconds: 28 * 3600 + 45 * 60,
			text: "Submit last week (28h 45m)",
			sheetIds: ["s1"],
		});
	});

	it("leaves auto and self routed sheets alone: they send themselves", () => {
		for (const scope of ["auto", "self"] as const) {
			expect(
				submitNudge(
					[
						sheet({
							routing_preview: {
								approver_scope: scope,
								cost_money: false,
								deciders: [],
							},
						}),
					],
					{ now: NOW },
				),
			).toBeNull();
			expect(
				submitNudge(
					[sheet({ routing_preview: undefined, approver_scope: scope })],
					{ now: NOW },
				),
			).toBeNull();
		}
	});

	it("waits for the period to end in the sheet's own timezone", () => {
		// Ends today: "Open · until Oct 6", not overdue.
		expect(
			submitNudge(
				[sheet({ period_start: "2026-09-30", period_end: "2026-10-06" })],
				{ now: NOW },
			),
		).toBeNull();
		// Oct 5 has ended in Manila (UTC+8) but not yet in Honolulu (UTC-10).
		const ended = sheet({
			period_start: "2026-09-29",
			period_end: "2026-10-05",
		});
		expect(submitNudge([ended], { now: NOW })?.weekStart).toBe("2026-09-29");
		expect(
			submitNudge([{ ...ended, timezone: "Pacific/Honolulu" }], { now: NOW }),
		).toBeNull();
	});

	it("skips anything but Open, and Open sheets with no time", () => {
		for (const status of ["submitted", "returned", "approved"] as const) {
			expect(submitNudge([sheet({ status })], { now: NOW })).toBeNull();
		}
		expect(
			submitNudge([sheet({ logged_seconds: 0 })], { now: NOW }),
		).toBeNull();
		expect(submitNudge([], { now: NOW })).toBeNull();
		expect(submitNudge(null, { now: NOW })).toBeNull();
	});

	it("takes the latest overdue period and sums its sheets", () => {
		const nudge = submitNudge(
			[
				sheet({
					id: "old",
					period_start: "2026-09-14",
					period_end: "2026-09-20",
				}),
				sheet({ id: "team", logged_seconds: 20 * 3600 }),
				sheet({
					id: "agreement",
					scope_kind: "engagement",
					scope_label_snapshot: "Acme Corp",
					logged_seconds: 6 * 3600 + 30 * 60,
				}),
			],
			{ now: NOW },
		);
		expect(nudge?.weekStart).toBe("2026-09-28");
		expect(nudge?.sheetIds).toEqual(["team", "agreement"]);
		expect(nudge?.text).toBe("Submit last week (26h 30m)");
	});

	it("names the dates when the period is not last week", () => {
		// Two weeks back.
		expect(
			submitNudge(
				[sheet({ period_start: "2026-09-21", period_end: "2026-09-27" })],
				{ now: NOW, userTimezone: TZ },
			)?.text,
		).toBe("Submit Sep 21–27 (28h 45m)");
		// A monthly period.
		expect(
			submitNudge(
				[
					sheet({
						period_kind: "monthly",
						period_start: "2026-09-01",
						period_end: "2026-09-30",
						logged_seconds: 120 * 3600,
					}),
				],
				{ now: NOW, userTimezone: TZ },
			)?.text,
		).toBe("Submit Sep 1–30 (120h)");
	});
});

describe("tour fixtures", () => {
	it("are keyed the way the hook reads them, hours only", () => {
		const dataset = DASHBOARD_DEMO_DATASET as Record<string, unknown>;
		const approvals = dataset[TIME_DEMO_KEYS.approvals] as {
			total: number;
			rows: ApprovalRow[];
		};
		expect(approvals.total).toBe(3);
		expect(approvals.rows).toHaveLength(DASHBOARD_APPROVAL_ROWS);
		for (const row of approvals.rows) {
			expect(row.id.startsWith("tour-demo-")).toBe(true);
			expect(row.status).toBe("submitted");
		}
		expect(dataset[TIME_DEMO_KEYS.timesheets]).toEqual([]);
		expect(JSON.stringify(approvals)).not.toMatch(/amount|rate_snapshot/);
	});
});
