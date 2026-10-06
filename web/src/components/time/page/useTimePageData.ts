// web/src/components/time/page/useTimePageData.ts
//
// Everything the /time page reads, in one place (ux.md › The Time Page):
//
//   overview    → normal or approver mode, the Waiting pill, the For filter's
//                 contexts, the one-time cards
//   view zone   → the day strip's timezone and week start (L29):
//                   `?for=` a context → that context's policy timezone and
//                                       week start (D85: the overview says;
//                                       else its latest sheet)
//                   All (default)     → the person's preferences, falling back
//                                       to the device and Monday
//   view week   → `?week=` snapped to its week start, else this week
//   entries     → `me/entries` for the view week (+ `for`, `project`)
//   sheets      → `me/timesheets` overlapping the view week (the cards)
//
// The pure helpers are exported for tests; the hook only wires queries.
//
// A context's zone is its resolved policy's timezone and week start, which the
// overview carries per context (D85). The server reads `me/entries?for=` in
// that same timezone, so the day cuts here match its range. Two fallbacks, for
// a server without D85 and for a `?for=` the overview doesn't list (no entry
// in 30 days and no open sheet): the context's latest sheet, which carries the
// timezone and week start its period was cut in; and with no sheet in the
// last two months, the person's own zone, with the zone label hidden.

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
	DAY_WARNING_SECONDS,
	entryDayKey,
	entryWorkSeconds,
} from "@/components/time/entries/entryRules";
import { serverNow } from "@/lib/serverClock";
import { nativeSafe } from "@/lib/timeErrors";
import {
	capitalize,
	contextLabel,
	scopePhrase,
	sheetScopeLabel,
} from "@/lib/timeFormat";
import {
	addDays,
	eachDay,
	isLocalDate,
	isValidTimezone,
	type LocalRange,
	rangeContains,
	rangesOverlap,
	safeTimezone,
	todayIn,
	weekWindow,
} from "@/lib/timePeriods";
import {
	parseTimeForParam,
	type TimeForParam,
	type TimeForRef,
	type TimePageSearch,
	timeForParam,
} from "@/lib/timeSearch";
import { teamKeys } from "@/queries/teams";
import {
	retryTimeQuery,
	timeKeys,
	timeQueries,
	useTimeOverview,
} from "@/queries/time";
import { listMyTeams } from "@/services/teams.service";
import { listAllMyEntries } from "@/services/time.service";
import type {
	LoggingForRequest,
	MyEntriesQuery,
	OverviewContext,
	PeriodKind,
	SheetScopeRef,
	TimeEntryView,
	TimeOverview,
	TimesheetSummary,
} from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import { useTimePreferences } from "./TimePrefsMenu";

// ── Constants ───────────────────────────────────────────────────────────────

/** How far back the context-zone lookup reads sheets (a monthly period plus a month). */
export const CONTEXT_SHEETS_LOOKBACK_DAYS = 62;

/** Entries read for one view week (a week of real work is far below this). */
export const WEEK_MAX_ENTRIES = 1000;

/** ux.md › Day strip: a day over 8 h shows ⚠ (strictly greater, as the live day total). */
export const DAY_OVER_SECONDS = DAY_WARNING_SECONDS;

// ── View zone ───────────────────────────────────────────────────────────────

export interface ViewZone {
	timezone: string;
	/** ISO weekday, 1 = Monday. */
	weekStart: number;
	/**
	 * `preferences`: All (the person's own zone). `context`: the `?for=`
	 * context's policy (the overview's, D85) or its latest sheet's. `fallback`:
	 * a context whose zone is unknown, shown in the person's own zone.
	 */
	source: "preferences" | "context" | "fallback";
	/** D85: the context's period cut, when the overview gives it. */
	periodKind?: PeriodKind | null;
	periodAnchor?: string | null;
	/** D85: the context's policy `reminder_days`, when the overview gives it. */
	reminderDays?: number | null;
}

