// web/src/queries/time.ts
//
// Query keys, query options and invalidation for `/api/time`. Every key sits
// under `["time", …]`; the second segment names the resource so one prefix
// reaches every variant of it (see TIME_INVALIDATION). Keys under
// `["time", "me", <resource>, <userId>, …]` and the approval queue carry the
// signed-in user, so a sign-out and sign-in in the same tab never shows the
// previous person's time.
//
// The app's QueryClient defaults to `refetchOnMount: false` and
// `refetchOnWindowFocus: false`. Time data goes stale under people's feet
// (timers, approvals, other devices), so every option here sets
// `refetchOnMount: true`: an invalidated query that was not on screen
// refetches when it comes back instead of showing the old answer.

import {
	type QueryClient,
	type QueryKey,
	queryOptions,
	useQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { httpStatusOf } from "@/lib/apiErrors";
import {
	approvalsParams,
	browserTimeZone,
	myEntriesParams,
	reportParams,
	timeService,
	toForParam,
} from "@/services/time.service";
import type {
	ApprovalsQuery,
	DateRangeQuery,
	LoggingForRequest,
	MyEntriesQuery,
	MyTimesheetsQuery,
	PageQuery,
	ReportQuery,
} from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";

const ANON = "anonymous";
const SECOND = 1000;

/** Stale times and polling (web blueprint §3 W0-A). */
export const TIME_STALE = {
	/** `me/overview`: 30 s, refetched on focus. */
	overview: 30 * SECOND,
	/** `logging-for`: 30 s (the server caches 30 s too). */
	loggingFor: 30 * SECOND,
	/** `me/running` polls every 3 s while a timer runs. */
	runningPoll: 3 * SECOND,
	/** …and every 30 s while none does. */
	idlePoll: 30 * SECOND,
	/** `me/projects`: 30 s (the server caches 30 s per user). */
	myProjects: 30 * SECOND,
	/** `approvals/count`: 30 s, refetched on focus (sidebar badge). */
	approvalsCount: 30 * SECOND,
	/** Work items and preferences change rarely. */
	slow: 5 * 60 * SECOND,
} as const;

// ── Keys ────────────────────────────────────────────────────────────────────

type Params = Record<string, string | number | boolean>;

export const timeKeys = {
	all: ["time"] as const,

	// Me (user-scoped)
	me: () => ["time", "me"] as const,
	running: (userId: string | null | undefined) =>
		["time", "me", "running", userId ?? ANON] as const,
	overview: (userId: string | null | undefined, tz?: string | null) =>
		["time", "me", "overview", userId ?? ANON, tz ?? ""] as const,
	myEntries: (userId: string | null | undefined, query: MyEntriesQuery) =>
		[
			"time",
			"me",
			"entries",
			userId ?? ANON,
			myEntriesParams(query) as Params,
		] as const,
	mySummary: (userId: string | null | undefined, query: DateRangeQuery) =>
		[
			"time",
			"me",
			"summary",
			userId ?? ANON,
			{ from: query.from, to: query.to },
		] as const,
	preferences: (userId: string | null | undefined) =>
		["time", "me", "preferences", userId ?? ANON] as const,
	myTimesheets: (
		userId: string | null | undefined,
		query: MyTimesheetsQuery = {},
	) =>
		[
			"time",
			"me",
			"timesheets",
			userId ?? ANON,
			{ from: query.from ?? "", to: query.to ?? "" },
		] as const,
	myProjects: (userId: string | null | undefined) =>
		["time", "me", "projects", userId ?? ANON] as const,

	// Project pickers
	loggingFor: (projectId: string) =>
		["time", "logging-for", projectId] as const,
	projectPolicy: (projectId: string, forRef?: LoggingForRequest | null) =>
		["time", "project-policy", projectId, toForParam(forRef) ?? ""] as const,
	workItems: (projectId: string) => ["time", "work-items", projectId] as const,
	loggers: (projectId: string) => ["time", "loggers", projectId] as const,

	// Entries
	entry: (entryId: string) => ["time", "entry", entryId] as const,
	entrySegments: (entryId: string) =>
		["time", "entry", entryId, "segments"] as const,
	entryComments: (entryId: string) =>
		["time", "entry", entryId, "comments"] as const,

	// Timesheets and approvals
	timesheet: (timesheetId: string) =>
		["time", "timesheet", timesheetId] as const,
	approvals: (userId: string | null | undefined, query: ApprovalsQuery = {}) =>
		[
			"time",
			"approvals",
			"list",
			userId ?? ANON,
			approvalsParams(query) as Params,
		] as const,
	approvalsCount: (userId: string | null | undefined) =>
		["time", "approvals", "count", userId ?? ANON] as const,

	// Reports
	reportEntries: (query: ReportQuery) =>
		["time", "reports", "entries", reportParams(query) as Params] as const,
	reportSummary: (query: ReportQuery) =>
		["time", "reports", "summary", reportParams(query) as Params] as const,

	// Policies
	workspacePolicy: (workspaceId: string) =>
		["time", "policy", "workspace", workspaceId] as const,
	workspacePolicyHistory: (workspaceId: string, query: PageQuery = {}) =>
		[
			"time",
			"policy",
			"workspace",
			workspaceId,
			"history",
			{ page: query.page ?? 1, limit: query.limit ?? 0 },
		] as const,
	teamPolicy: (teamId: string) => ["time", "policy", "team", teamId] as const,
};

// ── Retry ───────────────────────────────────────────────────────────────────

/**
 * Retry only what could change on its own: no response (status 0) or a 5xx,
 * at most twice. A 4xx is an answer (a miss, a refusal, a flow code).
 */
export function retryTimeQuery(failureCount: number, error: unknown): boolean {
	const status = httpStatusOf(error);
	if (status !== null && status > 0 && status < 500) return false;
	return failureCount < 2;
}

// ── Query options ───────────────────────────────────────────────────────────

const base = {
	refetchOnMount: true,
	retry: retryTimeQuery,
} as const;

export const timeQueries = {
	/** Polls every 3 s while a timer runs, 30 s otherwise; never in a background tab. */
	running: (userId: string | null | undefined) =>
		queryOptions({
			...base,
			queryKey: timeKeys.running(userId),
			queryFn: () => timeService.getRunning(),
			enabled: Boolean(userId),
			staleTime: 0,
			refetchInterval: (query) =>
				query.state.data ? TIME_STALE.runningPoll : TIME_STALE.idlePoll,
			refetchIntervalInBackground: false,
			refetchOnWindowFocus: true,
			retry: 1,
		}),

	overview: (userId: string | null | undefined, tz?: string | null) =>
		queryOptions({
			...base,
			queryKey: timeKeys.overview(userId, tz),
			queryFn: () => timeService.getOverview({ tz: tz ?? undefined }),
			enabled: Boolean(userId),
			staleTime: TIME_STALE.overview,
			refetchOnWindowFocus: true,
		}),

	myEntries: (userId: string | null | undefined, query: MyEntriesQuery) =>
		queryOptions({
			...base,
			queryKey: timeKeys.myEntries(userId, query),
			queryFn: () => timeService.listMyEntries(query),
			enabled: Boolean(userId && query.from && query.to),
		}),

	mySummary: (userId: string | null | undefined, query: DateRangeQuery) =>
		queryOptions({
			...base,
			queryKey: timeKeys.mySummary(userId, query),
			queryFn: () => timeService.getMySummary(query),
			enabled: Boolean(userId && query.from && query.to),
		}),

	preferences: (userId: string | null | undefined) =>
		queryOptions({
			...base,
			queryKey: timeKeys.preferences(userId),
			queryFn: () => timeService.getPreferences(),
			enabled: Boolean(userId),
			staleTime: TIME_STALE.slow,
		}),

	myTimesheets: (
		userId: string | null | undefined,
		query: MyTimesheetsQuery = {},
	) =>
		queryOptions({
			...base,
			queryKey: timeKeys.myTimesheets(userId, query),
			queryFn: () => timeService.listMyTimesheets(query),
			enabled: Boolean(userId),
		}),

	/** A9. */
	myProjects: (userId: string | null | undefined) =>
		queryOptions({
			...base,
			queryKey: timeKeys.myProjects(userId),
			queryFn: () => timeService.listMyProjects(),
			enabled: Boolean(userId),
			staleTime: TIME_STALE.myProjects,
		}),

	loggingFor: (projectId: string | null | undefined) =>
		queryOptions({
			...base,
			queryKey: timeKeys.loggingFor(projectId ?? ""),
			queryFn: () => timeService.getLoggingFor(projectId as string),
			enabled: Boolean(projectId),
			staleTime: TIME_STALE.loggingFor,
		}),

	projectPolicy: (
		projectId: string | null | undefined,
		forRef?: LoggingForRequest | null,
	) =>
		queryOptions({
			...base,
			queryKey: timeKeys.projectPolicy(projectId ?? "", forRef),
			queryFn: () => timeService.getProjectPolicy(projectId as string, forRef),
			enabled: Boolean(projectId),
		}),

	workItems: (projectId: string | null | undefined) =>
		queryOptions({
			...base,
			queryKey: timeKeys.workItems(projectId ?? ""),
			queryFn: () => timeService.getWorkItems(projectId as string),
			enabled: Boolean(projectId),
			staleTime: TIME_STALE.slow,
		}),

	/** A11. */
	loggers: (projectId: string | null | undefined) =>
		queryOptions({
			...base,
			queryKey: timeKeys.loggers(projectId ?? ""),
			queryFn: () => timeService.getProjectLoggers(projectId as string),
			enabled: Boolean(projectId),
		}),

	entry: (entryId: string | null | undefined) =>
		queryOptions({
			...base,
			queryKey: timeKeys.entry(entryId ?? ""),
			queryFn: () => timeService.getEntry(entryId as string),
			enabled: Boolean(entryId),
		}),

	entrySegments: (entryId: string | null | undefined) =>
		queryOptions({
			...base,
			queryKey: timeKeys.entrySegments(entryId ?? ""),
			queryFn: () => timeService.listEntrySegments(entryId as string),
			enabled: Boolean(entryId),
		}),

	entryComments: (entryId: string | null | undefined) =>
		queryOptions({
			...base,
			queryKey: timeKeys.entryComments(entryId ?? ""),
			queryFn: () => timeService.listEntryComments(entryId as string),
			enabled: Boolean(entryId),
		}),

	timesheet: (timesheetId: string | null | undefined) =>
		queryOptions({
			...base,
			queryKey: timeKeys.timesheet(timesheetId ?? ""),
			queryFn: () => timeService.getTimesheet(timesheetId as string),
			enabled: Boolean(timesheetId),
		}),

	approvals: (userId: string | null | undefined, query: ApprovalsQuery = {}) =>
		queryOptions({
			...base,
			queryKey: timeKeys.approvals(userId, query),
			queryFn: () => timeService.listApprovals(query),
			enabled: Boolean(userId),
		}),

	approvalsCount: (userId: string | null | undefined) =>
		queryOptions({
			...base,
			queryKey: timeKeys.approvalsCount(userId),
			queryFn: () => timeService.getApprovalsCount(),
			enabled: Boolean(userId),
			staleTime: TIME_STALE.approvalsCount,
			refetchOnWindowFocus: true,
		}),

	reportEntries: (query: ReportQuery) =>
		queryOptions({
			...base,
			queryKey: timeKeys.reportEntries(query),
			queryFn: () => timeService.getReportEntries(query),
			enabled: Boolean(query.scope.id && query.from && query.to),
		}),

	reportSummary: (query: ReportQuery) =>
		queryOptions({
			...base,
			queryKey: timeKeys.reportSummary(query),
			queryFn: () => timeService.getReportSummary(query),
			enabled: Boolean(query.scope.id && query.from && query.to),
		}),

	workspacePolicy: (
		workspaceId: string | null | undefined,
		options: { tz?: string } = {},
	) =>
		queryOptions({
			...base,
			queryKey: timeKeys.workspacePolicy(workspaceId ?? ""),
			queryFn: () =>
				timeService.getWorkspacePolicy(workspaceId as string, {
					tz: options.tz,
				}),
			enabled: Boolean(workspaceId),
		}),

	/** A7. */
	workspacePolicyHistory: (
		workspaceId: string | null | undefined,
		query: PageQuery = {},
	) =>
		queryOptions({
			...base,
			queryKey: timeKeys.workspacePolicyHistory(workspaceId ?? "", query),
			queryFn: () =>
				timeService.getWorkspacePolicyHistory(workspaceId as string, query),
			enabled: Boolean(workspaceId),
		}),

	teamPolicy: (teamId: string | null | undefined) =>
		queryOptions({
			...base,
			queryKey: timeKeys.teamPolicy(teamId ?? ""),
			queryFn: () => timeService.getTeamPolicy(teamId as string),
			enabled: Boolean(teamId),
		}),
};

// ── Invalidation ────────────────────────────────────────────────────────────

/** What just changed. */
export type TimeEvent =
	| "entry"
	| "sheet"
	| "policy"
	| "preferences"
	| "payout"
	| "comment";

/** Resource prefixes (every key of a resource starts with one of these). */
export const TIME_PREFIX = {
	running: ["time", "me", "running"],
	overview: ["time", "me", "overview"],
	myEntries: ["time", "me", "entries"],
	mySummary: ["time", "me", "summary"],
	preferences: ["time", "me", "preferences"],
	myTimesheets: ["time", "me", "timesheets"],
	myProjects: ["time", "me", "projects"],
	loggingFor: ["time", "logging-for"],
	projectPolicy: ["time", "project-policy"],
	workItems: ["time", "work-items"],
	loggers: ["time", "loggers"],
	entry: ["time", "entry"],
	timesheet: ["time", "timesheet"],
	approvals: ["time", "approvals"],
	reports: ["time", "reports"],
	policy: ["time", "policy"],
	/** Outside the time tree: the team payout pages (`["payouts", teamId, …]`). */
	payouts: ["payouts"],
} as const satisfies Record<string, QueryKey>;

const P = TIME_PREFIX;

/**
 * The exact prefixes each event invalidates.
 *
 * - `entry` (start, stop, pause, resume, create, edit, delete, change For):
 *   the running timer, the person's lists, summary, overview (current sheet
 *   totals) and timesheets; the For picker and the loggable projects (A9:
 *   a `remember: true` write moves the remembered default, `default_kind`,
 *   and any write moves `last_logged_at`, the picker's order); entry and
 *   timesheet details; reports.
 * - `sheet` (submit, withdraw, approve, return, reopen, request reopen, bulk
 *   approve): timesheet details and lists, the approval queue and its count,
 *   overview, the person's entries and summary (lock state, approved time),
 *   entry details, reports, and `["payouts"]` (approved time becomes owed).
 * - `policy` (workspace or team policy write or delete): the policy views and
 *   history, the For picker and per-option policy, work items (hidden
 *   presets), the loggable projects (A9) and loggers (A11), overview (the
 *   confirm card), timesheets (routing preview, A1), the person's entries
 *   (context timezone) and reports (week grouping).
 * - `preferences` (timezone, week start): preferences, overview, the person's
 *   entries and summary.
 * - `payout` (record or void a payment): `["payouts"]`, entry and timesheet
 *   details (paid locks), the person's entries and reports.
 * - `comment`: entry details, which include each entry's comments.
 */
export const TIME_INVALIDATION: Readonly<
	Record<TimeEvent, readonly QueryKey[]>
> = {
	entry: [
		P.running,
		P.myEntries,
		P.mySummary,
		P.overview,
		P.myTimesheets,
		P.loggingFor,
		P.myProjects,
		P.entry,
		P.timesheet,
		P.reports,
	],
	sheet: [
		P.timesheet,
		P.myTimesheets,
		P.approvals,
		P.overview,
		P.myEntries,
		P.mySummary,
		P.entry,
		P.reports,
		P.payouts,
	],
	policy: [
		P.policy,
		P.projectPolicy,
		P.loggingFor,
		P.workItems,
		P.myProjects,
		P.loggers,
		P.overview,
		P.timesheet,
		P.myTimesheets,
		P.myEntries,
		P.reports,
	],
	preferences: [P.preferences, P.overview, P.myEntries, P.mySummary],
	payout: [P.payouts, P.entry, P.timesheet, P.myEntries, P.reports],
	comment: [P.entry],
};

/** Invalidates what `event` (or each of `events`) changed; see TIME_INVALIDATION. */
export async function invalidateTime(
	queryClient: QueryClient,
	event: TimeEvent | readonly TimeEvent[],
): Promise<void> {
	const events: readonly TimeEvent[] =
		typeof event === "string" ? [event] : event;
	const seen = new Set<string>();
	const keys: QueryKey[] = [];
	for (const name of events) {
		for (const key of TIME_INVALIDATION[name]) {
			const id = JSON.stringify(key);
			if (seen.has(id)) continue;
			seen.add(id);
			keys.push(key);
		}
	}
	await Promise.all(
		keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
	);
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** The signed-in user's id, or null. */
function useTimeUserId(): string | null {
	return useAuthStore((state) => state.user?.id ?? null);
}

/**
 * `GET /time/me/overview` with the browser timezone (it seeds a missing
 * `user_time_preferences` row, L29). 30 s stale, refetched on focus.
 */
export function useTimeOverview(options: { enabled?: boolean } = {}) {
	const userId = useTimeUserId();
	const tz = useMemo(() => browserTimeZone(), []);
	return useQuery({
		...timeQueries.overview(userId, tz),
		enabled: Boolean(userId) && options.enabled !== false,
	});
}

/** `GET /time/approvals/count` for the sidebar badge and the dashboard card. */
export function useTimeApprovalsCount(options: { enabled?: boolean } = {}) {
	const userId = useTimeUserId();
	return useQuery({
		...timeQueries.approvalsCount(userId),
		enabled: Boolean(userId) && options.enabled !== false,
	});
}
