import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import {
	retroSummary,
	roundingSummary,
} from "@/components/team/settings/time/TeamRulesSection";
import {
	SettingsSection,
	settingsButton,
} from "@/components/workspace/settings/SettingsPrimitives";
import { isNativeApp } from "@/lib/platform";
import { nativeSafe, timeErrorMessage } from "@/lib/timeErrors";
import {
	type DateFormatOptions,
	deviceTimeZone,
	formatInstantDay,
	formatLocalDay,
	formatMinutesText,
	periodKindLabel,
	weekdayName,
	workItemLabel,
} from "@/lib/timeFormat";
import { isLocalDate } from "@/lib/timePeriods";
import { cn } from "@/lib/utils";
import { retryTimeQuery, timeKeys } from "@/queries/time";
import { isTimeApiError, timeService } from "@/services/time.service";
import type {
	PeriodKind,
	PolicyHistoryKind,
	PolicyHistoryRow,
	PresetWorkItem,
} from "@/services/time.types";

/**
 * Workspace settings › Time › History (A7, ux.md › Workspace Time Policy:
 * "Changed by Ana Reyes, Oct 2: period weekly → twice a month [Show all]").
 *
 * Reads `GET /time/policies/workspaces/:id/history` (workspace owners and
 * admins only; anyone else gets a 404 and the section renders nothing): the
 * workspace policy's audit rows plus the overrides of the workspace's teams,
 * newest first. The latest row shows on its own; **Show all** opens the list
 * in place, 20 rows a page with **Show more**. A "Looks right" confirmation
 * reads "Confirmed (no changes)" (D81).
 */

export const POLICY_HISTORY_COPY = {
	title: "History",
	empty: "No changes yet.",
	showAll: "Show all",
	showLess: "Show less",
	showMore: "Show more",
	loading: "Loading history",
	retry: "Try again",
	listLabel: "Time policy history",
} as const;

export const POLICY_HISTORY_PAGE_SIZE = 20;

/** Under `["time","policy","workspace",id]`, so a policy write refreshes it. */
export function policyHistoryFeedKey(workspaceId: string) {
	return [
		...timeKeys.workspacePolicy(workspaceId),
		"history",
		"feed",
		{ limit: POLICY_HISTORY_PAGE_SIZE },
	] as const;
}

// ── Lines ───────────────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
	tracking_enabled: "time on workspace projects",
	tracking_mode: "tracking",
	period_kind: "period",
	week_start: "week start",
	timezone: "timezone",
	period_anchor: "period start date",
	approval_required: "approval",
	approver_scope: "approvers",
	allow_manual_entries: "manual time",
	retroactive_days: "manual time window",
	rounding_minutes: "rounding",
	weekly_limit_minutes: "weekly limit",
	reminder_days: "reminder",
	hidden_presets: "hidden presets",
};

/** The order fields are listed in, so a line reads the way the form does. */
const FIELD_ORDER = Object.keys(FIELD_LABELS);

/** "rounding", "manual time window"; unknown keys read as words. */
export function historyFieldLabel(field: string): string {
	return FIELD_LABELS[field] ?? field.replace(/_/g, " ").trim();
}

function isPeriodKind(value: unknown): value is PeriodKind {
	return (
		value === "weekly" ||
		value === "biweekly" ||
		value === "semi_monthly" ||
		value === "monthly"
	);
}

function plainValue(value: unknown): string {
	if (value === null || value === undefined) return "none";
	if (typeof value === "boolean") return value ? "on" : "off";
	if (typeof value === "string" || typeof value === "number") {
		return String(value);
	}
	if (Array.isArray(value)) {
		return value.length > 0 ? value.map(plainValue).join(", ") : "none";
	}
	return "changed";
}

/**
 * One value as the line shows it. On a team row a null means "inherits", so
 * it reads "workspace policy".
 */