export interface PrefsZone {
	timezone: string;
	weekStart: number;
}

/** A usable `reminder_days` (0 means "on the last day"); anything else is null. */
export function validReminderDays(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value >= 0
		? value
		: null;
}

/**
 * D85: the zone the overview gives a governed context, or null when it gives
 * none (a server without D85, or `personal`, whose policy is the person's own).
 */
export function overviewContextZone(
	context: OverviewContext | null | undefined,
	prefs?: Pick<PrefsZone, "weekStart">,
): ViewZone | null {
	if (!context || context.kind === "personal") return null;
	const timezone =
		typeof context.timezone === "string" ? context.timezone.trim() : "";
	// An unknown zone name would read the week in UTC: let the sheets decide.
	if (!timezone || !isValidTimezone(timezone)) return null;
	return {
		timezone,
		weekStart:
			validWeekStart(context.week_start) ??
			validWeekStart(prefs?.weekStart) ??
			1,
		source: "context",
		periodKind: context.period_kind ?? null,
		periodAnchor: context.period_anchor ?? null,
		reminderDays: validReminderDays(context.reminder_days),
	};
}

function validWeekStart(value: unknown): number | null {
	return typeof value === "number" &&
		Number.isInteger(value) &&
		value >= 1 &&
		value <= 7
		? value
		: null;
}

/** The overview context a `?for=` names, if the overview lists it. */
export function findOverviewContext(
	overview: Pick<TimeOverview, "contexts"> | null | undefined,
	forRef: TimeForRef | null,
): OverviewContext | null {
	if (!forRef) return null;
	return (
		(overview?.contexts ?? []).find(
			(context) =>
				context.kind === forRef.kind &&
				(forRef.kind === "personal" ||
					(context.id ?? "").toLowerCase() === forRef.id.toLowerCase()),
		) ?? null
	);
}

/**
 * The sheet scope a governed context's time lands on: the overview's answer
 * when it has one, else the context itself for a team or workspace (an
 * assignment's sheet scope is its engagement, which only the overview knows).
 */
export function contextSheetScope(
	forRef: TimeForRef | null,
	context: OverviewContext | null,
): SheetScopeRef | null {
	if (!forRef || forRef.kind === "personal") return null;
	if (context?.sheet_scope) return context.sheet_scope;
	if (forRef.kind === "team") return { kind: "team", ref: forRef.id };
	if (forRef.kind === "workspace") return { kind: "workspace", ref: forRef.id };
	return null;
}

/**
 * The cards' sheet scope under `?for=`. The overview's answer when it lists
 * the context. Otherwise (no entry in 30 days and no open sheet, as after the
 * old team `…/time` redirects) the sheet that holds the view's entries, which
 * the server already filtered to the context: on Pro a team's time lands on
 * the workspace sheet, so guessing the team would hide its card. When no
 * entry pins a sheet the cards aren't narrowed (null).
 */
export function cardSheetScope(
	forRef: TimeForRef | null,
	context: OverviewContext | null,
	sheets: readonly Pick<TimesheetSummary, "id" | "scope_kind" | "scope_ref">[],
	entries: readonly Pick<TimeEntryView, "timesheet_id">[],
): SheetScopeRef | null {
	if (!forRef || forRef.kind === "personal") return null;
	if (context) return contextSheetScope(forRef, context);
	const held = new Set(
		entries
			.map((entry) => entry.timesheet_id)
			.filter((id): id is string => Boolean(id)),
	);
	const sheet = sheets.find((item) => held.has(item.id));
	return sheet ? { kind: sheet.scope_kind, ref: sheet.scope_ref } : null;
}

function sameScope(
	sheet: Pick<TimesheetSummary, "scope_kind" | "scope_ref">,
	scope: SheetScopeRef,
): boolean {
	return (
		sheet.scope_kind === scope.kind &&
		(sheet.scope_ref ?? "").toLowerCase() === scope.ref.toLowerCase()
	);
}

