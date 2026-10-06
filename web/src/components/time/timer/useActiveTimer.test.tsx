/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { timeKeys } from "@/queries/time";
import { TimeApiError, timeService } from "@/services/time.service";
import type { TimeEntryView } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";

const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));

import { useActiveTimer, useRunningTaskId } from "./useActiveTimer";

const USER = "user-1";
const NOW = Date.parse("2026-10-06T10:00:00.000Z");

function entry(over: Partial<TimeEntryView> = {}): TimeEntryView {
	return {
		id: "e1",
		context_kind: "team",
		context_ref: "t1",
		context_label_snapshot: "Design",
		timesheet_id: null,
		work_item: "task",
		started_at: new Date(NOW - 3600_000).toISOString(),
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
		project_id: "p1",
		team_id: "t1",
		workspace_id: null,
		engagement_assignment_id: null,
		created_at: new Date(NOW - 3600_000).toISOString(),
		updated_at: new Date(NOW - 3600_000).toISOString(),
		timesheet: null,
		locked_reason: null,
		identity: "visible",
		member_user_id: USER,
		member_display_name_snapshot: "Maria",
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

function setup(running: TimeEntryView | null) {
	client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	client.setQueryData(timeKeys.running(USER), running);
	vi.spyOn(timeService, "getRunning").mockImplementation(
		async () =>
			client.getQueryData<TimeEntryView | null>(timeKeys.running(USER)) ?? null,
	);
	const wrapper = ({ children }: { children: ReactNode }) =>
		createElement(QueryClientProvider, { client }, children);
	return renderHook(() => useActiveTimer(), { wrapper });
}

const cached = () =>
	client.getQueryData<TimeEntryView | null>(timeKeys.running(USER));

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime(NOW);
	useAuthStore.setState({ user: { id: USER } as never });
});

afterEach(() => {
	cleanup();
	client?.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
	vi.clearAllMocks();
	vi.useRealTimers();
});

