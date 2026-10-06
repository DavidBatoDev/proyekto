/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/lib/supabase";
import {
	invalidateTimeForNotification,
	mayTouchTime,
	TIME_NOTIFICATION_EVENTS,
	useNotificationsRealtime,
} from "./useNotificationsRealtime";

const KEYS = {
	overview: ["time", "me", "overview", "u1", "Asia/Manila"],
	approvalsCount: ["time", "approvals", "count", "u1"],
	approvalsList: ["time", "approvals", "list", "u1", { status: "submitted" }],
	myTimesheets: ["time", "me", "timesheets", "u1", { from: "", to: "" }],
	running: ["time", "me", "running", "u1"],
	entry: ["time", "entry", "e1"],
	payouts: ["payouts", "t1"],
	notifications: ["notifications", "list"],
	unread: ["notifications", "unread-count"],
	unrelated: ["dashboard", "projects", "u1"],
} as const;

const clients: QueryClient[] = [];

function seededClient(): QueryClient {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	clients.push(client);
	for (const key of Object.values(KEYS)) client.setQueryData(key, { ok: 1 });
	return client;
}

function invalidated(client: QueryClient, key: readonly unknown[]): boolean {
	return client.getQueryState(key)?.isInvalidated === true;
}

afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) client.clear();
	vi.restoreAllMocks();
});

describe("invalidateTimeForNotification", () => {
	it("always refreshes the time overview and the approval queue", async () => {
		const client = seededClient();
		// A DELETE (a withdrawn sheet clears the deciders' notification)
		// carries no type.
		await invalidateTimeForNotification(client, { new: {}, old: { id: 1 } });

		expect(invalidated(client, KEYS.overview)).toBe(true);
		expect(invalidated(client, KEYS.approvalsCount)).toBe(true);
		expect(invalidated(client, KEYS.approvalsList)).toBe(true);
		expect(invalidated(client, KEYS.myTimesheets)).toBe(false);
		expect(invalidated(client, KEYS.running)).toBe(false);
		expect(invalidated(client, KEYS.unrelated)).toBe(false);
	});

	it("refreshes what a timesheet notification moved", async () => {
		const client = seededClient();
		await invalidateTimeForNotification(client, {
			new: { id: 1, type: "timesheet_submitted" },
		});

		expect(invalidated(client, KEYS.myTimesheets)).toBe(true);
		expect(invalidated(client, KEYS.approvalsCount)).toBe(true);
		expect(invalidated(client, KEYS.payouts)).toBe(true);
		expect(invalidated(client, KEYS.running)).toBe(false);
		expect(invalidated(client, KEYS.unrelated)).toBe(false);
	});

	it("refreshes the running timer on a timer notification", async () => {
		const client = seededClient();
		await invalidateTimeForNotification(client, {
			new: { type: "timer_auto_stopped" },
		});

		expect(invalidated(client, KEYS.running)).toBe(true);
		expect(invalidated(client, KEYS.entry)).toBe(true);
		expect(invalidated(client, KEYS.payouts)).toBe(false);
	});

	it("maps every time notification type of ux.md to an event", () => {
		expect(Object.keys(TIME_NOTIFICATION_EVENTS).sort()).toEqual(
			[
				"time_log_comment_added",
				"time_payout_recorded",
				"timer_auto_stopped",
				"timer_running_long",
				"timesheet_approved",
				"timesheet_reminder",
				"timesheet_reopen_requested",
				"timesheet_reopened",
				"timesheet_returned",
				"timesheet_submitted",
				"timesheets_imported",
			].sort(),
		);
	});

	it("touches no time cache for a notification of another kind", async () => {
		const client = seededClient();
		await invalidateTimeForNotification(client, {
			new: { type: "chat_mention" },
		});

		// The overview is an active query on every page: a chat or mention
		// notification must not refetch it (or the queue) app-wide.
		expect(invalidated(client, KEYS.overview)).toBe(false);
		expect(invalidated(client, KEYS.approvalsCount)).toBe(false);
		expect(invalidated(client, KEYS.approvalsList)).toBe(false);
		expect(invalidated(client, KEYS.myTimesheets)).toBe(false);
		expect(invalidated(client, KEYS.entry)).toBe(false);
	});

	it("an unmapped time type (a legacy time_log_* row) still refreshes the overview and the queue", async () => {
		const client = seededClient();
		await invalidateTimeForNotification(client, {
			new: { type: "time_log_approval_requested" },
		});

		expect(invalidated(client, KEYS.overview)).toBe(true);
		expect(invalidated(client, KEYS.approvalsCount)).toBe(true);
		expect(invalidated(client, KEYS.myTimesheets)).toBe(false);
	});

	it("a type named like an Object member is not a mapped event", async () => {
		const client = seededClient();
		await expect(
			invalidateTimeForNotification(client, { new: { type: "constructor" } }),
		).resolves.toBeUndefined();
		expect(invalidated(client, KEYS.overview)).toBe(false);
	});
});