/** The day strip's zone (L29). See the file comment. */
export function resolveViewZone(options: {
	forRef: TimeForRef | null;
	prefs: PrefsZone;
	overview?: Pick<TimeOverview, "contexts"> | null;
	/** The person's recent sheets (any scope). */
	sheets?: readonly Pick<
		TimesheetSummary,
		"scope_kind" | "scope_ref" | "timezone" | "week_start" | "period_start"
	>[];
}): ViewZone {
	const prefs: ViewZone = {
		timezone: safeTimezone(options.prefs.timezone),
		weekStart: validWeekStart(options.prefs.weekStart) ?? 1,
		source: "preferences",
	};
	const { forRef } = options;
	if (!forRef || forRef.kind === "personal") return prefs;
	const context = findOverviewContext(options.overview, forRef);
	const fromOverview = overviewContextZone(context, prefs);
	if (fromOverview) return fromOverview;
	const scope = contextSheetScope(forRef, context);
	if (scope) {
		const latest = [...(options.sheets ?? [])]
			.filter((sheet) => sameScope(sheet, scope))
			.sort((a, b) => (a.period_start < b.period_start ? 1 : -1))[0];
		if (latest) {
			return {
				timezone: safeTimezone(latest.timezone),
				weekStart: validWeekStart(latest.week_start) ?? prefs.weekStart,
				source: "context",
			};
		}
	}
	return { ...prefs, source: "fallback" };
}

// ── View week ───────────────────────────────────────────────────────────────

/** The view week: `?week=` (any day) snapped to its week start, else this week. */
export function viewWeekFor(
	week: string | null | undefined,
	zone: Pick<ViewZone, "timezone" | "weekStart">,
	now: Date = new Date(),
): LocalRange {
	const anchor = week && isLocalDate(week) ? week : todayIn(zone.timezone, now);
	return weekWindow(anchor, zone.weekStart);
}

/** `?week=` for a week: omitted for the current week, so "This week" keeps a clean URL. */
export function weekParam(week: LocalRange, today: string): string | undefined {
	return rangeContains(week, today) ? undefined : week.start;
}

// ── Day totals ──────────────────────────────────────────────────────────────

export interface DayTotal {
	date: string;
	/** Live while a timer runs. */
	seconds: number;
	over: boolean;
	isToday: boolean;
}

/** Per-day totals of the view week in the view zone, plus the week. */
export function dayTotals(
	entries: readonly TimeEntryView[],
	week: LocalRange,
	options: { timeZone: string; today: string; nowMs?: number },
): { days: DayTotal[]; weekSeconds: number } {
	const nowMs = options.nowMs ?? serverNow();
	const totals = new Map<string, number>();
	for (const entry of entries) {
		const day = entryDayKey(entry, options.timeZone);
		if (!day || !rangeContains(week, day)) continue;
		totals.set(day, (totals.get(day) ?? 0) + entryWorkSeconds(entry, nowMs));
	}
	let weekSeconds = 0;
	const days = eachDay(week).map((date) => {
		const seconds = totals.get(date) ?? 0;
		weekSeconds += seconds;
		return {
			date,
			seconds,
			over: seconds > DAY_OVER_SECONDS,
			isToday: date === options.today,
		};
	});
	return { days, weekSeconds };
}

/** The entries whose start falls on `day` in the view zone. */
export function entriesOnDay(
	entries: readonly TimeEntryView[],
	day: string | null,
	timeZone: string,
): TimeEntryView[] {
	if (!day) return [...entries];
	return entries.filter((entry) => entryDayKey(entry, timeZone) === day);
}

// ── Sheets ──────────────────────────────────────────────────────────────────

/**
 * The cards in view: sheets overlapping the view week, narrowed to the
 * `?for=` context's sheet scope when there is one ("Just me" has no sheets).
 */
