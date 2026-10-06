// web/src/components/home/dashboardTimeLine.ts
//
// What the dashboard says about time (ux.md › Approvals › Dashboard card, and
// the welcome line after it):
//
// - the "Waiting for your approval" card in DashboardWidgets' `leadContent`
//   slot, shown when the viewer has timesheets to decide (N > 0). It is not
//   filtered by workspace; a row whose sheet belongs to another workspace is
//   tagged with that workspace (E27);
// - the welcome line's "· 3 timesheets waiting" (deciders, to /time#waiting)
//   and "· Submit last week (28h 45m)" (loggers with an overdue Open sheet that
//   is not routed auto/self, to /time?week=<period_start>).
//
// The card and the line both read `useDashboardTime()`, so they share one set
// of queries and can never disagree on the count. The pure helpers below are
// what the tests pin; the copy is ux.md's.

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
	deviceTimeZone,
	formatDurationText,
	formatPeriodRange,
	sheetStatusView,
} from "@/lib/timeFormat";
import {
	addDays,
	daysBetween,
	localDate,
	safeTimezone,
} from "@/lib/timePeriods";
import {
	useTourDemo,
	useTourDemoActive,
} from "@/lib/tours/demo/TourDemoContext";
import { timeQueries, useTimeOverview } from "@/queries/time";
import type { ApprovalRow, TimesheetSummary } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";

// ── Copy (ux.md › Approvals › Dashboard card) ───────────────────────────────

export const TIME_APPROVALS_TITLE = "Waiting for your approval";
export const TIME_APPROVALS_REVIEW_ALL = "Review all";

/** Rows the dashboard card lists before "+N more" (the ux.md mock shows two). */
export const DASHBOARD_APPROVAL_ROWS = 2;

/**
 * How far back the welcome line looks for an overdue Open sheet. Long enough
 * to hold the last finished period of any kind (a month is at most 31 days).
 */
export const DASHBOARD_SHEETS_LOOKBACK_DAYS = 35;

/** Tour-replay fixture keys (lib/tours/demo/dashboardDemoDataset.ts). */
export const TIME_DEMO_KEYS = {
	approvals: "timeApprovals",
	timesheets: "timeTimesheets",
} as const;

/** "3 timesheets waiting" (welcome line, sidebar badge's screen-reader label). */
export function timesheetsWaitingText(count: number): string {
	const n = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
	return n === 1 ? "1 timesheet waiting" : `${n} timesheets waiting`;
}

/** "+1 more" under the card's rows. */
export function moreApprovalsText(count: number): string {
	return `+${Math.max(0, Math.floor(count))} more`;
}

/** A waiting sheet's hours: the total frozen at submit, else what is logged now. */
export function approvalRowSeconds(row: ApprovalRow): number {
	return row.total_seconds ?? row.logged_seconds ?? 0;
}

/** The person a waiting sheet belongs to. */
export function approvalRowName(row: ApprovalRow): string {
	return (
		row.member?.display_name?.trim() ||
		row.member_display_name_snapshot?.trim() ||
		"Someone"
	);
}

/**
 * E27: tag a row with its sheet's policy workspace when that differs from the
 * dashboard's workspace. The backend sends `policy_workspace` on every row it
 * can name (it does not know the viewer's current workspace), so the
 * comparison happens here. `undefined` (the workspace is still loading) tags
 * nothing; `null` (no current workspace) tags every row that has one.
 */
export function policyWorkspaceTag(
	row: Pick<ApprovalRow, "policy_workspace">,
	currentWorkspaceId: string | null | undefined,
): string | null {
	if (currentWorkspaceId === undefined) return null;
	const ws = row.policy_workspace;
	if (!ws?.id || ws.id === currentWorkspaceId) return null;
	return ws.name?.trim() || null;
}

// ── "Submit last week" ──────────────────────────────────────────────────────

export interface SubmitNudge {
	/** The overdue period's first day: the `/time?week=` target. */
	weekStart: string;
	/** Σ logged seconds of the overdue sheets of that period. */
	seconds: number;
	/** "Submit last week (28h 45m)" or "Submit Sep 1–30 (120h)". */
	text: string;
	sheetIds: string[];
}

/**
 * The welcome line's nudge: the most recent period with an overdue Open sheet
 * that is not routed `auto`/`self` (those send themselves) and holds time.
 * Overdue means past the period's last day in the sheet's own timezone, the
 * same rule as the card's "Open · overdue" (`sheetStatusView`). Sheets of the
 * same period (a team sheet and an agreement sheet) are summed. A weekly
 * period that ended within the last 7 days reads "last week"; anything else
 * names its dates.
 */
