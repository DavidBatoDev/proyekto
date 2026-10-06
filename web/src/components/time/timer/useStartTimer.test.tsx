/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { timeKeys } from "@/queries/time";
import { TimeApiError, timeService } from "@/services/time.service";
import type {
	EntryWithWarnings,
	LoggingForResult,
	LoggingOption,
	TimeEntryView,
	TimesheetDetail,
	TimesheetRow,
} from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";

const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));

import {
	isSameTimer,
	type StartTimerRequest,
	useStartTimer,
} from "./useStartTimer";

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

function entry(over: Partial<TimeEntryView> = {}): TimeEntryView {
	return {
		id: "running-1",
		context_kind: "team",
		context_ref: TEAM,
		context_label_snapshot: "Prodigitality Services Inc. Team",
		timesheet_id: null,
		work_item: "task",
		started_at: new Date(Date.now() - 4320_000).toISOString(),
		ended_at: null,
		paused_at: null,
		duration_seconds: null,
		break_seconds: 0,
		break_minutes: 0,
		payable_seconds: null,
		source: "timer",
		work_type_snapshot: "real_work",
		legacy_status: null,
		payout_id: null,
		flagged_reason: null,
		project_id: "p0",
		team_id: TEAM,
		workspace_id: null,
		engagement_assignment_id: null,
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		timesheet: null,
		locked_reason: null,
		identity: "visible",
		member_user_id: USER,
		member_display_name_snapshot: "Maria",
		member: null,
		member_label: null,
		content: "visible",
		task_id: "task-0",
		note: null,
		task: {
			id: "task-0",
			title: "Fix login bug",
			work_type: null,
			status: null,
		},
		project: { id: "p0", title: "Acme Website" },
		content_label: null,
		cost: "hidden",
		...over,
	};
}

function started(over: Partial<TimeEntryView> = {}): EntryWithWarnings {
	return {
		...entry({
			id: "new-1",
			project_id: PROJECT,
			task_id: "task-1",
			task: {
				id: "task-1",
				title: "Write docs",
				work_type: null,
				status: null,
			},
			...over,
		}),
		warnings: [],
	};
}