export function sheetsInView(
	sheets: readonly TimesheetSummary[],
	week: LocalRange,
	options: { forRef?: TimeForRef | null; scope?: SheetScopeRef | null } = {},
): TimesheetSummary[] {
	if (options.forRef?.kind === "personal") return [];
	return sheets
		.filter((sheet) =>
			rangesOverlap({ start: sheet.period_start, end: sheet.period_end }, week),
		)
		.filter((sheet) => (options.scope ? sameScope(sheet, options.scope) : true))
		.sort(
			(a, b) =>
				a.period_start.localeCompare(b.period_start) ||
				(a.scope_label_snapshot ?? "").localeCompare(
					b.scope_label_snapshot ?? "",
				),
		);
}

/**
 * A sheet's `reminder_days` for "sends itself <date>" (D85): the sheet's own
 * (its `policy_snapshot`), else the policy of the overview context the sheet
 * belongs to, else null (the card's default, 1 day).
 */
export function sheetReminderDays(
	sheet: Pick<TimesheetSummary, "id" | "scope_kind" | "scope_ref"> & {
		reminder_days?: number | null;
	},
	overview?: Pick<TimeOverview, "contexts"> | null,
): number | null {
	const own = validReminderDays(sheet.reminder_days);
	if (own !== null) return own;
	const contexts = overview?.contexts ?? [];
	const context =
		contexts.find((item) => item.current_sheet?.id === sheet.id) ??
		contexts.find(
			(item) => item.sheet_scope && sameScope(sheet, item.sheet_scope),
		);
	return validReminderDays(context?.reminder_days);
}

/** `sheetReminderDays` for each sheet that has one, by sheet id. */
export function reminderDaysBySheet(
	sheets: readonly TimesheetSummary[],
	overview?: Pick<TimeOverview, "contexts"> | null,
): Record<string, number> {
	const out: Record<string, number> = {};
	for (const sheet of sheets) {
		const days = sheetReminderDays(sheet, overview);
		if (days !== null) out[sheet.id] = days;
	}
	return out;
}

/** Display names of the people the sheets name (A1/A2 deciders): "Returned by Ana". */
export function sheetPeopleNames(
	sheets: readonly Pick<TimesheetSummary, "routing_preview" | "deciders">[],
): Record<string, string> {
	const names: Record<string, string> = {};
	for (const sheet of sheets) {
		for (const person of [
			...(sheet.routing_preview?.deciders ?? []),
			...(sheet.deciders ?? []),
		]) {
			if (person?.id && person.display_name?.trim()) {
				names[person.id] = person.display_name.trim();
			}
		}
	}
	return names;
}

// ── Labels ──────────────────────────────────────────────────────────────────

/**
 * A context's name for the page ("Acme Corp", "Prodigitality Services Inc.
 * Team", "Just me"): the overview's label, else one of the entries'
 * snapshots, else a known team or workspace name (`names`, by id). Passed
 * through `nativeSafe` (server text).
 */
export function forRefLabel(
	forRef: TimeForRef | null,
	sources: {
		overview?: Pick<TimeOverview, "contexts"> | null;
		entries?: readonly TimeEntryView[];
		names?: Readonly<Record<string, string>>;
	} = {},
): string | null {
	if (!forRef) return null;
	if (forRef.kind === "personal") return contextLabel("personal", null);
	const fromOverview = findOverviewContext(sources.overview, forRef)?.label;
	const fromEntry = (sources.entries ?? []).find(
		(entry) =>
			entry.context_kind === forRef.kind &&
			(entry.context_ref ?? "").toLowerCase() === forRef.id.toLowerCase(),
	)?.context_label_snapshot;
	const fromNames =
		forRef.kind === "assignment"
			? undefined
			: (sources.names?.[forRef.id] ??
				sources.names?.[forRef.id.toLowerCase()]);
	const label = (fromOverview || fromEntry || fromNames || "").trim();
	return label ? nativeSafe(label) : null;
}

