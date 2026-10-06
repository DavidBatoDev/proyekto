/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeApiError, timeService } from "@/services/time.service";
import type {
	ResolvedTimePolicy,
	TimeEntryView,
	TimesheetDetail,
	TimesheetRow,
	TimesheetSummary,
} from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));

import {
	SubmitSheetDialog,
	sheetDayTotals,
	sheetPolicyRef,
	submitChecks,
} from "./SubmitSheetDialog";

const MEMBER = "member-1";
const TZ = "Asia/Manila";
// Sun Oct 4 2026 in Manila: the last day of the Sep 28 – Oct 4 week.
const NOW = new Date("2026-10-04T03:00:00.000Z");

function sheet(over: Partial<TimesheetSummary> = {}): TimesheetSummary {
	return {
		id: "s1",
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
		period_start: "2026-09-28",
		period_end: "2026-10-04",
		timezone: TZ,
		week_start: 1,
		status: "open",
		approver_scope: null,
		revision: 2,
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
		updated_at: "2026-09-28T01:00:00.000Z",
		entry_count: 2,
		running_count: 0,
		logged_seconds: 0,
		...over,
	};
}

let entrySeq = 0;
/** An entry starting at `local` (Manila wall clock, "2026-09-28T09:00") lasting `hours`. */
function entry(
	local: string,
	hours: number,
	over: Partial<TimeEntryView> = {},
): TimeEntryView {
	entrySeq += 1;
	const start = new Date(`${local}:00+08:00`);
	const end = new Date(start.getTime() + hours * 3600_000);
	return {
		id: `e${entrySeq}`,
		context_kind: "team",
		context_ref: "t1",
		context_label_snapshot: "Prodigitality Services Inc. Team",
		timesheet_id: "s1",
		work_item: "task",
		started_at: start.toISOString(),
		ended_at: end.toISOString(),
		paused_at: null,
		duration_seconds: Math.round(hours * 3600),
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
		created_at: start.toISOString(),
		updated_at: end.toISOString(),
		timesheet: null,
		locked_reason: null,
		identity: "visible",
		member_user_id: MEMBER,
		member_display_name_snapshot: "Maria Santos",
		member: null,
		member_label: null,
		content: "visible",
		task_id: "task-1",
		note: null,
		task: {
			id: "task-1",
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

function detail(
	base: TimesheetSummary,
	entries: TimeEntryView[],
	over: Partial<TimesheetDetail> = {},
	actions: TimesheetDetail["viewer"]["actions"] = ["submit"],
): TimesheetDetail {
	const logged = entries.reduce((s, e) => s + (e.duration_seconds ?? 0), 0);
	return {
		sheet: {
			...base,
			entry_count: entries.length,
			running_count: entries.filter((e) => !e.ended_at).length,
			logged_seconds: logged,
		},
		entries,
		events: [],
		rules: null,
		routing: null,
		viewer: { is_member: true, can_decide: false, actions },
		...over,
	};
}

function policy(over: Partial<ResolvedTimePolicy> = {}): ResolvedTimePolicy {
	return {
		tracking_enabled: true,
		period_kind: "weekly",
		week_start: 1,
		timezone: TZ,
		period_anchor: null,
		approval_required: true,
		approver_scope: "team",
		allow_manual_entries: true,
		retroactive_days: null,
		rounding_minutes: 0,
		weekly_limit_minutes: null,
		reminder_days: 1,
		hidden_presets: [],
		tracking_mode: null,
		sources: {},
		plan: { time_tracking: true, time_team_rules: true },
		policy_workspace_id: "w1",
		team_override_applied: false,
		member: null,
		client_hours_detail_level: null,
		...over,
	};
}

let client: QueryClient;

function renderDialog(
	summary: TimesheetSummary,
	sheetDetail: TimesheetDetail,
	props: Partial<Parameters<typeof SubmitSheetDialog>[0]> = {},
) {
	vi.spyOn(timeService, "getTimesheet").mockResolvedValue(sheetDetail);
	client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const onClose = vi.fn();
	const onSubmitted = vi.fn();
	const view = render(
		<QueryClientProvider client={client}>
			<SubmitSheetDialog
				open
				onClose={onClose}
				onSubmitted={onSubmitted}
				sheet={summary}
				now={NOW}
				userTimezone={TZ}
				{...props}
			/>
		</QueryClientProvider>,
	);
	return { ...view, onClose, onSubmitted };
}

const submitButton = () =>
	screen.getByRole("button", {
		name: /^(Submit|Resubmit)$/,
	}) as HTMLButtonElement;

beforeEach(() => {
	entrySeq = 0;
	useAuthStore.setState({ user: { id: MEMBER } as never });
	vi.spyOn(timeService, "getProjectPolicy").mockResolvedValue(policy());
});

afterEach(() => {
	cleanup();
	client?.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe("SubmitSheetDialog", () => {
	it("shows who it goes to (A1), the days and the total, then submits with the fresh revision", async () => {
		const summary = sheet({
			routing_preview: {
				approver_scope: "team",
				cost_money: true,
				deciders: [{ id: "d1", display_name: "Ana Reyes" }],
			},
		});
		const entries = [
			entry("2026-09-28T09:00", 6.5),
			entry("2026-09-29T09:00", 7.25),
		];
		const sheetDetail = detail({ ...summary, revision: 5 }, entries);
		const submit = vi.spyOn(timeService, "submitTimesheet").mockResolvedValue({
			...sheetDetail.sheet,
			status: "submitted",
			approver_scope: "team",
		} as TimesheetRow);
		const { onClose, onSubmitted } = renderDialog(summary, sheetDetail);

		expect(screen.getByText("Submit timesheet")).toBeTruthy();
		expect(
			screen.getByText("Prodigitality Services Inc. Team · Sep 28–Oct 4"),
		).toBeTruthy();
		expect(screen.getByTestId("submit-goes-to").textContent).toBe(
			"Goes to Prodigitality Services Inc. Team's owners and admins",
		);
		const days = await screen.findByTestId("submit-days");
		expect(within(days).getAllByRole("listitem")).toHaveLength(7);
		expect(within(days).getByText("6:30")).toBeTruthy();
		expect(within(days).getByText("7:15")).toBeTruthy();
		expect(screen.getByTestId("submit-total").textContent).toBe("13:45");

		await waitFor(() => expect(submitButton().disabled).toBe(false));
		fireEvent.click(submitButton());
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(submit).toHaveBeenCalledWith("s1", { expected_revision: 5 });
		expect(onSubmitted).toHaveBeenCalledWith(
			expect.objectContaining({ id: "s1", status: "submitted" }),
		);
		expect(toast.success).toHaveBeenCalledWith(
			"Sent to Prodigitality Services Inc. Team's owners and admins for approval.",
		);
	});

	it("a hirer route names the person; an empty decider list says no one can approve", async () => {
		const hirer = sheet({
			scope_kind: "engagement",
			scope_label_snapshot: "Acme Corp",
			routing_preview: {
				approver_scope: "hirer",
				cost_money: true,
				deciders: [{ id: "d1", display_name: "Ana Reyes" }],
			},
		});
		const first = renderDialog(
			hirer,
			detail(hirer, [entry("2026-09-28T09:00", 2)]),
		);
		expect(screen.getByTestId("submit-goes-to").textContent).toBe(
			"Goes to Ana Reyes",
		);
		expect(
			screen.getByText("Acme Corp · agreement · Sep 28–Oct 4"),
		).toBeTruthy();
		first.unmount();

		const nobody = sheet({
			routing_preview: {
				approver_scope: "workspace",
				cost_money: false,
				deciders: [],
			},
		});
		renderDialog(nobody, detail(nobody, [entry("2026-09-28T09:00", 2)]));
		expect(screen.getByTestId("submit-goes-to").textContent).toBe(
			"No one else can approve this. Add a workspace admin.",
		);
	});

	it("a client agreement confirms instead of asking", () => {
		const auto = sheet({
			scope_kind: "engagement",
			scope_label_snapshot: "Acme Corp",
			routing_preview: {
				approver_scope: "auto",
				cost_money: false,
				deciders: [],
			},
		});
		renderDialog(auto, detail(auto, [entry("2026-09-28T09:00", 2)]));
		expect(screen.getByTestId("submit-goes-to").textContent).toBe(
			"Submitting confirms these hours for your agreement with Acme Corp.",
		);
	});

	it("a running timer blocks the submit", async () => {
		const summary = sheet();
		const running = entry("2026-10-04T09:00", 1, {
			ended_at: null,
			duration_seconds: null,
		});
		renderDialog(summary, detail(summary, [running], {}, []));
		expect(
			await screen.findByText(
				"A timer is still running on this timesheet. Stop it first.",
			),
		).toBeTruthy();
		expect(submitButton().disabled).toBe(true);
	});

	it("warnings must be ticked before Submit works", async () => {
		const summary = sheet();
		const long = entry("2026-09-30T08:00", 11);
		renderDialog(summary, detail(summary, [long]));
		const warnings = await screen.findByTestId("submit-warnings");
		const boxes = within(warnings).getAllByRole("checkbox");
		// 10h or longer, and a day over 8h.
		expect(boxes).toHaveLength(2);
		expect(
			within(warnings).getByText("1 entry ran 10h or longer."),
		).toBeTruthy();
		expect(
			within(warnings).getByText("Wed Sep 30 is over 8h (11h)."),
		).toBeTruthy();
		expect(submitButton().disabled).toBe(true);
		fireEvent.click(boxes[0]);
		expect(submitButton().disabled).toBe(true);
		fireEvent.click(boxes[1]);
		expect(submitButton().disabled).toBe(false);
	});

	it("over the agreement's weekly limit needs a tick and names the approver", async () => {
		const summary = sheet({
			scope_kind: "engagement",
			scope_label_snapshot: "Acme Corp",
			routing_preview: {
				approver_scope: "hirer",
				cost_money: true,
				deciders: [{ id: "d1", display_name: "Ana Reyes" }],
			},
		});
		const entries = ["28", "29", "30"].map((d) =>
			entry(`2026-09-${d}T09:00`, 7.25, {
				context_kind: "assignment",
				context_ref: "a1",
			}),
		);
		entries.push(
			...["01", "02", "03"].map((d) =>
				entry(`2026-10-${d}T09:00`, 7.25, {
					context_kind: "assignment",
					context_ref: "a1",
				}),
			),
		);
		const getPolicy = vi
			.spyOn(timeService, "getProjectPolicy")
			.mockResolvedValue(
				policy({
					weekly_limit_minutes: 2400,
					sources: { weekly_limit_minutes: "contract" },
				}),
			);
		renderDialog(summary, detail(summary, entries));
		expect(
			await screen.findByText(
				"Your agreement with Acme Corp allows 40h a week. You logged 43h 30m. The 3h 30m over needs Ana's approval.",
			),
		).toBeTruthy();
		expect(getPolicy).toHaveBeenCalledWith("p1", {
			kind: "assignment",
			id: "a1",
		});
	});

	it("a workspace policy limit is an indicator line, never a tick (D65)", async () => {
		const summary = sheet({
			scope_kind: "workspace",
			scope_label_snapshot: "Acme",
		});
		const entries = ["28", "29", "30"].map((d) =>
			entry(`2026-09-${d}T09:00`, 7, {
				context_kind: "workspace",
				context_ref: "w1",
			}),
		);
		vi.spyOn(timeService, "getProjectPolicy").mockResolvedValue(
			policy({
				weekly_limit_minutes: 1200,
				sources: { weekly_limit_minutes: "workspace" },
			}),
		);
		renderDialog(summary, detail(summary, entries));
		const info = await screen.findByTestId("submit-info");
		expect(info.textContent).toBe(
			"Acme has a 20h weekly limit. You've logged 21h this week.",
		);
		expect(screen.queryByTestId("submit-warnings")).toBeNull();
		await waitFor(() => expect(submitButton().disabled).toBe(false));
	});

	it("waits for the limits before Submit, so an over-limit tick can't be skipped", async () => {
		const summary = sheet({
			scope_kind: "engagement",
			scope_label_snapshot: "Acme Corp",
		});
		const entries = ["28", "29", "30", "01", "02", "03"].map((d) =>
			entry(`2026-${Number(d) > 20 ? "09" : "10"}-${d}T09:00`, 7.25, {
				context_kind: "assignment",
				context_ref: "a1",
			}),
		);
		let answer: (value: ResolvedTimePolicy) => void = () => {};
		vi.spyOn(timeService, "getProjectPolicy").mockReturnValue(
			new Promise<ResolvedTimePolicy>((resolve) => {
				answer = resolve;
			}),
		);
		renderDialog(summary, detail(summary, entries));
		await screen.findByTestId("submit-days");
		expect(screen.getByTestId("submit-limits-pending").textContent).toBe(
			"Checking limits…",
		);
		expect(submitButton().disabled).toBe(true);

		answer(
			policy({
				weekly_limit_minutes: 2400,
				sources: { weekly_limit_minutes: "contract" },
			}),
		);
		const warnings = await screen.findByTestId("submit-warnings");
		expect(screen.queryByTestId("submit-limits-pending")).toBeNull();
		expect(submitButton().disabled).toBe(true);
		fireEvent.click(within(warnings).getByRole("checkbox"));
		await waitFor(() => expect(submitButton().disabled).toBe(false));
	});

	it("a failed policy read still lets the sheet go (the server re-checks)", async () => {
		const summary = sheet();
		vi.spyOn(timeService, "getProjectPolicy").mockRejectedValue(
			new TimeApiError({
				status: 403,
				code: "missing_permission",
				message: "x",
			}),
		);
		renderDialog(summary, detail(summary, [entry("2026-09-28T09:00", 2)]));
		await waitFor(() => expect(submitButton().disabled).toBe(false));
		expect(screen.queryByTestId("submit-limits-pending")).toBeNull();
	});

	it("before the last day the server's answer explains why not yet", async () => {
		const summary = sheet();
		renderDialog(
			summary,
			detail(summary, [entry("2026-09-28T09:00", 2)], {}, []),
			{
				now: new Date("2026-10-01T03:00:00.000Z"),
			},
		);
		expect(
			await screen.findByText(
				"You can submit this timesheet from Oct 4, its last day.",
			),
		).toBeTruthy();
		expect(submitButton().disabled).toBe(true);
	});

	it("a returned sheet resubmits", async () => {
		const summary = sheet({ status: "returned", approver_scope: "team" });
		renderDialog(summary, detail(summary, [entry("2026-09-28T09:00", 2)]));
		expect(screen.getByText("Resubmit timesheet")).toBeTruthy();
		await waitFor(() => expect(submitButton().disabled).toBe(false));
		expect(submitButton().textContent).toBe("Resubmit");
	});

	it("a stale revision shows the banner and Review the latest refetches", async () => {
		const summary = sheet();
		const sheetDetail = detail(summary, [entry("2026-09-28T09:00", 2)]);
		vi.spyOn(timeService, "submitTimesheet").mockRejectedValue(
			new TimeApiError({
				status: 409,
				code: "STALE_REVISION",
				message: "x",
				extras: { timesheet_id: "s1", expected: 2, actual: 3 },
			}),
		);
		const { onClose } = renderDialog(summary, sheetDetail);
		await waitFor(() => expect(submitButton().disabled).toBe(false));
		fireEvent.click(submitButton());
		const banner = await screen.findByTestId("stale-revision-banner");
		expect(banner.textContent).toContain(
			"This timesheet changed while you were looking.",
		);
		const getTimesheet = vi.mocked(timeService.getTimesheet);
		const before = getTimesheet.mock.calls.length;
		fireEvent.click(
			within(banner).getByRole("button", { name: "Review the latest" }),
		);
		await waitFor(() =>
			expect(getTimesheet.mock.calls.length).toBeGreaterThan(before),
		);
		expect(screen.queryByTestId("stale-revision-banner")).toBeNull();
		expect(onClose).not.toHaveBeenCalled();
	});

	it("a failed read offers Try again and keeps Submit off", async () => {
		const summary = sheet();
		// A 4xx is never retried, so the card shows at once.
		vi.spyOn(timeService, "getTimesheet").mockRejectedValue(
			new TimeApiError({
				status: 404,
				code: "TIMESHEET_NOT_FOUND",
				message: "x",
			}),
		);
		client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={client}>
				<SubmitSheetDialog open onClose={vi.fn()} sheet={summary} now={NOW} />
			</QueryClientProvider>,
		);
		expect(
			await screen.findByText(
				"This timesheet doesn't exist or you can't open it.",
			),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
		expect(submitButton().disabled).toBe(true);
	});
});

describe("submitChecks", () => {
	const base = sheet();

	it("flags an auto-stopped entry with its own sentence, and several together", () => {
		const one = submitChecks({
			sheet: base,
			entries: [
				entry("2026-09-28T09:00", 2, { flagged_reason: "auto_stopped_24h" }),
			],
			actions: ["submit"],
			now: NOW,
		});
		expect(one.warnings.map((w) => w.text)).toContain(
			"Stopped automatically after 24 hours. Check the end time.",
		);
		const two = submitChecks({
			sheet: base,
			entries: [
				entry("2026-09-28T09:00", 2, { flagged_reason: "auto_stopped_24h" }),
				entry("2026-09-29T09:00", 2, {
					flagged_reason: "stopped_by_assignment_end",
				}),
			],
			actions: ["submit"],
			now: NOW,
		});
		expect(two.warnings.map((w) => w.text)).toContain(
			"2 entries were stopped automatically. Check their end times.",
		);
	});

	it("counts entries added after their day", () => {
		const checks = submitChecks({
			sheet: base,
			entries: [
				entry("2026-09-28T09:00", 2, {
					source: "manual",
					created_at: "2026-09-30T02:00:00.000Z",
				}),
				entry("2026-09-29T09:00", 2),
			],
			actions: ["submit"],
			now: NOW,
		});
		expect(checks.warnings.find((w) => w.id === "late")?.text).toBe(
			"1 entry was added after its day.",
		);
	});

	it("an empty sheet is a blocker; a member over a weekly cap needs a tick", () => {
		expect(
			submitChecks({
				sheet: { ...base, entry_count: 0 },
				entries: [],
				actions: [],
			}).blockers,
		).toEqual(["There's no time on this timesheet to send."]);
		const capped = submitChecks({
			sheet: base,
			entries: [entry("2026-09-28T09:00", 6), entry("2026-09-29T09:00", 6)],
			actions: ["submit"],
			policy: policy({
				member: {
					weekly_limit_hours: 10,
					monthly_limit_hours: null,
					overtime_requires_approval: true,
				},
			}),
			now: NOW,
		});
		expect(capped.warnings.find((w) => w.id === "member_cap")).toEqual({
			id: "member_cap",
			text: "Your weekly limit for Prodigitality Services Inc. Team is 10h. You logged 12h. The 2h over needs approval.",
			ack: true,
		});
	});

	it("day totals follow the sheet's timezone", () => {
		// 23:30 UTC on Sep 28 is Sep 29 in Manila.
		const late = entry("2026-09-29T07:30", 1);
		const { days, totalSeconds } = sheetDayTotals(base, [late]);
		expect(days.find((d) => d.date === "2026-09-29")?.seconds).toBe(3600);
		expect(totalSeconds).toBe(3600);
	});

	it("reads a policy only for weekly sheets with a governed entry", () => {
		expect(sheetPolicyRef(base, [entry("2026-09-28T09:00", 1)])).toEqual({
			projectId: "p1",
			forRef: { kind: "team", id: "t1" },
		});
		expect(
			sheetPolicyRef({ period_kind: "monthly" }, [
				entry("2026-09-28T09:00", 1),
			]),
		).toBeNull();
		expect(
			sheetPolicyRef(base, [
				entry("2026-09-28T09:00", 1, {
					context_kind: "personal",
					context_ref: null,
				}),
			]),
		).toBeNull();
	});
});