function sheetDetail(over: Partial<TimesheetRow> = {}): TimesheetDetail {
	return {
		sheet: {
			id: SHEET,
			member_user_id: USER,
			member_display_name_snapshot: "Maria",
			scope_kind: "team",
			scope_ref: TEAM,
			team_id: TEAM,
			workspace_id: null,
			engagement_id: null,
			scope_label_snapshot: "Prodigitality",
			policy_workspace_id: "w",
			period_kind: "weekly",
			period_start: "2026-09-28",
			period_end: "2026-10-04",
			timezone: "Asia/Manila",
			week_start: 1,
			status: "submitted",
			approver_scope: "team",
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

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

let client: QueryClient;

function setup(
	opts: { running?: TimeEntryView | null; onStarted?: () => void } = {},
) {
	client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	if (opts.running !== undefined) {
		client.setQueryData(timeKeys.running(USER), opts.running);
	}
	const wrapper = ({ children }: { children: ReactNode }) =>
		createElement(QueryClientProvider, { client }, children);
	return renderHook(() => useStartTimer({ onStarted: opts.onStarted }), {
		wrapper,
	});
}

const request: StartTimerRequest = { projectId: PROJECT, taskId: "task-1" };
const runningCache = () =>
	client.getQueryData<TimeEntryView | null>(timeKeys.running(USER));

beforeEach(() => {
	useAuthStore.setState({ user: { id: USER } as never });
	vi.spyOn(timeService, "getRunning").mockResolvedValue(null);
});

afterEach(() => {
	cleanup();
	client?.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe("option counts", () => {
	it("0 options: blocked with the Why? copy, nothing started", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ reason: "none" }),
		);
		const start = vi.spyOn(timeService, "startEntry");
		const { result } = setup();
		let outcome: unknown;
		await act(async () => {
			outcome = await result.current.start(request);
		});
		expect(outcome).toBe("blocked");
		expect(result.current.prompt).toBe("blocked");
		expect(result.current.state.blocked).toEqual({
			title: "You can't log time on this project",
			why: "You're a viewer on this project. Ask a project admin for editor access to log time.",
		});
		expect(start).not.toHaveBeenCalled();
	});

	it("1 option: starts at once, never asked; the server resolves the For (no stale pick)", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		const row = started({
			context_kind: "team",
		});
		row.warnings = [
			{
				code: "POLICY_WEEKLY_LIMIT",
				limit_minutes: 2400,
				logged_minutes: 2400,
				label: "Prodigitality",
			},
		];
		const start = vi.spyOn(timeService, "startEntry").mockResolvedValue(row);
		const onStarted = vi.fn();
		const { result } = setup({ onStarted });
		let outcome: unknown;
		await act(async () => {
			outcome = await result.current.start(request);
		});
		expect(outcome).toBe("started");
		// The cached option is not sent: a second option that appeared since
		// gets a 409 and the picker, never a silent pick (L38).
		expect(start).toHaveBeenCalledWith({
			project_id: PROJECT,
			task_id: "task-1",
		});
		expect(result.current.step).toBe("idle");
		expect(runningCache()?.id).toBe("new-1");
		expect(runningCache()).not.toHaveProperty("warnings");
		expect(onStarted).toHaveBeenCalledWith(row);
		expect(toast.warning).toHaveBeenCalledWith(
			"Prodigitality has a 40h weekly limit. You've logged 40h this week.",
		);
	});

	it("Just me as the only option starts as personal", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({
				options: [personal],
				selected: personal,
				personal_reason: "plan",
			}),
		);
		const start = vi
			.spyOn(timeService, "startEntry")
			.mockResolvedValue(started({ context_kind: "personal" }));
		const { result } = setup();
		await act(async () => {
			await result.current.start({ projectId: PROJECT, workItem: "meeting" });
		});
		expect(start).toHaveBeenCalledWith({
			project_id: PROJECT,
			work_item: "meeting",
		});
	});

	it("2+ options the first time: the picker, remember ticked, nothing preselected", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team, agreement], reason: "required" }),
		);
		const start = vi
			.spyOn(timeService, "startEntry")
			.mockResolvedValue(started());
		const { result } = setup();
		let outcome: unknown;
		await act(async () => {
			outcome = await result.current.start(request);
		});
		expect(outcome).toBe("prompted");
		expect(result.current.prompt).toBe("pick");
		expect(result.current.state.choice).toBeNull();
		expect(result.current.state.remember).toBe(true);
		expect(start).not.toHaveBeenCalled();

		// Nothing chosen: the primary action is a no-op.
		await act(async () => {
			expect(await result.current.confirmPick()).toBe("ignored");
		});

		act(() => result.current.select(agreement));
		expect(result.current.state.choiceLabel).toBe("Acme Corp");
		await act(async () => {
			await result.current.confirmPick();
		});
		expect(start).toHaveBeenCalledWith({
			project_id: PROJECT,
			task_id: "task-1",
			logging_for: { kind: "assignment", id: ASG },
			remember: true,
		});
		expect(result.current.step).toBe("idle");
	});

	it("2+ with a remembered default: preselected and named, never applied silently (L38)", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({
				options: [team, agreement],
				prefill: agreement,
				reason: "confirm",
			}),
		);
		const start = vi
			.spyOn(timeService, "startEntry")
			.mockResolvedValue(started());
		const { result } = setup();
		await act(async () => {
			await result.current.start(request);
		});
		expect(result.current.prompt).toBe("pick");
		expect(result.current.state.choice).toEqual({
			kind: "assignment",
			id: ASG,
		});
		expect(result.current.state.choiceLabel).toBe("Acme Corp");
		expect(result.current.state.remember).toBe(false);
		expect(start).not.toHaveBeenCalled();

		await act(async () => {
			await result.current.confirmPick();
		});
		expect(start).toHaveBeenCalledWith({
			project_id: PROJECT,
			task_id: "task-1",
			logging_for: { kind: "assignment", id: ASG },
		});
	});

	it("picking another option than the remembered one ticks remember; it can be unticked", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team, agreement], prefill: agreement }),
		);
		const start = vi
			.spyOn(timeService, "startEntry")
			.mockResolvedValue(started());
		const { result } = setup();
		await act(async () => {
			await result.current.start(request);
		});
		act(() => result.current.select(team));
		expect(result.current.state.remember).toBe(true);
		act(() => result.current.setRemember(false));
		await act(async () => {
			await result.current.confirmPick();
		});
		expect(start).toHaveBeenCalledWith(
			expect.not.objectContaining({ remember: true }),
		);
	});

	it("a caller's own For choice is sent as is (the server still checks it)", async () => {
		const resolve = vi.spyOn(timeService, "getLoggingFor");
		const start = vi
			.spyOn(timeService, "startEntry")
			.mockResolvedValue(started());
		const { result } = setup();
		await act(async () => {
			await result.current.start({
				...request,
				loggingFor: { kind: "team", id: TEAM },
				remember: true,
			});
		});
		expect(resolve).not.toHaveBeenCalled();
		expect(start).toHaveBeenCalledWith(
			expect.objectContaining({
				logging_for: { kind: "team", id: TEAM },
				remember: true,
			}),
		);
	});
});