/** A `?for=` with no known name: "This team", "This workspace", "Your agreement". */
export function unnamedForLabel(kind: TimeForRef["kind"]): string {
	return capitalize(
		scopePhrase(kind === "assignment" ? "engagement" : kind, null),
	);
}

/**
 * The zone label next to the week (ux.md › Day strip):
 * - a context: "Acme Corp time (America/New_York)", only when it isn't the
 *   person's own timezone;
 * - All: "Your time (Asia/Manila)", only when a visible card counts its days
 *   in another timezone.
 */
export function zoneLabel(options: {
	zone: ViewZone;
	prefsTimezone: string;
	forRef: TimeForRef | null;
	contextName?: string | null;
	sheets?: readonly Pick<TimesheetSummary, "timezone">[];
}): string | null {
	const { zone, forRef } = options;
	if (forRef && forRef.kind !== "personal") {
		if (zone.source !== "context") return null;
		if (zone.timezone === safeTimezone(options.prefsTimezone)) return null;
		const name = options.contextName?.trim();
		return name ? `${name} time (${zone.timezone})` : `Time (${zone.timezone})`;
	}
	const other = (options.sheets ?? []).some(
		(sheet) => safeTimezone(sheet.timezone) !== zone.timezone,
	);
	return other ? `Your time (${zone.timezone})` : null;
}

// ── For filter ──────────────────────────────────────────────────────────────

export interface ForFilterOption {
	value: TimeForParam;
	label: string;
	kind: TimeForRef["kind"];
}

const KIND_ORDER: Record<TimeForRef["kind"], number> = {
	assignment: 0,
	team: 1,
	workspace: 2,
	personal: 3,
};

/**
 * The For filter's choices: the overview's contexts (agreements first, Just
 * me last), plus the current `?for=` when the overview doesn't list it.
 * Agreement labels read "Acme Corp · agreement" on web, "Acme Corp" on native.
 */
export function forFilterOptions(
	overview: Pick<TimeOverview, "contexts"> | null | undefined,
	current: TimeForRef | null,
	options: {
		entries?: readonly TimeEntryView[];
		names?: Readonly<Record<string, string>>;
		native?: boolean;
	} = {},
): ForFilterOption[] {
	const seen = new Set<string>();
	const out: ForFilterOption[] = [];
	const add = (ref: TimeForRef, label: string) => {
		const value = timeForParam(ref);
		const key = value.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		out.push({ value, label, kind: ref.kind });
	};
	const labelOf = (kind: TimeForRef["kind"], raw: string): string => {
		if (kind === "personal") return contextLabel("personal", null);
		const name = nativeSafe(raw.trim(), { native: options.native });
		// No name: never " · agreement" on its own.
		if (!name) return "";
		return kind === "assignment"
			? sheetScopeLabel("engagement", name, { native: options.native })
			: name;
	};
	for (const context of overview?.contexts ?? []) {
		const ref =
			context.kind === "personal"
				? ({ kind: "personal", id: null } as const)
				: context.id
					? ({ kind: context.kind, id: context.id } as const)
					: null;
		if (!ref) continue;
		const label = labelOf(context.kind, context.label ?? "");
		if (label) add(ref, label);
	}
	if (current) {
		const raw =
			forRefLabel(current, {
				overview,
				entries: options.entries,
				names: options.names,
			}) ?? "";
		add(current, labelOf(current.kind, raw) || unnamedForLabel(current.kind));
	}
	return out.sort(
		(a, b) =>
			KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label),
	);
}

/** True when the overview names no team, workspace or agreement: everything is "Just me". */
export function onlyPersonal(
	overview: Pick<TimeOverview, "contexts"> | null | undefined,
): boolean {
	return !(overview?.contexts ?? []).some(
		(context) => context.kind !== "personal",
	);
}