describe("useActiveTimer", () => {
	it("reads the running entry and its live clock", async () => {
		const { result } = setup(entry({ break_seconds: 600 }));
		await waitFor(() => expect(result.current.isRunning).toBe(true));
		expect(result.current.runningTaskId).toBe("task-1");
		expect(result.current.runningEntryId).toBe("e1");
		expect(result.current.workSeconds).toBe(3000);
		expect(result.current.breakSeconds).toBe(600);
	});

	it("pauses optimistically, then keeps the server's row", async () => {
		const answer = deferred<TimeEntryView>();
		const pause = vi
			.spyOn(timeService, "pauseEntry")
			.mockReturnValue(answer.promise);
		const { result } = setup(entry());
		await waitFor(() => expect(result.current.isRunning).toBe(true));

		act(() => result.current.pause());
		await waitFor(() => expect(cached()?.paused_at).not.toBeNull());
		expect(pause).toHaveBeenCalledWith("e1");
		expect(result.current.isPaused).toBe(true);

		const serverRow = entry({ paused_at: new Date(NOW).toISOString() });
		await act(async () => answer.resolve(serverRow));
		await waitFor(() => expect(toast.success).toHaveBeenCalled());
		expect(cached()?.paused_at).toBe(serverRow.paused_at);
	});

	it("rolls a failed pause back and says why", async () => {
		vi.spyOn(timeService, "pauseEntry").mockRejectedValue(
			new TimeApiError({
				status: 500,
				code: "TIME_INTERNAL",
				message: "Proyekto couldn't save this time. Try again.",
			}),
		);
		const { result } = setup(entry());
		await waitFor(() => expect(result.current.isRunning).toBe(true));
		act(() => result.current.pause());
		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith(
				"Proyekto couldn't save this time. Try again.",
			),
		);
		expect(cached()?.paused_at).toBeNull();
	});

	it("resumes optimistically and banks the break", async () => {
		const answer = deferred<TimeEntryView>();
		vi.spyOn(timeService, "resumeEntry").mockReturnValue(answer.promise);
		const pausedAt = new Date(NOW - 300_000).toISOString();
		const { result } = setup(entry({ paused_at: pausedAt, break_seconds: 60 }));
		await waitFor(() => expect(result.current.isPaused).toBe(true));

		act(() => result.current.toggleBreak());
		await waitFor(() => expect(cached()?.paused_at).toBeNull());
		expect(cached()?.break_seconds).toBe(360);

		await act(async () => answer.resolve(entry({ break_seconds: 360 })));
		await waitFor(() =>
			expect(toast.success).toHaveBeenCalledWith(
				"Back to work — 6m of break logged.",
			),
		);
	});

	it("stops optimistically and restores the timer if the stop fails", async () => {
		const answer = deferred<TimeEntryView>();
		vi.spyOn(timeService, "stopEntry").mockReturnValue(answer.promise);
		const { result } = setup(entry());
		await waitFor(() => expect(result.current.isRunning).toBe(true));

		act(() => result.current.stop());
		await waitFor(() => expect(cached()).toBeNull());
		expect(result.current.isStopping).toBe(true);

		await act(async () =>
			answer.reject(
				new TimeApiError({
					status: 0,
					code: "NETWORK_ERROR",
					message: "offline",
				}),
			),
		);
		await waitFor(() => expect(cached()?.id).toBe("e1"));
		// The shared copy, never the raw message.
		expect(toast.error).toHaveBeenCalledWith(
			"Proyekto couldn't reach the server. Check your connection and try again.",
		);
	});

	it("follows the server when the timer already stopped elsewhere", async () => {
		vi.spyOn(timeService, "stopEntry").mockRejectedValue(
			new TimeApiError({
				status: 409,
				code: "TIMER_NOT_RUNNING",
				message: "This timer is not running.",
			}),
		);
		const { result } = setup(entry());
		await waitFor(() => expect(result.current.isRunning).toBe(true));
		let stopped = false;
		await act(async () => {
			stopped = await result.current.stopAsync();
		});
		expect(stopped).toBe(true);
		expect(cached()).toBeNull();
		expect(toast.info).toHaveBeenCalledWith("This timer is not running.");
		expect(toast.error).not.toHaveBeenCalled();
	});

	it("pause refused as already on break: keeps the timer, rolls back, refetches", async () => {
		vi.spyOn(timeService, "pauseEntry").mockRejectedValue(
			new TimeApiError({
				status: 409,
				code: "TIMER_NOT_RUNNING",
				message: "This timer is already on break.",
			}),
		);
		const { result } = setup(entry());
		await waitFor(() => expect(result.current.isRunning).toBe(true));
		const refetch = vi.mocked(timeService.getRunning);
		refetch.mockClear();
		act(() => result.current.pause());
		await waitFor(() =>
			expect(toast.info).toHaveBeenCalledWith(
				"This timer is already on break.",
			),
		);
		// Never emptied: the bar and the floating timer stay mounted.
		expect(cached()?.id).toBe("e1");
		expect(cached()?.paused_at).toBeNull();
		expect(result.current.isRunning).toBe(true);
		await waitFor(() => expect(refetch).toHaveBeenCalled());
		expect(toast.error).not.toHaveBeenCalled();
	});

	it("resume refused as not on break: keeps the timer, rolls back, refetches", async () => {
		vi.spyOn(timeService, "resumeEntry").mockRejectedValue(
			new TimeApiError({
				status: 409,
				code: "TIMER_NOT_RUNNING",
				message: "This timer is not on break.",
			}),
		);
		const pausedAt = new Date(NOW - 300_000).toISOString();
		const { result } = setup(entry({ paused_at: pausedAt }));
		await waitFor(() => expect(result.current.isPaused).toBe(true));
		const refetch = vi.mocked(timeService.getRunning);
		refetch.mockClear();
		act(() => result.current.resume());
		await waitFor(() =>
			expect(toast.info).toHaveBeenCalledWith("This timer is not on break."),
		);
		expect(cached()?.id).toBe("e1");
		expect(cached()?.paused_at).toBe(pausedAt);
		await waitFor(() => expect(refetch).toHaveBeenCalled());
	});

	it("stops and toasts on success", async () => {
		vi.spyOn(timeService, "stopEntry").mockResolvedValue(
			entry({ ended_at: new Date(NOW).toISOString(), duration_seconds: 3600 }),
		);
		const onStopped = vi.fn();
		client = new QueryClient();
		client.setQueryData(timeKeys.running(USER), entry());
		vi.spyOn(timeService, "getRunning").mockImplementation(
			async () =>
				client.getQueryData<TimeEntryView | null>(timeKeys.running(USER)) ??
				null,
		);
		const wrapper = ({ children }: { children: ReactNode }) =>
			createElement(QueryClientProvider, { client }, children);
		const { result } = renderHook(() => useActiveTimer({ onStopped }), {
			wrapper,
		});
		await waitFor(() => expect(result.current.isRunning).toBe(true));
		act(() => result.current.stop());
		await waitFor(() => expect(onStopped).toHaveBeenCalled());
		expect(toast.success).toHaveBeenCalledWith("Timer stopped.");
		expect(cached()).toBeNull();
	});

	it("does nothing without a running timer", async () => {
		const stop = vi.spyOn(timeService, "stopEntry");
		const pause = vi.spyOn(timeService, "pauseEntry");
		const { result } = setup(null);
		act(() => {
			result.current.stop();
			result.current.pause();
			result.current.toggleBreak();
		});
		expect(stop).not.toHaveBeenCalled();
		expect(pause).not.toHaveBeenCalled();
		expect(result.current.workSeconds).toBe(0);
	});
});

describe("useRunningTaskId", () => {
	it("shares the running query", async () => {
		client = new QueryClient();
		client.setQueryData(timeKeys.running(USER), entry());
		vi.spyOn(timeService, "getRunning").mockResolvedValue(entry());
		const wrapper = ({ children }: { children: ReactNode }) =>
			createElement(QueryClientProvider, { client }, children);
		const { result } = renderHook(() => useRunningTaskId(), { wrapper });
		expect(result.current).toBe("task-1");
	});
});