describe("switching (never two timers)", () => {
	it("asks before replacing the running timer, then stops it and starts", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		const stop = vi
			.spyOn(timeService, "stopEntry")
			.mockResolvedValue(entry({ ended_at: new Date().toISOString() }));
		const start = vi
			.spyOn(timeService, "startEntry")
			.mockResolvedValue(started());
		const { result } = setup({ running: entry() });

		await act(async () => {
			expect(await result.current.start(request)).toBe("prompted");
		});
		expect(result.current.prompt).toBe("switch");
		expect(result.current.state.running?.id).toBe("running-1");
		expect(stop).not.toHaveBeenCalled();
		expect(start).not.toHaveBeenCalled();

		await act(async () => {
			expect(await result.current.confirmSwitch()).toBe("started");
		});
		expect(stop).toHaveBeenCalledWith("running-1");
		expect(stop.mock.invocationCallOrder[0]).toBeLessThan(
			start.mock.invocationCallOrder[0],
		);
		expect(runningCache()?.id).toBe("new-1");
	});

	it("starting the task that already runs does nothing", async () => {
		const start = vi.spyOn(timeService, "startEntry");
		const { result } = setup({
			running: entry({ project_id: PROJECT, task_id: "task-1" }),
		});
		await act(async () => {
			expect(await result.current.start(request)).toBe("already_running");
		});
		expect(result.current.prompt).toBeNull();
		expect(start).not.toHaveBeenCalled();
	});

	it("cancel closes the prompt and starts nothing", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		const stop = vi.spyOn(timeService, "stopEntry");
		const start = vi.spyOn(timeService, "startEntry");
		const { result } = setup({ running: entry() });
		await act(async () => {
			await result.current.start(request);
		});
		expect(result.current.prompt).toBe("switch");
		act(() => result.current.cancel());
		expect(result.current.step).toBe("idle");
		expect(stop).not.toHaveBeenCalled();
		expect(start).not.toHaveBeenCalled();
		expect(runningCache()?.id).toBe("running-1");
	});

	it("race: the timer stopped elsewhere before Switch, so the start goes ahead", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		vi.spyOn(timeService, "stopEntry").mockRejectedValue(
			apiError(409, "TIMER_NOT_RUNNING"),
		);
		const start = vi
			.spyOn(timeService, "startEntry")
			.mockResolvedValue(started());
		const { result } = setup({ running: entry() });
		await act(async () => {
			await result.current.start(request);
		});
		await act(async () => {
			expect(await result.current.confirmSwitch()).toBe("started");
		});
		expect(start).toHaveBeenCalled();
	});

	it("a failed stop keeps the Switch prompt with the reason", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		vi.spyOn(timeService, "stopEntry").mockRejectedValue(
			apiError(
				0,
				"NETWORK_ERROR",
				{},
				"Proyekto couldn't reach the server. Try again.",
			),
		);
		const start = vi.spyOn(timeService, "startEntry");
		const { result } = setup({ running: entry() });
		await act(async () => {
			await result.current.start(request);
		});
		await act(async () => {
			expect(await result.current.confirmSwitch()).toBe("failed");
		});
		expect(result.current.prompt).toBe("switch");
		expect(result.current.state.error).toBe(
			"Proyekto couldn't reach the server. Check your connection and try again.",
		);
		expect(start).not.toHaveBeenCalled();
	});

	it("2+ options while a timer runs: the picker first; Cancel there stops nothing", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team, agreement], reason: "required" }),
		);
		const stop = vi.spyOn(timeService, "stopEntry");
		const start = vi.spyOn(timeService, "startEntry");
		const { result } = setup({ running: entry() });
		await act(async () => {
			expect(await result.current.start(request)).toBe("prompted");
		});
		expect(result.current.prompt).toBe("pick");
		act(() => result.current.cancel());
		expect(result.current.step).toBe("idle");
		expect(stop).not.toHaveBeenCalled();
		expect(start).not.toHaveBeenCalled();
		expect(runningCache()?.id).toBe("running-1");
	});

	it("2+ options while a timer runs: pick, then Switch, then stop and start with the pick", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team, agreement], reason: "required" }),
		);
		const stop = vi
			.spyOn(timeService, "stopEntry")
			.mockResolvedValue(entry({ ended_at: new Date().toISOString() }));
		const start = vi
			.spyOn(timeService, "startEntry")
			.mockResolvedValue(started());
		const { result } = setup({ running: entry() });
		await act(async () => {
			await result.current.start(request);
		});
		act(() => result.current.select(agreement));
		await act(async () => {
			expect(await result.current.confirmPick()).toBe("prompted");
		});
		// Nothing stopped yet: the person is asked first.
		expect(result.current.prompt).toBe("switch");
		expect(result.current.state.running?.id).toBe("running-1");
		expect(result.current.state.choiceLabel).toBe("Acme Corp");
		expect(stop).not.toHaveBeenCalled();
		expect(start).not.toHaveBeenCalled();

		await act(async () => {
			expect(await result.current.confirmSwitch()).toBe("started");
		});
		expect(stop).toHaveBeenCalledWith("running-1");
		expect(start).toHaveBeenCalledWith({
			project_id: PROJECT,
			task_id: "task-1",
			logging_for: { kind: "assignment", id: ASG },
			remember: true,
		});
		expect(timeService.getLoggingFor).toHaveBeenCalledTimes(1);
	});

	it("0 options while a timer runs: blocked, and the running timer is untouched", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ reason: "none" }),
		);
		const stop = vi.spyOn(timeService, "stopEntry");
		const start = vi.spyOn(timeService, "startEntry");
		const { result } = setup({ running: entry() });
		await act(async () => {
			expect(await result.current.start(request)).toBe("blocked");
		});
		expect(result.current.prompt).toBe("blocked");
		expect(stop).not.toHaveBeenCalled();
		expect(start).not.toHaveBeenCalled();
		expect(runningCache()?.id).toBe("running-1");
	});

	it("a caller's own For with a timer running: Switch, then that For is sent", async () => {
		const resolve = vi.spyOn(timeService, "getLoggingFor");
		vi.spyOn(timeService, "stopEntry").mockResolvedValue(entry());
		const start = vi
			.spyOn(timeService, "startEntry")
			.mockResolvedValue(started());
		const { result } = setup({ running: entry() });
		await act(async () => {
			expect(
				await result.current.start({
					...request,
					loggingFor: { kind: "team", id: TEAM },
					loggingForLabel: "Prodigitality Services Inc. Team",
				}),
			).toBe("prompted");
		});
		expect(result.current.prompt).toBe("switch");
		await act(async () => {
			await result.current.confirmSwitch();
		});
		expect(resolve).not.toHaveBeenCalled();
		expect(start).toHaveBeenCalledWith(
			expect.objectContaining({ logging_for: { kind: "team", id: TEAM } }),
		);
	});

	it("race: the poll replaced the timer behind the prompt: asks again, stops nothing", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		const stop = vi.spyOn(timeService, "stopEntry").mockResolvedValue(entry());
		const start = vi
			.spyOn(timeService, "startEntry")
			.mockResolvedValue(started());
		const { result } = setup({ running: entry() });
		await act(async () => {
			await result.current.start(request);
		});
		expect(result.current.state.running?.id).toBe("running-1");

		// X stopped and Y started on another device; the poll saw it.
		const other = entry({
			id: "running-2",
			task_id: "task-9",
			task: {
				id: "task-9",
				title: "Design review",
				work_type: null,
				status: null,
			},
		});
		act(() => {
			client.setQueryData(timeKeys.running(USER), other);
		});
		await act(async () => {
			expect(await result.current.confirmSwitch()).toBe("prompted");
		});
		expect(stop).not.toHaveBeenCalled();
		expect(start).not.toHaveBeenCalled();
		expect(result.current.prompt).toBe("switch");
		expect(result.current.state.running?.id).toBe("running-2");

		// Confirming the prompt that names Y stops Y, never X.
		await act(async () => {
			expect(await result.current.confirmSwitch()).toBe("started");
		});
		expect(stop).toHaveBeenCalledTimes(1);
		expect(stop).toHaveBeenCalledWith("running-2");
	});

	it("race: TIMER_ALREADY_RUNNING from another device opens Switch, then keeps the choice", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team, agreement] }),
		);
		const elsewhere = entry({ id: "other-device" });
		vi.spyOn(timeService, "getRunning").mockResolvedValue(elsewhere);
		const start = vi
			.spyOn(timeService, "startEntry")
			.mockRejectedValueOnce(apiError(409, "TIMER_ALREADY_RUNNING"))
			.mockResolvedValueOnce(started());
		const stop = vi
			.spyOn(timeService, "stopEntry")
			.mockResolvedValue(elsewhere);
		const { result } = setup({ running: null });

		await act(async () => {
			await result.current.start(request);
		});
		act(() => result.current.select(agreement));
		await act(async () => {
			expect(await result.current.confirmPick()).toBe("prompted");
		});
		expect(result.current.prompt).toBe("switch");
		expect(result.current.state.running?.id).toBe("other-device");

		await act(async () => {
			await result.current.confirmSwitch();
		});
		expect(stop).toHaveBeenCalledWith("other-device");
		expect(start).toHaveBeenLastCalledWith(
			expect.objectContaining({
				logging_for: { kind: "assignment", id: ASG },
				remember: true,
			}),
		);
		// The For step is not asked twice.
		expect(timeService.getLoggingFor).toHaveBeenCalledTimes(1);
	});

	it("race: TIMER_ALREADY_RUNNING but it stopped meanwhile: retried once", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		vi.spyOn(timeService, "getRunning").mockResolvedValue(null);
		const start = vi
			.spyOn(timeService, "startEntry")
			.mockRejectedValueOnce(apiError(409, "TIMER_ALREADY_RUNNING"))
			.mockResolvedValueOnce(started());
		const { result } = setup({ running: null });
		await act(async () => {
			expect(await result.current.start(request)).toBe("started");
		});
		expect(start).toHaveBeenCalledTimes(2);
	});

	it("race: TIMER_ALREADY_RUNNING twice with no timer to show: an error, no loop", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		vi.spyOn(timeService, "getRunning").mockResolvedValue(null);
		const start = vi
			.spyOn(timeService, "startEntry")
			.mockRejectedValue(
				apiError(
					409,
					"TIMER_ALREADY_RUNNING",
					{},
					"You already have a running timer. Stop it before starting a new one.",
				),
			);
		const { result } = setup({ running: null });
		await act(async () => {
			expect(await result.current.start(request)).toBe("failed");
		});
		expect(start).toHaveBeenCalledTimes(2);
		expect(toast.error).toHaveBeenCalledWith(
			"You already have a timer running.",
		);
	});
});

