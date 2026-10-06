/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));

import { timeKeys } from "@/queries/time";
import { TimeApiError, timeService } from "@/services/time.service";
import type {
	EntryWithWarnings,
	LoggingForResult,
	LoggingOption,
	ResolvedTimePolicy,
	TimeEntryView,
	TimesheetDetail,
	TimesheetRow,
} from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import {
	type CreateEntryRequest,
	contextTimezone,
	createEntryBody,
	dayAt,
	defaultEntryStart,
	deriveForChoice,
	entryAddedToast,
	forRequestFields,
	fromWallClock,
	manualEntryRule,
	toWallClock,
	useCreateEntry,
	useEntryContext,
} from "./useCreateEntry";

const USER = "user-1";
const PROJECT = "p1";
const TEAM = "11111111-1111-4111-8111-111111111111";
const ASG = "33333333-3333-4333-8333-333333333333";
const SHEET = "44444444-4444-4444-8444-444444444444";

function option(
	kind: LoggingOption["kind"],
	id: string | null,
	label: string,
): LoggingOption {
	return {
		kind,
		id,
		label,
		sheet_scope: kind === "personal" ? null : { kind: "workspace", ref: "w" },
		rate_source: "none",
		workspace_tag: null,
		approver_hint: kind === "assignment" ? "hirer" : "workspace",
	};
}

const team = option("team", TEAM, "Prodigitality Services Inc. Team");
const agreement = option("assignment", ASG, "Acme Corp");
const personal = option("personal", null, "Just me");

function forResult(over: Partial<LoggingForResult>): LoggingForResult {
	return {
		options: [],
		selected: null,
		prefill: null,
		unavailable: [],
		...over,
	};
}

function policy(over: Partial<ResolvedTimePolicy> = {}): ResolvedTimePolicy {
	return {
		tracking_enabled: true,
		period_kind: "weekly",
		week_start: 1,
		timezone: "Asia/Manila",
		period_anchor: null,
		approval_required: true,
		approver_scope: "workspace",
		allow_manual_entries: true,
		retroactive_days: null,
		rounding_minutes: 0,
		weekly_limit_minutes: null,
		reminder_days: 1,
		hidden_presets: [],
		tracking_mode: null,
		sources: {},
		plan: { time_tracking: true, time_team_rules: false },
		policy_workspace_id: "w",
		team_override_applied: false,
		member: null,
		client_hours_detail_level: null,
		...over,
	};
}

function created(over: Partial<TimeEntryView> = {}): EntryWithWarnings {
	return {
		id: "e-new",
		context_kind: "team",
		context_ref: TEAM,
		context_label_snapshot: "Prodigitality Services Inc. Team",
		timesheet_id: null,
		work_item: "task",
		started_at: "2026-10-05T01:00:00.000Z",
		ended_at: "2026-10-05T02:30:00.000Z",
		paused_at: null,
		duration_seconds: 5400,
		break_seconds: 0,
		break_minutes: 0,
		payable_seconds: null,
		source: "manual",
		work_type_snapshot: "real_work",
		legacy_status: null,
		payout_id: null,
		flagged_reason: null,
		project_id: PROJECT,
		team_id: TEAM,
		workspace_id: null,
		engagement_assignment_id: null,
		created_at: "2026-10-06T00:00:00.000Z",
		updated_at: "2026-10-06T00:00:00.000Z",
		timesheet: null,
		locked_reason: null,
		identity: "visible",
		member_user_id: USER,
		member_display_name_snapshot: "Maria",
		member: null,
		member_label: null,
		content: "visible",
		task_id: "t1",
		note: null,
		task: { id: "t1", title: "Fix login bug", work_type: null, status: null },
		project: { id: PROJECT, title: "Acme Website" },
		content_label: null,
		cost: "hidden",
		...over,
		warnings: [],
	};
}

