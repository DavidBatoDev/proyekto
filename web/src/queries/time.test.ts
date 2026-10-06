/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeApiError, timeService } from "@/services/time.service";
import { EMPTY_TIME_OVERVIEW } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import {
	clearTimeOnUserChange,
	invalidateTime,
	retryTimeQuery,
	TIME_INVALIDATION,
	TIME_PREFIX,
	TIME_STALE,
	type TimeEvent,
	timeKeys,
	timeQueries,
	useTimeApprovalsCount,
	useTimeOverview,
} from "./time";

const USER = "user-1";
const TEAM = "11111111-1111-4111-8111-111111111111";

const clients: QueryClient[] = [];

function makeClient(): QueryClient {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, retryDelay: 0 } },
	});
	clients.push(client);
	return client;
}

function wrapperFor(client: QueryClient) {
	return ({ children }: { children: ReactNode }) =>
		createElement(QueryClientProvider, { client }, children);
}

function startsWith(key: readonly unknown[], prefix: readonly unknown[]) {
	return prefix.every((part, index) => key[index] === part);
}

beforeEach(() => {
	useAuthStore.setState({ user: { id: USER } as never });
});

afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) client.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
});

describe("timeKeys", () => {
	it("puts every key under ['time'] and the user on me keys", () => {
		expect(timeKeys.running(USER)).toEqual(["time", "me", "running", USER]);
		expect(timeKeys.running(null)).toEqual([
			"time",
			"me",
			"running",
			"anonymous",
		]);
		expect(timeKeys.overview(USER, "Asia/Manila")).toEqual([
			"time",
			"me",
			"overview",
			USER,
			"Asia/Manila",
		]);
		expect(timeKeys.approvalsCount(USER)).toEqual([
			"time",
			"approvals",
			"count",
			USER,
		]);
	});

	it("folds the wire params into list keys, so equal queries share a key", () => {
		const a = timeKeys.myEntries(USER, {
			from: "2026-09-29",
			to: "2026-10-05",
			for: { kind: "personal" },
			project_id: undefined,
		});
		const b = timeKeys.myEntries(USER, {
			to: "2026-10-05",
			from: "2026-09-29",
			for: { kind: "personal", id: null },
		});
		expect(a).toEqual(b);
		expect(a[4]).toEqual({
			from: "2026-09-29",
			to: "2026-10-05",
			for: "personal:",
		});

		expect(
			timeKeys.reportSummary({
				scope: { kind: "team", id: TEAM },
				from: "2026-09-01",
				to: "2026-09-30",
				group_by: "week",
			})[3],
		).toEqual({
			scope: `team:${TEAM}`,
			from: "2026-09-01",
			to: "2026-09-30",
			group_by: "week",
		});
		expect(timeKeys.projectPolicy("p-1", { kind: "team", id: TEAM })).toEqual([
			"time",
			"project-policy",
			"p-1",
			`team:${TEAM}`,
		]);
	});

	it("keeps each resource under its documented prefix", () => {
		const q = { from: "2026-09-01", to: "2026-09-30" };
		const report = { scope: { kind: "team" as const, id: TEAM }, ...q };
		const pairs: Array<[readonly unknown[], readonly unknown[]]> = [
			[timeKeys.running(USER), TIME_PREFIX.running],
			[timeKeys.overview(USER, "UTC"), TIME_PREFIX.overview],
			[timeKeys.myEntries(USER, q), TIME_PREFIX.myEntries],
			[timeKeys.mySummary(USER, q), TIME_PREFIX.mySummary],
			[timeKeys.preferences(USER), TIME_PREFIX.preferences],
			[timeKeys.myTimesheets(USER), TIME_PREFIX.myTimesheets],
			[timeKeys.myProjects(USER), TIME_PREFIX.myProjects],
			[timeKeys.loggingFor("p-1"), TIME_PREFIX.loggingFor],
			[timeKeys.projectPolicy("p-1"), TIME_PREFIX.projectPolicy],
			[timeKeys.workItems("p-1"), TIME_PREFIX.workItems],
			[timeKeys.loggers("p-1"), TIME_PREFIX.loggers],
			[timeKeys.entry("e-1"), TIME_PREFIX.entry],
			[timeKeys.entrySegments("e-1"), TIME_PREFIX.entry],
			[timeKeys.entryComments("e-1"), TIME_PREFIX.entry],
			[timeKeys.timesheet("s-1"), TIME_PREFIX.timesheet],
			[timeKeys.approvals(USER), TIME_PREFIX.approvals],
			[timeKeys.approvalsCount(USER), TIME_PREFIX.approvals],
			[timeKeys.reportEntries(report), TIME_PREFIX.reports],
			[timeKeys.reportSummary(report), TIME_PREFIX.reports],
			[timeKeys.workspacePolicy("w-1"), TIME_PREFIX.policy],
			[timeKeys.workspacePolicyHistory("w-1"), TIME_PREFIX.policy],
			[timeKeys.teamPolicy("t-1"), TIME_PREFIX.policy],
		];
		for (const [key, prefix] of pairs) {
			expect(startsWith(key, prefix), JSON.stringify(key)).toBe(true);
		}
	});

	it("never builds a team-time key", () => {
		const all = Object.values(TIME_PREFIX).flat();
		expect(all).not.toContain("team-time");
	});
});