describe("the For choice changed under the person", () => {
	it("race: the cache said one option, the server now has two (LOGGING_FOR_REQUIRED)", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		const start = vi
			.spyOn(timeService, "startEntry")
			.mockRejectedValueOnce(
				apiError(409, "LOGGING_FOR_REQUIRED", {
					options: [team, agreement],
					prefill: team,
				}),
			)
			.mockResolvedValueOnce(started());
		const { result } = setup();
		await act(async () => {
			expect(await result.current.start(request)).toBe("prompted");
		});
		expect(result.current.prompt).toBe("pick");
		expect(result.current.state.result?.options).toHaveLength(2);
		expect(result.current.state.choice).toEqual({ kind: "team", id: TEAM });
		expect(result.current.state.error).toBeNull();
		await act(async () => {
			await result.current.confirmPick();
		});
		expect(start).toHaveBeenCalledTimes(2);
		// First without a For (so the server could ask), then the confirmed one.
		expect(start.mock.calls[0][0]).not.toHaveProperty("logging_for");
		expect(start.mock.calls[1][0]).toMatchObject({
			logging_for: { kind: "team", id: TEAM },
		});
	});

	it("race: the picked choice went stale (LOGGING_FOR_INVALID): pick again", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team, agreement] }),
		);
		vi.spyOn(timeService, "startEntry").mockRejectedValueOnce(
			apiError(422, "LOGGING_FOR_INVALID", { options: [team, personal] }),
		);
		const { result } = setup();
		await act(async () => {
			await result.current.start(request);
		});
		act(() => result.current.select(agreement));
		await act(async () => {
			expect(await result.current.confirmPick()).toBe("prompted");
		});
		expect(result.current.prompt).toBe("pick");
		expect(result.current.state.error).toBe(
			"That choice isn't available any more. Pick again.",
		);
		expect(result.current.state.result?.options.map((o) => o.label)).toEqual([
			"Prodigitality Services Inc. Team",
			"Just me",
		]);
		expect(result.current.state.choice).toBeNull();
	});

	it("LOGGING_FOR_INVALID without options refetches the picker", async () => {
		const resolve = vi
			.spyOn(timeService, "getLoggingFor")
			.mockResolvedValueOnce(forResult({ options: [team, agreement] }))
			.mockResolvedValueOnce(forResult({ options: [team, personal] }));
		vi.spyOn(timeService, "startEntry").mockRejectedValueOnce(
			apiError(422, "LOGGING_FOR_INVALID"),
		);
		const { result } = setup();
		await act(async () => {
			await result.current.start(request);
		});
		act(() => result.current.select(agreement));
		await act(async () => {
			expect(await result.current.confirmPick()).toBe("prompted");
		});
		expect(resolve).toHaveBeenCalledTimes(2);
		expect(result.current.prompt).toBe("pick");
		expect(result.current.state.result?.options.map((o) => o.label)).toEqual([
			"Prodigitality Services Inc. Team",
			"Just me",
		]);
	});

	it("NO_LOGGING_CONTEXT from the write: blocked", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		vi.spyOn(timeService, "startEntry").mockRejectedValue(
			apiError(403, "NO_LOGGING_CONTEXT"),
		);
		const { result } = setup();
		await act(async () => {
			expect(await result.current.start(request)).toBe("blocked");
		});
		expect(result.current.prompt).toBe("blocked");
	});
});