function sheetDetail(over: Partial<TimesheetRow> = {}): TimesheetDetail {
	return {
		sheet: {
			id: SHEET,
			member_user_id: USER,
			member_display_name_snapshot: "Maria",
			scope_kind: "workspace",
			scope_ref: "w",
			team_id: null,
			workspace_id: "w",
			engagement_id: null,
			scope_label_snapshot: "Prodigitality",
			policy_workspace_id: "w",
			period_kind: "weekly",
			period_start: "2026-09-28",
			period_end: "2026-10-04",
			timezone: "Asia/Manila",
			week_start: 1,
			status: "submitted",
			approver_scope: "workspace",
			revision: 3,
			submitted_at: "2026-10-05T01:00:00Z",
			submitted_by: USER,
			submission_kind: "manual",
			decided_at: null,
			decided_by: null,
			decision_kind: null,
			decision_note: null,
			overtime_approved: false,
			total_seconds: 3600,
			payable_seconds: null,
			origin: "app",
			created_at: "2026-09-28T00:00:00Z",
			updated_at: "2026-10-05T01:00:00Z",
			entry_count: 1,
			running_count: 0,
			logged_seconds: 3600,
			...over,
		},
		entries: [],
		events: [],
		rules: null,
		routing: null,
		viewer: { is_member: true, can_decide: false, actions: ["withdraw"] },
	};
}

const apiError = (
	status: number,
	code: string,
	extras: Record<string, unknown> = {},
	message = "server copy",
) => new TimeApiError({ status, code: code as never, message, extras });

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
	return createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	useAuthStore.setState({ user: { id: USER } as never });
});