/** A `?for=` ref as the API's `for` (`personal:` for Just me). */
export function forRequestOf(
	forRef: TimeForRef | null,
): LoggingForRequest | null {
	if (!forRef) return null;
	return forRef.kind === "personal"
		? { kind: "personal", id: null }
		: { kind: forRef.kind, id: forRef.id };
}

// ── The hook ────────────────────────────────────────────────────────────────

export interface TimePageData {
	userId: string | null;
	overview: TimeOverview | null;
	overviewQuery: ReturnType<typeof useTimeOverview>;
	/** Unknown while the overview loads. */
	approverMode: boolean | null;
	/** Unknown (null) while the overview loads. */
	canLog: boolean | null;
	prefs: PrefsZone & { stored: boolean; isLoading: boolean };
	forRef: TimeForRef | null;
	forRequest: LoggingForRequest | null;
	forName: string | null;
	zone: ViewZone;
	/** False while the zone is still being worked out (no entry read yet). */
	zoneReady: boolean;
	week: LocalRange;
	today: string;
	isCurrentWeek: boolean;
	entriesQuery: {
		isPending: boolean;
		isError: boolean;
		error: unknown;
		refetch: () => unknown;
	};
	entries: TimeEntryView[];
	sheetsQuery: {
		isPending: boolean;
		isError: boolean;
		error: unknown;
		refetch: () => unknown;
	};
	/** Every sheet overlapping the view week. */
	weekSheets: TimesheetSummary[];
	/** The cards: `weekSheets` narrowed to the `?for=` context. */
	sheets: TimesheetSummary[];
	sheetNames: Record<string, string>;
	/** D85: each card's `reminder_days` for "sends itself <date>", by sheet id. */
	sheetReminders: Record<string, number>;
	zoneText: string | null;
	forOptions: ForFilterOption[];
}