describe("locked period (TIMESHEET_LOCKED {period})", () => {
	function lockedStart() {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		return vi.spyOn(timeService, "startEntry").mockRejectedValueOnce(
			apiError(409, "TIMESHEET_LOCKED", {
				reason: "period",
				timesheet_id: SHEET,
				sheet_status: "submitted",
			}),
		);
	}

	it("offers an inline Withdraw, then retries the same start", async () => {
		const start = lockedStart().mockResolvedValueOnce(started());
		const getSheet = vi
			.spyOn(timeService, "getTimesheet")
			.mockResolvedValue(sheetDetail());
		const withdraw = vi
			.spyOn(timeService, "withdrawTimesheet")
			.mockResolvedValue(sheetDetail().sheet);
		const { result } = setup();
		await act(async () => {
			expect(await result.current.start(request)).toBe("prompted");
		});
		expect(result.current.prompt).toBe("locked");
		await waitFor(() =>
			expect(result.current.state.locked?.message).toBe(
				"This week's Prodigitality timesheet is submitted. Withdraw it to add time.",
			),
		);
		expect(result.current.state.locked?.canWithdraw).toBe(true);

		await act(async () => {
			expect(await result.current.withdrawAndRetry()).toBe("started");
		});
		expect(getSheet).toHaveBeenCalledWith(SHEET);
		expect(withdraw).toHaveBeenCalledWith(SHEET, { expected_revision: 3 });
		expect(toast.success).toHaveBeenCalledWith(
			"Withdrawn. You can edit again.",
		);
		expect(start).toHaveBeenCalledTimes(2);
		expect(start.mock.calls[1][0]).toEqual(start.mock.calls[0][0]);
		expect(result.current.step).toBe("idle");
	});

	it("race: the sheet changed before Withdraw (STALE_REVISION): read again, withdraw once more", async () => {
		lockedStart().mockResolvedValueOnce(started());
		vi.spyOn(timeService, "getTimesheet")
			.mockResolvedValueOnce(sheetDetail())
			.mockResolvedValueOnce(sheetDetail({ revision: 3 }))
			.mockResolvedValueOnce(sheetDetail({ revision: 4 }));
		const withdraw = vi
			.spyOn(timeService, "withdrawTimesheet")
			.mockRejectedValueOnce(apiError(409, "STALE_REVISION"))
			.mockResolvedValueOnce(sheetDetail().sheet);
		const { result } = setup();
		await act(async () => {
			await result.current.start(request);
		});
		await waitFor(() =>
			expect(result.current.state.locked?.label).toBe("Prodigitality"),
		);
		await act(async () => {
			expect(await result.current.withdrawAndRetry()).toBe("started");
		});
		expect(withdraw).toHaveBeenNthCalledWith(1, SHEET, {
			expected_revision: 3,
		});
		expect(withdraw).toHaveBeenNthCalledWith(2, SHEET, {
			expected_revision: 4,
		});
	});

	it("race: someone approved it meanwhile: no Withdraw, the approved copy", async () => {
		lockedStart();
		vi.spyOn(timeService, "getTimesheet")
			.mockResolvedValueOnce(sheetDetail())
			.mockResolvedValueOnce(sheetDetail({ status: "approved" }));
		const withdraw = vi.spyOn(timeService, "withdrawTimesheet");
		const { result } = setup();
		await act(async () => {
			await result.current.start(request);
		});
		await waitFor(() =>
			expect(result.current.state.locked?.label).toBe("Prodigitality"),
		);
		await act(async () => {
			expect(await result.current.withdrawAndRetry()).toBe("failed");
		});
		expect(withdraw).not.toHaveBeenCalled();
		expect(result.current.state.locked?.canWithdraw).toBe(false);
		expect(result.current.state.error).toBe(
			"This period's Prodigitality timesheet is approved, so its time can't change.",
		);
	});

	it("an approved period offers no Withdraw", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		vi.spyOn(timeService, "startEntry").mockRejectedValue(
			apiError(409, "TIMESHEET_LOCKED", {
				reason: "period",
				timesheet_id: null,
				sheet_status: "approved",
			}),
		);
		const { result } = setup();
		await act(async () => {
			await result.current.start(request);
		});
		expect(result.current.state.locked?.canWithdraw).toBe(false);
		await act(async () => {
			expect(await result.current.withdrawAndRetry()).toBe("ignored");
		});
	});

	it("race: a cancelled locked card is not reopened by the late sheet read", async () => {
		lockedStart();
		const sheet = deferred<TimesheetDetail>();
		vi.spyOn(timeService, "getTimesheet").mockReturnValue(sheet.promise);
		const { result } = setup();
		await act(async () => {
			await result.current.start(request);
		});
		act(() => result.current.cancel());
		await act(async () => {
			sheet.resolve(sheetDetail());
			await sheet.promise;
		});
		expect(result.current.step).toBe("idle");
		expect(result.current.state.locked).toBeNull();
	});
});