describe("timeQueries", () => {
	it("polls the running timer every 3 s while it runs, 30 s otherwise", () => {
		const options = timeQueries.running(USER);
		const interval = options.refetchInterval as (query: {
			state: { data: unknown };
		}) => number;
		expect(interval({ state: { data: { id: "e-1" } } })).toBe(3000);
		expect(interval({ state: { data: null } })).toBe(30_000);
		expect(options.refetchIntervalInBackground).toBe(false);
		expect(options.enabled).toBe(true);
		expect(timeQueries.running(null).enabled).toBe(false);
	});

	it("keeps the overview 30 s and refetches it on focus", () => {
		const options = timeQueries.overview(USER, "UTC");
		expect(options.staleTime).toBe(30_000);
		expect(options.refetchOnWindowFocus).toBe(true);
		expect(options.refetchOnMount).toBe(true);
	});

	it("keeps logging-for 30 s and waits for a project", () => {
		expect(timeQueries.loggingFor("p-1").staleTime).toBe(TIME_STALE.loggingFor);
		expect(TIME_STALE.loggingFor).toBe(30_000);
		expect(timeQueries.loggingFor(null).enabled).toBe(false);
	});

	it("refetches on mount, since the app default is false", () => {
		for (const options of [
			timeQueries.entry("e-1"),
			timeQueries.timesheet("s-1"),
			timeQueries.approvals(USER),
			timeQueries.workspacePolicy("w-1"),
		]) {
			expect(options.refetchOnMount).toBe(true);
		}
	});

	it("waits for ids and ranges", () => {
		expect(timeQueries.timesheet(undefined).enabled).toBe(false);
		expect(
			timeQueries.myEntries(USER, { from: "", to: "2026-09-30" }).enabled,
		).toBe(false);
		expect(
			timeQueries.reportEntries({
				scope: { kind: "team", id: "" },
				from: "2026-09-01",
				to: "2026-09-30",
			}).enabled,
		).toBe(false);
	});

	it("queries call the matching service function", async () => {
		const spy = vi
			.spyOn(timeService, "getTimesheet")
			.mockResolvedValue({ sheet: { id: "s-1" } } as never);
		const client = makeClient();
		await client.fetchQuery(timeQueries.timesheet("s-1"));
		expect(spy).toHaveBeenCalledWith("s-1");
	});
});

describe("retryTimeQuery", () => {
	const error = (status: number) =>
		new TimeApiError({ status, code: `HTTP_${status}`, message: "x" });

	it("never retries an answer", () => {
		for (const status of [400, 403, 404, 409, 410, 422]) {
			expect(retryTimeQuery(0, error(status))).toBe(false);
		}
	});

	it("retries no response and 5xx twice", () => {
		expect(retryTimeQuery(0, error(0))).toBe(true);
		expect(retryTimeQuery(1, error(500))).toBe(true);
		expect(retryTimeQuery(2, error(503))).toBe(false);
		expect(retryTimeQuery(0, new Error("odd"))).toBe(true);
	});
});