export function useTimePageData(
	search: TimePageSearch,
	options: {
		now?: Date;
		/** Known workspace names by id (a `?for=workspace:` the overview doesn't list). */
		names?: Readonly<Record<string, string>>;
	} = {},
): TimePageData {
	const userId = useAuthStore((state) => state.user?.id ?? null);
	const overviewQuery = useTimeOverview();
	const overview = overviewQuery.data ?? null;
	const prefs = useTimePreferences();
	const now = options.now;

	const forRef = useMemo(() => parseTimeForParam(search.for), [search.for]);
	const governed = Boolean(forRef && forRef.kind !== "personal");
	const context = findOverviewContext(overview, forRef);
	// D85: the overview names the context's zone; no sheets lookup then.
	const knownZone = Boolean(overviewContextZone(context));

	// Otherwise (a server without D85, or a context the overview doesn't
	// list) the context's zone comes from its recent sheets: read only under a
	// governed `?for=`, once the overview has answered without a zone. Counted
	// from today in UTC, so the key doesn't move when preferences load.
	const lookbackFrom = addDays(
		todayIn("UTC", now),
		-CONTEXT_SHEETS_LOOKBACK_DAYS,
	);
	const recentSheetsQuery = useQuery({
		...timeQueries.myTimesheets(userId, { from: lookbackFrom }),
		enabled:
			Boolean(userId) && governed && !overviewQuery.isPending && !knownZone,
	});

	const zone = useMemo(
		() =>
			resolveViewZone({
				forRef,
				prefs,
				overview,
				sheets: recentSheetsQuery.data ?? [],
			}),
		[forRef, prefs, overview, recentSheetsQuery.data],
	);
	const zoneReady =
		!prefs.isLoading &&
		(!governed ||
			(!overviewQuery.isPending &&
				(knownZone || !recentSheetsQuery.isPending)));

	const week = useMemo(
		() => viewWeekFor(search.week, zone, now),
		[search.week, zone, now],
	);
	const today = todayIn(zone.timezone, now);
	const isCurrentWeek = rangeContains(week, today);
	const forRequest = useMemo(() => forRequestOf(forRef), [forRef]);
	const approverMode = overview ? overview.approver_mode : null;

	// Entries and sheets of the view week (not in approver mode).
	const listEnabled = Boolean(userId) && zoneReady && approverMode !== true;
	const entriesParams: Omit<MyEntriesQuery, "page" | "limit"> = {
		from: week.start,
		to: week.end,
		project_id: search.project,
		for: forRequest,
	};
	const entriesQuery = useQuery({
		queryKey: [...timeKeys.myEntries(userId, entriesParams), "week"] as const,
		queryFn: () =>
			listAllMyEntries(entriesParams, { maxItems: WEEK_MAX_ENTRIES }),
		enabled: listEnabled,
		refetchOnMount: true,
		retry: retryTimeQuery,
	});
	// No placeholder data on either read: a new week, For or project shows its
	// skeleton instead of the previous week's rows under the new heading (the
	// day strip, the list and the limit would disagree).
	const sheetsQuery = useQuery({
		...timeQueries.myTimesheets(userId, { from: week.start, to: week.end }),
		enabled: listEnabled,
	});

	const entries = useMemo(() => entriesQuery.data ?? [], [entriesQuery.data]);

	const weekSheets = useMemo(
		() => sheetsInView(sheetsQuery.data ?? [], week),
		[sheetsQuery.data, week],
	);
	const scope = useMemo(
		() => cardSheetScope(forRef, context, weekSheets, entries),
		[forRef, context, weekSheets, entries],
	);
	const sheets = useMemo(
		() => sheetsInView(weekSheets, week, { forRef, scope }),
		[weekSheets, week, forRef, scope],
	);
	const sheetNames = useMemo(() => sheetPeopleNames(weekSheets), [weekSheets]);
	const sheetReminders = useMemo(
		() => reminderDaysBySheet(sheets, overview),
		[sheets, overview],
	);

	// A `?for=team:` the overview doesn't list: the team's name from the
	// person's teams (the sidebar's cached read), so the For choice and the
	// zone label aren't left unnamed.
	const teamsQuery = useQuery({
		queryKey: teamKeys.mine(userId ?? "anonymous"),
		queryFn: listMyTeams,
		enabled: Boolean(userId) && forRef?.kind === "team" && !context,
		staleTime: 30 * 1000,
	});
	const callerNames = options.names;
	const names = useMemo(() => {
		const out: Record<string, string> = { ...(callerNames ?? {}) };
		for (const item of overview?.workspace_time_admin ?? []) {
			out[item.workspace_id] = out[item.workspace_id] ?? item.name;
		}
		for (const team of teamsQuery.data ?? []) {
			if (team?.id && team.name) out[team.id] = team.name;
		}
		return out;
	}, [callerNames, overview?.workspace_time_admin, teamsQuery.data]);
	const forName = forRefLabel(forRef, { overview, entries, names });
	const zoneText = zoneLabel({
		zone,
		prefsTimezone: prefs.timezone,
		forRef,
		contextName: forName,
		sheets,
	});
	const forOptions = useMemo(
		() => forFilterOptions(overview, forRef, { entries, names }),
		[overview, forRef, entries, names],
	);

	return {
		userId,
		overview,
		overviewQuery,
		approverMode,
		canLog: overview ? overview.can_log : null,
		prefs,
		forRef,
		forRequest,
		forName,
		zone,
		zoneReady,
		week,
		today,
		isCurrentWeek,
		entriesQuery: {
			isPending: !listEnabled || entriesQuery.isPending,
			isError: entriesQuery.isError,
			error: entriesQuery.error,
			refetch: entriesQuery.refetch,
		},
		entries,
		sheetsQuery: {
			isPending: !listEnabled || sheetsQuery.isPending,
			isError: sheetsQuery.isError,
			error: sheetsQuery.error,
			refetch: sheetsQuery.refetch,
		},
		weekSheets,
		sheets,
		sheetNames,
		sheetReminders,
		zoneText,
		forOptions,
	};
}