export function submitNudge(
	sheets: readonly TimesheetSummary[] | null | undefined,
	options: { now?: Date; userTimezone?: string } = {},
): SubmitNudge | null {
	const now = options.now ?? new Date();
	const overdue = (sheets ?? []).filter(
		(sheet) =>
			sheet.status === "open" &&
			(sheet.logged_seconds ?? 0) > 0 &&
			sheetStatusView(sheet, { now }).overdue,
	);
	if (overdue.length === 0) return null;

	let latest = overdue[0].period_start;
	for (const sheet of overdue) {
		if (sheet.period_start > latest) latest = sheet.period_start;
	}
	const group = overdue.filter((sheet) => sheet.period_start === latest);
	let end = group[0].period_end;
	let seconds = 0;
	for (const sheet of group) {
		if (sheet.period_end > end) end = sheet.period_end;
		seconds += Math.max(0, sheet.logged_seconds ?? 0);
	}

	const today = localDate(now, safeTimezone(group[0].timezone));
	const lastWeek =
		group.every((sheet) => sheet.period_kind === "weekly") &&
		daysBetween(end, today) <= 7;
	const when = lastWeek
		? "last week"
		: formatPeriodRange(latest, end, {
				now,
				userTimezone: options.userTimezone,
			});

	return {
		weekStart: latest,
		seconds,
		text: `Submit ${when} (${formatDurationText(seconds)})`,
		sheetIds: group.map((sheet) => sheet.id),
	};
}

// ── The shared hook ─────────────────────────────────────────────────────────

/** The card's rows: the first page of the waiting queue and its total. */
export interface DashboardTimeApprovals {
	total: number;
	rows: ApprovalRow[];
}

export interface DashboardTime {
	/**
	 * How many timesheets wait on the viewer. The queue's total once loaded;
	 * until then (or when it fails) the overview's `approvals_waiting`, so the
	 * card header and the welcome line do not wait on the list.
	 */
	waitingCount: number;
	/** The loaded rows, or null while loading, on failure, or when nothing waits. */
	approvals: DashboardTimeApprovals | null;
	/** The rows are on their way (render the card's skeleton). */
	approvalsLoading: boolean;
	/** "Submit last week (28h 45m)", or null. */
	nudge: SubmitNudge | null;
}

/**
 * The dashboard's time data. Reads the overview (shared with the sidebar,
 * so usually cached), then only what it needs: the first rows of the waiting
 * queue when something waits, and the viewer's recent timesheets when they
 * can log. During a tour replay both are swapped for fixtures.
 */
export function useDashboardTime(options: { now?: Date } = {}): DashboardTime {
	const userId = useAuthStore((state) => state.user?.id ?? null);
	const demo = useTourDemoActive();
	const nowMs = options.now?.getTime() ?? null;

	const overview = useTimeOverview().data;
	const waitingHint = Math.max(0, overview?.approvals_waiting ?? 0);
	const canLog = overview?.can_log === true;

	const approvalsQuery = useQuery({
		...timeQueries.approvals(userId, {
			status: "submitted",
			limit: DASHBOARD_APPROVAL_ROWS,
		}),
		enabled: Boolean(userId) && waitingHint > 0 && !demo,
	});

	// The lookback starts from today on this device; it only widens the
	// window, so a timezone a day off changes nothing that matters.
	const from = useMemo(() => {
		const now = nowMs === null ? new Date() : new Date(nowMs);
		return addDays(
			localDate(now, deviceTimeZone()),
			-DASHBOARD_SHEETS_LOOKBACK_DAYS,
		);
	}, [nowMs]);
	const sheetsQuery = useQuery({
		...timeQueries.myTimesheets(userId, { from }),
		enabled: Boolean(userId) && canLog && !demo,
	});

	const realApprovals = useMemo<DashboardTimeApprovals | null>(() => {
		const page = approvalsQuery.data;
		if (waitingHint <= 0 || !page) return null;
		return { total: Math.max(0, page.total ?? 0), rows: page.items ?? [] };
	}, [approvalsQuery.data, waitingHint]);
	const approvals = useTourDemo<DashboardTimeApprovals | null>(
		TIME_DEMO_KEYS.approvals,
		realApprovals,
	);
	const sheets = useTourDemo<TimesheetSummary[]>(
		TIME_DEMO_KEYS.timesheets,
		sheetsQuery.data ?? [],
	);

	const nudge = useMemo(
		() =>
			submitNudge(sheets, {
				now: nowMs === null ? undefined : new Date(nowMs),
			}),
		[sheets, nowMs],
	);

	const waitingCount = approvals ? approvals.total : demo ? 0 : waitingHint;

	return {
		waitingCount,
		approvals,
		approvalsLoading:
			!demo && !approvals && waitingHint > 0 && approvalsQuery.isPending,
		nudge,
	};
}