afterEach(() => {
	cleanup();
	client.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

const baseRequest: CreateEntryRequest = {
	projectId: PROJECT,
	taskId: "t1",
	startedAt: "2026-10-05T01:00:00.000Z",
	endedAt: "2026-10-05T02:30:00.000Z",
	loggingFor: { kind: "team", id: TEAM },
	autoChoice: true,
	forLabel: team.label,
	forKind: "team",
};

// ── Pure helpers ────────────────────────────────────────────────────────────

describe("wall clock in a timezone", () => {
	it("reads and writes the form's yyyy-MM-ddTHH:mm in the context's timezone", () => {
		const at = fromWallClock("2026-10-05T09:00", "Asia/Manila");
		expect(at?.toISOString()).toBe("2026-10-05T01:00:00.000Z");
		expect(toWallClock("2026-10-05T01:00:00.000Z", "America/New_York")).toBe(
			"2026-10-04T21:00",
		);
		expect(fromWallClock("2026-02-30T09:00", "UTC")).toBeNull();
		expect(fromWallClock("9:00", "UTC")).toBeNull();
		expect(toWallClock(null, "UTC")).toBe("");
	});

	it("puts 09:00 on the day in that timezone", () => {
		expect(dayAt("2026-10-05", "Asia/Manila").toISOString()).toBe(
			"2026-10-05T01:00:00.000Z",
		);
	});
});

describe("defaultEntryStart", () => {
	const tz = "Asia/Manila";

	it("starts at 09:00 in the context's timezone on a day with no entry", () => {
		expect(
			defaultEntryStart({ day: "2026-10-05", timezone: tz }).toISOString(),
		).toBe("2026-10-05T01:00:00.000Z");
	});

	it("starts at the end of that day's last finished entry", () => {
		const entries = [
			// 09:00–12:30 Manila
			{
				started_at: "2026-10-05T01:00:00.000Z",
				ended_at: "2026-10-05T04:30:00.000Z",
			},
			// 13:00–14:00 Manila: the last
			{
				started_at: "2026-10-05T05:00:00.000Z",
				ended_at: "2026-10-05T06:00:00.000Z",
			},
			// the day before (23:00 Manila on Oct 4)
			{
				started_at: "2026-10-04T15:00:00.000Z",
				ended_at: "2026-10-04T23:00:00.000Z",
			},
			// running: no end yet
			{ started_at: "2026-10-05T07:00:00.000Z", ended_at: null },
		];
		expect(
			defaultEntryStart({
				day: "2026-10-05",
				timezone: tz,
				entries,
			}).toISOString(),
		).toBe("2026-10-05T06:00:00.000Z");
	});

	it("counts days in the context's timezone, not UTC", () => {
		// 16:30Z on Oct 4 is 00:30 on Oct 5 in Manila.
		const entries = [
			{
				started_at: "2026-10-04T16:30:00.000Z",
				ended_at: "2026-10-04T17:30:00.000Z",
			},
		];
		expect(
			defaultEntryStart({
				day: "2026-10-05",
				timezone: tz,
				entries,
			}).toISOString(),
		).toBe("2026-10-04T17:30:00.000Z");
		expect(
			defaultEntryStart({
				day: "2026-10-04",
				timezone: "UTC",
				entries,
			}).toISOString(),
		).toBe("2026-10-04T17:30:00.000Z");
	});
});

describe("manualEntryRule", () => {
	const now = new Date("2026-10-06T04:00:00.000Z"); // Oct 6, 12:00 Manila

	it("is open for Just me (no policy) and before a choice", () => {
		expect(
			manualEntryRule({
				policy: policy({ allow_manual_entries: false }),
				option: personal,
				day: "2026-01-01",
				timezone: "UTC",
				now,
			}).blocked,
		).toBe(false);
		expect(
			manualEntryRule({
				policy: null,
				option: team,
				day: null,
				timezone: "UTC",
			}).blocked,
		).toBe(false);
	});

	it("MANUAL_ENTRIES_DISABLED: the ux sentence, agreement or not", () => {
		const off = policy({ allow_manual_entries: false });
		expect(
			manualEntryRule({
				policy: off,
				option: agreement,
				day: "2026-10-06",
				timezone: "Asia/Manila",
				now,
			}),
		).toMatchObject({
			blocked: true,
			reason: "manual_off",
			message: "Manual time is off in your agreement with Acme Corp.",
		});
		expect(
			manualEntryRule({
				policy: off,
				option: team,
				day: "2026-10-06",
				timezone: "Asia/Manila",
				now,
			}).message,
		).toBe("Manual time is off for Prodigitality Services Inc. Team.");
	});

	it("RETROACTIVE_WINDOW: older than the floor in the context's timezone", () => {
		const window = policy({ retroactive_days: 7 });
		const inside = manualEntryRule({
			policy: window,
			option: team,
			day: "2026-09-29",
			timezone: "Asia/Manila",
			now,
		});
		expect(inside).toMatchObject({ blocked: false, floor: "2026-09-29" });
		expect(
			manualEntryRule({
				policy: window,
				option: team,
				day: "2026-09-28",
				timezone: "Asia/Manila",
				now,
			}),
		).toMatchObject({
			blocked: true,
			reason: "retroactive",
			message:
				"Prodigitality Services Inc. Team accepts time up to 7 days back.",
		});
		expect(
			manualEntryRule({
				policy: policy({ retroactive_days: 0 }),
				option: team,
				day: "2001-01-01",
				timezone: "UTC",
				now,
			}).blocked,
		).toBe(false);
	});
});

describe("deriveForChoice", () => {
	it("0 options: nothing to choose", () => {
		expect(deriveForChoice(forResult({}), null, null)).toMatchObject({
			mode: "none",
			option: null,
			needsChoice: false,
		});
	});

	it("1 option: picked automatically and never sent", () => {
		expect(
			deriveForChoice(
				forResult({ options: [team], selected: team }),
				null,
				null,
			),
		).toMatchObject({
			mode: "single",
			option: team,
			choice: { kind: "team", id: TEAM },
			autoChoice: true,
			remember: false,
		});
	});

	it("2+ with nothing remembered: asks, and remembers the first choice", () => {
		const result = forResult({ options: [team, agreement] });
		expect(deriveForChoice(result, null, null)).toMatchObject({
			mode: "choose",
			option: null,
			needsChoice: true,
		});
		expect(
			deriveForChoice(result, { kind: "assignment", id: ASG }, null),
		).toMatchObject({
			option: agreement,
			remember: true,
			autoChoice: false,
			isPrefill: false,
		});
	});

	it("2+ with a remembered default: preselected, not remembered again, one tap confirms", () => {
		const result = forResult({
			options: [team, agreement],
			prefill: agreement,
		});
		expect(deriveForChoice(result, null, null)).toMatchObject({
			mode: "confirm",
			option: agreement,
			remember: false,
			isPrefill: true,
			needsChoice: false,
		});
		// Another pick is remembered by default; the person can untick it.
		expect(
			deriveForChoice(result, { kind: "team", id: TEAM }, null).remember,
		).toBe(true);
		expect(
			deriveForChoice(result, { kind: "team", id: TEAM }, false).remember,
		).toBe(false);
	});

	it("a stale pick falls back to the preselection", () => {
		const result = forResult({ options: [team, agreement], prefill: team });
		expect(
			deriveForChoice(result, { kind: "workspace", id: "gone" }, null).option,
		).toBe(team);
	});
});

describe("createEntryBody", () => {
	it("never sends the only option", () => {
		const body = createEntryBody(baseRequest);
		expect(body).toEqual({
			project_id: PROJECT,
			task_id: "t1",
			started_at: baseRequest.startedAt,
			ended_at: baseRequest.endedAt,
		});
	});

	it("sends a chosen option, remember, a preset, the break and the note", () => {
		expect(
			createEntryBody({
				...baseRequest,
				taskId: null,
				workItem: "meeting",
				autoChoice: false,
				loggingFor: { kind: "assignment", id: ASG },
				remember: true,
				breakSeconds: 900,
				note: "  standup  ",
			}),
		).toEqual({
			project_id: PROJECT,
			work_item: "meeting",
			started_at: baseRequest.startedAt,
			ended_at: baseRequest.endedAt,
			break_seconds: 900,
			note: "standup",
			logging_for: { kind: "assignment", id: ASG },
			remember: true,
		});
	});

	it("a task wins over a preset (never both)", () => {
		const body = createEntryBody({ ...baseRequest, workItem: "review" });
		expect(body).not.toHaveProperty("work_item");
	});

	it("forRequestFields reads a ForChoice", () => {
		expect(
			forRequestFields({
				choice: { kind: "assignment", id: ASG },
				remember: true,
				autoChoice: false,
				option: agreement,
			}),
		).toEqual({
			loggingFor: { kind: "assignment", id: ASG },
			remember: true,
			autoChoice: false,
			forLabel: "Acme Corp",
			forKind: "assignment",
		});
	});
});

describe("contextTimezone and the toast", () => {
	it("uses the context's policy timezone, and the person's own for Just me", () => {
		expect(
			contextTimezone(team, { timezone: "Asia/Manila" }, "Europe/Paris"),
		).toBe("Asia/Manila");
		expect(contextTimezone(personal, { timezone: "UTC" }, "Europe/Paris")).toBe(
			"Europe/Paris",
		);
		expect(contextTimezone(team, null, "Europe/Paris")).toBe("Europe/Paris");
		expect(contextTimezone(team, { timezone: "Not/AZone" }, "UTC")).toBe("UTC");
	});

	it("names the time added", () => {
		expect(entryAddedToast({ duration_seconds: 5400 })).toBe("Added 1h 30m.");
		expect(entryAddedToast({ duration_seconds: null })).toBe("Time added.");
	});
});

// ── Hooks ───────────────────────────────────────────────────────────────────

describe("useEntryContext", () => {
	it("reads the For options, then the chosen option's policy and timezone", async () => {
		vi.spyOn(timeService, "getPreferences").mockResolvedValue(null);
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		const policySpy = vi
			.spyOn(timeService, "getProjectPolicy")
			.mockResolvedValue(policy({ timezone: "America/New_York" }));
		const { result } = renderHook(() => useEntryContext(PROJECT), { wrapper });
		await waitFor(() => expect(result.current.policy).not.toBeNull());
		expect(policySpy).toHaveBeenCalledWith(PROJECT, { kind: "team", id: TEAM });
		expect(result.current.timezone).toBe("America/New_York");
		expect(result.current.forChoice.autoChoice).toBe(true);
	});

	it("Just me reads no policy and counts days in the person's own timezone", async () => {
		vi.spyOn(timeService, "getPreferences").mockResolvedValue({
			user_id: USER,
			timezone: "Europe/Paris",
			week_start: 1,
			updated_at: "2026-10-01T00:00:00Z",
		});
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [personal], selected: personal }),
		);
		const policySpy = vi.spyOn(timeService, "getProjectPolicy");
		const { result } = renderHook(() => useEntryContext(PROJECT), { wrapper });
		await waitFor(() => expect(result.current.timezone).toBe("Europe/Paris"));
		expect(policySpy).not.toHaveBeenCalled();
		expect(result.current.policy).toBeNull();
	});
});