export function historyValue(
	field: string,
	value: unknown,
	scope: PolicyHistoryRow["scope"] = "workspace",
): string {
	if (value === null || value === undefined) {
		if (scope === "team") return "workspace policy";
		switch (field) {
			case "retroactive_days":
				return "no limit";
			case "weekly_limit_minutes":
				return "none";
			case "period_anchor":
				return "default";
			default:
				return "none";
		}
	}
	switch (field) {
		case "tracking_enabled":
			return value ? "on" : "off";
		case "approval_required":
			return value ? "required" : "not required";
		case "allow_manual_entries":
			return value ? "allowed" : "off";
		case "period_kind":
			return isPeriodKind(value) ? periodKindLabel(value) : plainValue(value);
		case "week_start": {
			const day = weekdayName(Number(value));
			return day || plainValue(value);
		}
		case "period_anchor":
			return isLocalDate(value) ? formatLocalDay(value) : plainValue(value);
		case "approver_scope":
			return value === "team"
				? "this team's owners and admins"
				: "workspace owners and admins";
		case "retroactive_days":
			return retroSummary(Number(value));
		case "rounding_minutes":
			return roundingSummary(Number(value));
		case "weekly_limit_minutes": {
			const minutes = Number(value);
			return Number.isFinite(minutes) && minutes > 0
				? formatMinutesText(minutes)
				: "none";
		}
		case "reminder_days": {
			const n = Math.trunc(Number(value));
			return Number.isFinite(n) ? `${n} ${n === 1 ? "day" : "days"}` : "—";
		}
		case "hidden_presets":
			return Array.isArray(value) && value.length > 0
				? value.map((item) => workItemLabel(item as PresetWorkItem)).join(", ")
				: "none";
		default:
			return plainValue(value);
	}
}

/** The row's kind; derived from `changes` for a backend without `kind`. */
export function historyKind(row: PolicyHistoryRow): PolicyHistoryKind {
	if (row.kind) return row.kind;
	const pairs = Object.values(row.changes ?? {});
	if (pairs.length === 0) return "confirmed";
	if (pairs.every(([before]) => before === null || before === undefined)) {
		return "created";
	}
	if (pairs.every(([, after]) => after === null || after === undefined)) {
		return "deleted";
	}
	return "changed";
}