describe("other refusals and double clicks", () => {
	it("HOUR_CAP_EXCEEDED names the limit", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		vi.spyOn(timeService, "startEntry").mockRejectedValue(
			apiError(422, "HOUR_CAP_EXCEEDED", {
				limit_window: "weekly",
				limit_hours: 40,
				logged_hours: 40,
			}),
		);
		const { result } = setup();
		await act(async () => {
			expect(await result.current.start(request)).toBe("failed");
		});
		expect(toast.error).toHaveBeenCalledWith(
			"This goes past the 40h weekly limit for Prodigitality Services Inc. Team.",
		);
		expect(result.current.step).toBe("idle");
	});

	it("a second click while resolving is ignored", async () => {
		const answer = deferred<LoggingForResult>();
		const resolve = vi
			.spyOn(timeService, "getLoggingFor")
			.mockReturnValue(answer.promise);
		vi.spyOn(timeService, "startEntry").mockResolvedValue(started());
		const { result } = setup();
		let first: Promise<unknown> = Promise.resolve();
		act(() => {
			first = result.current.start(request);
		});
		expect(result.current.isPending).toBe(true);
		await act(async () => {
			expect(await result.current.start(request)).toBe("ignored");
		});
		await act(async () => {
			answer.resolve(forResult({ options: [team], selected: team }));
			await first;
		});
		expect(resolve).toHaveBeenCalledTimes(1);
		expect(timeService.startEntry).toHaveBeenCalledTimes(1);
	});

	it("a failed For read is an error toast", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockRejectedValue(
			apiError(
				404,
				"TIME_NOT_FOUND",
				{},
				"This doesn't exist or you can't open it.",
			),
		);
		const { result } = setup();
		await act(async () => {
			expect(await result.current.start(request)).toBe("failed");
		});
		expect(toast.error).toHaveBeenCalledWith(
			"This doesn't exist or you can't open it.",
		);
	});

	it("needs a project", async () => {
		const { result } = setup();
		await act(async () => {
			expect(await result.current.start({ projectId: "" })).toBe("ignored");
		});
	});
});

describe("isSameTimer", () => {
	it("matches the running task or preset on the same project", () => {
		const running = {
			project_id: PROJECT,
			task_id: "task-1",
			work_item: "task" as const,
		};
		expect(isSameTimer(running, { projectId: PROJECT, taskId: "task-1" })).toBe(
			true,
		);
		expect(isSameTimer(running, { projectId: PROJECT, taskId: "task-2" })).toBe(
			false,
		);
		expect(isSameTimer(running, { projectId: "p9", taskId: "task-1" })).toBe(
			false,
		);
		expect(
			isSameTimer(
				{ project_id: PROJECT, task_id: null, work_item: "meeting" },
				{ projectId: PROJECT, workItem: "meeting" },
			),
		).toBe(true);
		expect(isSameTimer(null, { projectId: PROJECT })).toBe(false);
	});
});