describe("mayTouchTime", () => {
	it("is true for time types and untyped changes, false otherwise", () => {
		for (const type of Object.keys(TIME_NOTIFICATION_EVENTS)) {
			expect(mayTouchTime(type)).toBe(true);
		}
		expect(mayTouchTime(null)).toBe(true);
		expect(mayTouchTime("time_log_pending")).toBe(true);
		expect(mayTouchTime("timesheet_something_new")).toBe(true);
		expect(mayTouchTime("timer_stopped")).toBe(true);
		expect(mayTouchTime("chat_mention")).toBe(false);
		expect(mayTouchTime("project_invite")).toBe(false);
		expect(mayTouchTime("timeline_updated")).toBe(false);
	});
});

describe("useNotificationsRealtime", () => {
	it("refreshes the bell and the time caches on a change, and unsubscribes", async () => {
		const client = seededClient();
		let handler: ((payload: unknown) => void) | null = null;
		const channel = {
			on: vi.fn(
				(_event: string, _filter: unknown, cb: (payload: unknown) => void) => {
					handler = cb;
					return channel;
				},
			),
			subscribe: vi.fn(() => channel),
		};
		const channelSpy = vi
			.spyOn(supabase, "channel")
			.mockReturnValue(
				channel as unknown as ReturnType<typeof supabase.channel>,
			);
		const removeChannel = vi
			.spyOn(supabase, "removeChannel")
			.mockResolvedValue("ok");

		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		);
		const { unmount } = renderHook(() => useNotificationsRealtime("u1"), {
			wrapper,
		});

		expect(channelSpy).toHaveBeenCalledWith("notifications:u1");
		expect(channel.on).toHaveBeenCalledWith(
			"postgres_changes",
			expect.objectContaining({
				table: "notifications",
				filter: "user_id=eq.u1",
			}),
			expect.any(Function),
		);
		expect(handler).not.toBeNull();

		(handler as unknown as (payload: unknown) => void)({
			eventType: "INSERT",
			new: { id: 1, type: "timesheets_imported" },
			old: {},
		});
		await vi.waitFor(() =>
			expect(invalidated(client, KEYS.myTimesheets)).toBe(true),
		);
		expect(invalidated(client, KEYS.notifications)).toBe(true);
		expect(invalidated(client, KEYS.unread)).toBe(true);
		expect(invalidated(client, KEYS.overview)).toBe(true);
		expect(invalidated(client, KEYS.approvalsList)).toBe(true);

		unmount();
		expect(removeChannel).toHaveBeenCalledWith(channel);
	});

	it("subscribes to nothing without a user", () => {
		const client = seededClient();
		const channelSpy = vi.spyOn(supabase, "channel");
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		);
		renderHook(() => useNotificationsRealtime(null), { wrapper });
		expect(channelSpy).not.toHaveBeenCalled();
	});
});