function orderedChanges(row: PolicyHistoryRow): [string, [unknown, unknown]][] {
	const entries = Object.entries(row.changes ?? {}).filter(
		(entry): entry is [string, [unknown, unknown]] => Array.isArray(entry[1]),
	);
	const rank = (field: string) => {
		const index = FIELD_ORDER.indexOf(field);
		return index === -1 ? FIELD_ORDER.length : index;
	};
	return entries.sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * What the row did, field by field: "period weekly → twice a month; rounding
 * none → 15 min". A created row lists the values it set; a deleted or
 * confirmed row lists nothing.
 */
export function historyChanges(row: PolicyHistoryRow): string {
	const kind = historyKind(row);
	if (kind === "confirmed" || kind === "deleted") return "";
	const parts: string[] = [];
	for (const [field, [before, after]] of orderedChanges(row)) {
		const label = historyFieldLabel(field);
		if (kind === "created") {
			if (after === null || after === undefined) continue;
			parts.push(`${label} ${historyValue(field, after, row.scope)}`);
		} else {
			parts.push(
				`${label} ${historyValue(field, before, row.scope)} → ${historyValue(field, after, row.scope)}`,
			);
		}
	}
	return parts.join("; ");
}

export interface HistoryLineOptions extends DateFormatOptions {
	native?: boolean;
}

/**
 * One history row as a sentence:
 * - "Changed by Ana Reyes, Oct 2: period weekly → twice a month"
 * - "Confirmed (no changes) by Ana Reyes, Oct 2" (D81)
 * - "Set up on Oct 2: period weekly; week start Monday; …" (no actor: a system write)
 * - "Team rules added by Ana Reyes, Oct 2 · Design: rounding 15 min"
 */
export function historyLine(
	row: PolicyHistoryRow,
	options: HistoryLineOptions = {},
): string {
	const kind = historyKind(row);
	const team = row.scope === "team";
	const head =
		kind === "confirmed"
			? "Confirmed (no changes)"
			: kind === "created"
				? team
					? "Team rules added"
					: "Set up"
				: kind === "deleted"
					? team
						? "Team rules removed"
						: "Removed"
					: "Changed";
	const userTimezone = options.userTimezone ?? deviceTimeZone();
	const when = formatInstantDay(row.created_at, userTimezone, {
		now: options.now,
		userTimezone,
		year: options.year,
	});
	const who = row.actor ? row.actor.display_name?.trim() || "someone" : null;
	const where = team ? ` · ${row.team_name?.trim() || "A team"}` : "";
	const changes = historyChanges(row);
	const line = `${head}${who ? ` by ${who},` : " on"} ${when}${where}${changes ? `: ${changes}` : ""}`;
	return nativeSafe(line, { native: options.native ?? isNativeApp() });
}

// ── Component ───────────────────────────────────────────────────────────────

export interface PolicyHistoryProps {
	workspaceId: string;
	/** Only workspace owners and admins can read it; false renders nothing. */
	enabled?: boolean;
	/** Clock and reader timezone for the dates (tests). */
	now?: Date;
	userTimezone?: string;
	className?: string;
}

export function PolicyHistory({
	workspaceId,
	enabled = true,
	now,
	userTimezone,
	className,
}: PolicyHistoryProps) {
	const listId = useId();
	const [expanded, setExpanded] = useState(false);
	const native = isNativeApp();
	const query = useInfiniteQuery({
		queryKey: policyHistoryFeedKey(workspaceId),
		queryFn: ({ pageParam }) =>
			timeService.getWorkspacePolicyHistory(workspaceId, {
				page: pageParam,
				limit: POLICY_HISTORY_PAGE_SIZE,
			}),
		initialPageParam: 1,
		getNextPageParam: (last) =>
			last.items.length > 0 && last.page * last.limit < last.total
				? last.page + 1
				: undefined,
		enabled: enabled && Boolean(workspaceId),
		refetchOnMount: true,
		retry: retryTimeQuery,
	});

	if (!enabled) return null;
	// Only owners and admins read the history; for anyone else it is a 404.
	if (
		query.isError &&
		isTimeApiError(query.error) &&
		query.error.status === 404
	) {
		return null;
	}

	const items = query.data?.pages.flatMap((page) => page.items) ?? [];
	const total = query.data?.pages[0]?.total ?? items.length;
	const shown = expanded ? items : items.slice(0, 1);
	const lineOptions: HistoryLineOptions = { now, userTimezone, native };

	let body: ReactNode;
	if (query.isPending) {
		body = (
			<div
				role="status"
				aria-busy="true"
				className="flex items-center gap-2 text-sm text-muted-foreground"
			>
				<Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
				<span className="sr-only">{POLICY_HISTORY_COPY.loading}</span>
			</div>
		);
	} else if (query.isError && items.length === 0) {
		body = (
			<div className="flex flex-wrap items-center gap-3">
				<p role="alert" className="text-sm text-destructive">
					{timeErrorMessage(query.error, {
						subject: "scope",
						operation: "read",
					})}
				</p>
				<button
					type="button"
					className={settingsButton.secondary}
					disabled={query.isFetching}
					onClick={() => void query.refetch()}
				>
					{POLICY_HISTORY_COPY.retry}
				</button>
			</div>
		);
	} else if (items.length === 0) {
		body = (
			<p className="text-sm text-muted-foreground">
				{POLICY_HISTORY_COPY.empty}
			</p>
		);
	} else {
		body = (
			<>
				<ol
					id={listId}
					aria-label={POLICY_HISTORY_COPY.listLabel}
					className={cn(
						"space-y-2 text-sm leading-relaxed text-foreground",
						expanded
							? "divide-y divide-border [&>li]:pt-2 [&>li:first-child]:pt-0"
							: undefined,
					)}
				>
					{shown.map((row) => (
						<li
							key={String(row.id)}
							data-testid="policy-history-row"
							className="break-words"
						>
							{historyLine(row, lineOptions)}
						</li>
					))}
				</ol>
				{total > 1 || (expanded && query.hasNextPage) ? (
					<div className="mt-3 flex flex-wrap items-center gap-4">
						{total > 1 ? (
							<button
								type="button"
								className={settingsButton.link}
								aria-expanded={expanded}
								aria-controls={listId}
								onClick={() => setExpanded((open) => !open)}
							>
								{expanded
									? POLICY_HISTORY_COPY.showLess
									: POLICY_HISTORY_COPY.showAll}
							</button>
						) : null}
						{expanded && query.hasNextPage ? (
							<button
								type="button"
								className={settingsButton.link}
								disabled={query.isFetchingNextPage}
								onClick={() => void query.fetchNextPage()}
							>
								{query.isFetchingNextPage ? (
									<Loader2
										aria-hidden="true"
										className="h-3.5 w-3.5 animate-spin"
									/>
								) : null}
								{POLICY_HISTORY_COPY.showMore}
							</button>
						) : null}
					</div>
				) : null}
			</>
		);
	}

	return (
		<SettingsSection
			id="time-policy-history"
			title={POLICY_HISTORY_COPY.title}
			className={className}
		>
			<div data-testid="policy-history">{body}</div>
		</SettingsSection>
	);
}