describe("useCreateEntry", () => {
	it("creates, refreshes the time caches and toasts the warnings", async () => {
		const create = vi.spyOn(timeService, "createEntry").mockResolvedValue({
			...created(),
			warnings: [
				{
					code: "POLICY_WEEKLY_LIMIT",
					limit_minutes: 2400,
					logged_minutes: 2460,
					label: "Prodigitality",
				},
			],
		});
		const onCreated = vi.fn();
		const invalidate = vi.spyOn(client, "invalidateQueries");
		const { result } = renderHook(() => useCreateEntry({ onCreated }), {
			wrapper,
		});
		let outcome: unknown;
		await act(async () => {
			outcome = await result.current.create(baseRequest);
		});
		expect(outcome).toBe("created");
		expect(create).toHaveBeenCalledWith(createEntryBody(baseRequest));
		expect(toast.success).toHaveBeenCalledWith("Added 1h 30m.");
		expect(toast.warning).toHaveBeenCalledTimes(1);
		expect(String(toast.warning.mock.calls[0][0])).toMatch(/weekly limit/);
		expect(onCreated).toHaveBeenCalled();
		expect(invalidate).toHaveBeenCalledWith({
			queryKey: ["time", "me", "entries"],
		});
		expect(result.current.state.status).toBe("idle");
	});

	it("LOGGING_FOR_REQUIRED: the server's options replace the cached ones and the form asks", async () => {
		client.setQueryData(
			timeKeys.loggingFor(PROJECT),
			forResult({ options: [team], selected: team }),
		);
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team, agreement] }),
		);
		vi.spyOn(timeService, "createEntry").mockRejectedValue(
			apiError(409, "LOGGING_FOR_REQUIRED", {
				options: [team, agreement],
				prefill: agreement,
			}),
		);
		const { result } = renderHook(() => useCreateEntry(), { wrapper });
		let outcome: unknown;
		await act(async () => {
			outcome = await result.current.create(baseRequest);
		});
		expect(outcome).toBe("pick");
		expect(result.current.state.status).toBe("pick");
		expect(result.current.state.error?.message).toBe(
			"Choose who this time is for.",
		);
		const cached = client.getQueryData<LoggingForResult>(
			timeKeys.loggingFor(PROJECT),
		);
		expect(cached?.options).toHaveLength(2);
	});

	it("MANUAL_ENTRIES_DISABLED and RETROACTIVE_WINDOW read inline, with the context's label", async () => {
		const create = vi
			.spyOn(timeService, "createEntry")
			.mockRejectedValueOnce(apiError(403, "MANUAL_ENTRIES_DISABLED"))
			.mockRejectedValueOnce(
				apiError(422, "RETROACTIVE_WINDOW", { earliest_date: "2026-09-29" }),
			);
		const { result } = renderHook(() => useCreateEntry(), { wrapper });
		await act(async () => {
			await result.current.create({
				...baseRequest,
				forLabel: "Acme Corp",
				forKind: "assignment",
			});
		});
		expect(result.current.state).toMatchObject({
			status: "error",
			error: {
				code: "MANUAL_ENTRIES_DISABLED",
				message: "Manual time is off in your agreement with Acme Corp.",
			},
		});
		await act(async () => {
			await result.current.create({ ...baseRequest, retroactiveDays: 7 });
		});
		expect(result.current.state.error?.message).toBe(
			"Prodigitality Services Inc. Team accepts time up to 7 days back.",
		);
		expect(create).toHaveBeenCalledTimes(2);
		expect(toast.error).not.toHaveBeenCalled();
	});

	it("never prints class-validator text", async () => {
		vi.spyOn(timeService, "createEntry").mockRejectedValue(
			apiError(
				400,
				"HTTP_400",
				{},
				"note must be shorter than or equal to 2000 characters",
			),
		);
		const { result } = renderHook(() => useCreateEntry(), { wrapper });
		await act(async () => {
			await result.current.create(baseRequest);
		});
		expect(result.current.state.error?.message).not.toMatch(/must be/);
	});

	it("TIMESHEET_LOCKED {period}: names the sheet, withdraws it, then adds the same entry", async () => {
		const create = vi
			.spyOn(timeService, "createEntry")
			.mockRejectedValueOnce(
				apiError(409, "TIMESHEET_LOCKED", {
					reason: "period",
					timesheet_id: SHEET,
					sheet_status: "submitted",
				}),
			)
			.mockResolvedValueOnce(created());
		const getSheet = vi
			.spyOn(timeService, "getTimesheet")
			.mockResolvedValue(sheetDetail());
		const withdraw = vi
			.spyOn(timeService, "withdrawTimesheet")
			.mockResolvedValue(sheetDetail().sheet);
		const { result } = renderHook(() => useCreateEntry(), { wrapper });
		await act(async () => {
			await result.current.create(baseRequest);
		});
		expect(result.current.state.status).toBe("locked");
		await waitFor(() =>
			expect(result.current.state.locked?.message).toBe(
				"This week's Prodigitality timesheet is submitted. Withdraw it to add time.",
			),
		);
		expect(result.current.state.locked?.canWithdraw).toBe(true);

		let outcome: unknown;
		await act(async () => {
			outcome = await result.current.withdrawAndRetry();
		});
		expect(outcome).toBe("created");
		expect(withdraw).toHaveBeenCalledWith(SHEET, { expected_revision: 3 });
		expect(getSheet).toHaveBeenCalled();
		expect(create).toHaveBeenCalledTimes(2);
		expect(create.mock.calls[1][0]).toEqual(create.mock.calls[0][0]);
		expect(toast.success).toHaveBeenCalledWith(
			"Withdrawn. You can edit again.",
		);
		expect(result.current.state.status).toBe("idle");
	});

	it("withdraw retries once on STALE_REVISION", async () => {
		vi.spyOn(timeService, "createEntry")
			.mockRejectedValueOnce(
				apiError(409, "TIMESHEET_LOCKED", {
					reason: "period",
					timesheet_id: SHEET,
					sheet_status: "submitted",
				}),
			)
			.mockResolvedValueOnce(created());
		vi.spyOn(timeService, "getTimesheet")
			.mockResolvedValueOnce(sheetDetail())
			.mockResolvedValueOnce(sheetDetail({ revision: 3 }))
			.mockResolvedValueOnce(sheetDetail({ revision: 4 }));
		const withdraw = vi
			.spyOn(timeService, "withdrawTimesheet")
			.mockRejectedValueOnce(
				apiError(409, "STALE_REVISION", { timesheet_id: SHEET }),
			)
			.mockResolvedValueOnce(sheetDetail().sheet);
		const { result } = renderHook(() => useCreateEntry(), { wrapper });
		await act(async () => {
			await result.current.create(baseRequest);
		});
		await waitFor(() =>
			expect(result.current.state.locked?.label).toBe("Prodigitality"),
		);
		await act(async () => {
			await result.current.withdrawAndRetry();
		});
		expect(withdraw).toHaveBeenCalledTimes(2);
		expect(withdraw.mock.calls[1][1]).toEqual({ expected_revision: 4 });
	});

	it("an approved period offers no Withdraw", async () => {
		vi.spyOn(timeService, "createEntry").mockRejectedValue(
			apiError(409, "TIMESHEET_LOCKED", {
				reason: "period",
				timesheet_id: SHEET,
				sheet_status: "approved",
			}),
		);
		vi.spyOn(timeService, "getTimesheet").mockResolvedValue(
			sheetDetail({ status: "approved" }),
		);
		const { result } = renderHook(() => useCreateEntry(), { wrapper });
		await act(async () => {
			await result.current.create(baseRequest);
		});
		await waitFor(() =>
			expect(result.current.state.locked?.message).toBe(
				"This week's Prodigitality timesheet is approved, so its time can't change.",
			),
		);
		expect(result.current.state.locked?.canWithdraw).toBe(false);
		let outcome: unknown;
		await act(async () => {
			outcome = await result.current.withdrawAndRetry();
		});
		expect(outcome).toBe("ignored");
	});

	it("ignores a second create while one is saving, and reset clears the inline state", async () => {
		let resolve!: (row: EntryWithWarnings) => void;
		vi.spyOn(timeService, "createEntry").mockImplementation(
			() =>
				new Promise<EntryWithWarnings>((res) => {
					resolve = res;
				}),
		);
		const { result } = renderHook(() => useCreateEntry(), { wrapper });
		let first!: Promise<unknown>;
		act(() => {
			first = result.current.create(baseRequest);
		});
		expect(result.current.isPending).toBe(true);
		let second: unknown;
		await act(async () => {
			second = await result.current.create(baseRequest);
		});
		expect(second).toBe("ignored");
		await act(async () => {
			resolve(created());
			await first;
		});
		expect(result.current.isPending).toBe(false);

		vi.spyOn(timeService, "createEntry").mockRejectedValue(
			apiError(422, "HOUR_CAP_EXCEEDED", {
				limit_window: "weekly",
				limit_hours: 40,
			}),
		);
		await act(async () => {
			await result.current.create(baseRequest);
		});
		expect(result.current.state.error?.message).toBe(
			"This goes past the 40h weekly limit for Prodigitality Services Inc. Team.",
		);
		act(() => result.current.reset());
		expect(result.current.state.status).toBe("idle");
	});
});