describe("invalidateTime", () => {
	it("invalidates exactly the documented prefixes for each event", async () => {
		const client = makeClient();
		const spy = vi.spyOn(client, "invalidateQueries");
		const events = Object.keys(TIME_INVALIDATION) as TimeEvent[];
		for (const event of events) {
			spy.mockClear();
			await invalidateTime(client, event);
			expect(spy.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
				...TIME_INVALIDATION[event],
			]);
		}
	});

	it("covers payouts on sheet and payout events, and nothing else does", () => {
		expect(TIME_INVALIDATION.sheet).toContainEqual(["payouts"]);
		expect(TIME_INVALIDATION.payout).toContainEqual(["payouts"]);
		for (const event of [
			"entry",
			"policy",
			"preferences",
			"comment",
		] as const) {
			expect(TIME_INVALIDATION[event]).not.toContainEqual(["payouts"]);
		}
		expect(TIME_INVALIDATION.comment).toEqual([["time", "entry"]]);
	});

	it("refreshes the loggable projects (A9 default_kind, last_logged_at) after entry writes", () => {
		expect(TIME_INVALIDATION.entry).toContainEqual(TIME_PREFIX.myProjects);
		expect(TIME_INVALIDATION.entry).toContainEqual(TIME_PREFIX.loggingFor);
	});

	it("dedupes keys across several events", async () => {
		const client = makeClient();
		const spy = vi.spyOn(client, "invalidateQueries");
		await invalidateTime(client, ["entry", "sheet"]);
		const keys = spy.mock.calls.map(([filters]) =>
			JSON.stringify(filters?.queryKey),
		);
		expect(new Set(keys).size).toBe(keys.length);
		expect(keys).toContain(JSON.stringify(["payouts"]));
		expect(keys).toContain(JSON.stringify(["time", "me", "running"]));
	});

	it("marks matching cached queries stale and leaves the rest", async () => {
		const client = makeClient();
		const runningKey = timeKeys.running(USER);
		const sheetKey = timeKeys.timesheet("s-1");
		const policyKey = timeKeys.workspacePolicy("w-1");
		const payoutsKey = ["payouts", "team-1", "approved-logs"];
		for (const key of [runningKey, sheetKey, policyKey, payoutsKey]) {
			client.setQueryData(key, { ok: true });
		}

		await invalidateTime(client, "entry");
		expect(client.getQueryState(runningKey)?.isInvalidated).toBe(true);
		expect(client.getQueryState(sheetKey)?.isInvalidated).toBe(true);
		expect(client.getQueryState(policyKey)?.isInvalidated).toBe(false);
		expect(client.getQueryState(payoutsKey)?.isInvalidated).toBe(false);

		await invalidateTime(client, "sheet");
		expect(client.getQueryState(payoutsKey)?.isInvalidated).toBe(true);
		expect(client.getQueryState(policyKey)?.isInvalidated).toBe(false);

		await invalidateTime(client, "policy");
		expect(client.getQueryState(policyKey)?.isInvalidated).toBe(true);
	});
});

describe("clearTimeOnUserChange", () => {
	function seed(client: QueryClient) {
		client.setQueryData(timeKeys.timesheet("s1"), { id: "s1" });
		client.setQueryData(timeKeys.entry("e1"), { id: "e1" });
		client.setQueryData(timeKeys.running(USER), null);
		client.setQueryData(["payouts", TEAM], []);
		client.setQueryData(["projects", "list"], []);
	}
	function timeKeysLeft(client: QueryClient) {
		return client
			.getQueryCache()
			.getAll()
			.map((query) => query.queryKey[0]);
	}

	it("drops the time tree and the payout pages when another account signs in", () => {
		const client = makeClient();
		const stop = clearTimeOnUserChange(client);
		seed(client);
		useAuthStore.setState({ user: { id: "user-2" } as never });
		expect(timeKeysLeft(client)).toEqual(["projects"]);
		stop();
	});

	it("drops them on sign-out, and not on the first sign-in or a token refresh", () => {
		const client = makeClient();
		useAuthStore.setState({ user: null });
		const stop = clearTimeOnUserChange(client);
		seed(client);
		// No one → someone: nothing of anyone else's to drop.
		useAuthStore.setState({ user: { id: USER } as never });
		// The same user again (a refreshed session).
		useAuthStore.setState({ user: { id: USER, email: "x" } as never });
		expect(timeKeysLeft(client)).toHaveLength(5);
		useAuthStore.setState({ user: null });
		expect(timeKeysLeft(client)).toEqual(["projects"]);
		stop();
		// Unsubscribed: nothing happens any more.
		seed(client);
		useAuthStore.setState({ user: { id: "user-3" } as never });
		expect(timeKeysLeft(client)).toHaveLength(5);
	});
});

describe("useTimeOverview", () => {
	it("sends the browser timezone", async () => {
		vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
			timeZone: "Asia/Manila",
		} as Intl.ResolvedDateTimeFormatOptions);
		const spy = vi
			.spyOn(timeService, "getOverview")
			.mockResolvedValue({ ...EMPTY_TIME_OVERVIEW, can_log: true });
		const client = makeClient();

		const { result } = renderHook(() => useTimeOverview(), {
			wrapper: wrapperFor(client),
		});

		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(spy).toHaveBeenCalledWith({ tz: "Asia/Manila" });
		expect(result.current.data?.can_log).toBe(true);
		expect(
			client.getQueryData(timeKeys.overview(USER, "Asia/Manila")),
		).toBeDefined();
	});

	it("waits for a signed-in user", () => {
		useAuthStore.setState({ user: null });
		const spy = vi.spyOn(timeService, "getOverview");
		const { result } = renderHook(() => useTimeOverview(), {
			wrapper: wrapperFor(makeClient()),
		});
		expect(result.current.fetchStatus).toBe("idle");
		expect(spy).not.toHaveBeenCalled();
	});
});

describe("useTimeApprovalsCount", () => {
	it("reads the waiting count", async () => {
		vi.spyOn(timeService, "getApprovalsCount").mockResolvedValue({
			waiting: 4,
		});
		const { result } = renderHook(() => useTimeApprovalsCount(), {
			wrapper: wrapperFor(makeClient()),
		});
		await waitFor(() => expect(result.current.data?.waiting).toBe(4));
	});
});
