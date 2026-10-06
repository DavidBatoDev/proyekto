/**
 * Search params for the Time pages, parsed once at the route.
 *
 * Every page under the time rebuild reads its URL through one of the
 * `validate…Search` functions below, passed straight to the route's
 * `validateSearch`. They never throw: a value that is missing, malformed or of
 * the wrong type is dropped, so a stale or hand-edited link opens the page in
 * its default state instead of an error screen. Links are shared in
 * notifications, emails and old bookmarks, so "forgiving" is the right default.
 *
 * TanStack Router's default parser JSON-decodes each value first, so a value
 * can arrive as a number or boolean; `text()` folds those back to strings
 * before validation.
 *
 * URL spelling vs API spelling: the URL writes "Just me" as `for=personal`
 * (ux.md › The Time Page), while the API writes it `personal:`. This module
 * only deals in the URL form; `services/time.service.ts` converts for the API.
 *
 * | Route                                   | Params                                          |
 * |-----------------------------------------|-------------------------------------------------|
 * | `/time`                                 | `for`, `project`, `week`, `entry`               |
 * | `/time/timesheets/$timesheetId`         | `entry`                                         |
 * | `/w/$workspaceSlug/settings/time`       | `tab` (`policy` default, `report`)              |
 * | `/w/$workspaceSlug/teams/$teamId/time`  | `person`, `project`, `for`, `status`, `from`, `to`, `group` |
 */

// ── Primitives ──────────────────────────────────────────────────────────────

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Any RFC 4122-shaped id (every version), the same leniency as `IsUUID()`. */
export function isUuid(value: unknown): value is string {
	return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * A value as a trimmed string. Numbers and booleans come back as their text,
 * because the router JSON-decodes search values before we see them.
 */
function text(value: unknown): string | null {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed ? trimmed : null;
	}
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value === "boolean") return String(value);
	return null;
}

function uuidParam(value: unknown): string | undefined {
	const raw = text(value);
	return raw && isUuid(raw) ? raw : undefined;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date written `YYYY-MM-DD` (no Feb 30, no month 13). */
export function isIsoDate(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const match = DATE_PATTERN.exec(value);
	if (!match) return false;
	const [, y, m, d] = match;
	const year = Number(y);
	const month = Number(m);
	const day = Number(d);
	if (month < 1 || month > 12 || day < 1) return false;
	// Day 0 of the next month is the last day of this one; UTC keeps DST out.
	const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
	return day <= lastDay;
}

function dateParam(value: unknown): string | undefined {
	const raw = text(value);
	return raw && isIsoDate(raw) ? raw : undefined;
}

function oneOf<T extends string>(
	value: unknown,
	allowed: readonly T[],
): T | undefined {
	const raw = text(value);
	return raw && (allowed as readonly string[]).includes(raw)
		? (raw as T)
		: undefined;
}

/** Drops undefined keys, so a parsed search object round-trips cleanly. */
function compact<T extends object>(value: T): T {
	const out: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		if (item !== undefined) out[key] = item;
	}
	return out as T;
}

// ── The For filter (`?for=`) ────────────────────────────────────────────────

/** The four logging contexts (backend `ContextKind`). */
export type TimeForKind = "assignment" | "team" | "workspace" | "personal";

/** `assignment:<id>`, `team:<id>`, `workspace:<id>`, or `personal`. */
export type TimeForParam =
	| `assignment:${string}`
	| `team:${string}`
	| `workspace:${string}`
	| "personal";

export type TimeForRef =
	| { kind: Exclude<TimeForKind, "personal">; id: string }
	| { kind: "personal"; id: null };

const GOVERNED_KINDS = ["assignment", "team", "workspace"] as const;

/**
 * Reads a `?for=` value. `personal` and the API's `personal:` both mean "Just
 * me"; a governed kind needs a uuid after the colon. Anything else is `null`.
 */
export function parseTimeForParam(value: unknown): TimeForRef | null {
	const raw = text(value);
	if (!raw) return null;
	if (raw === "personal" || raw === "personal:") {
		return { kind: "personal", id: null };
	}
	const sep = raw.indexOf(":");
	if (sep < 0) return null;
	const kind = raw.slice(0, sep);
	const id = raw.slice(sep + 1);
	if (!(GOVERNED_KINDS as readonly string[]).includes(kind) || !isUuid(id)) {
		return null;
	}
	return { kind: kind as (typeof GOVERNED_KINDS)[number], id };
}

/** The URL spelling of a context: `team:<id>`, or `personal` for "Just me". */
export function timeForParam(ref: TimeForRef): TimeForParam {
	return ref.kind === "personal" ? "personal" : `${ref.kind}:${ref.id}`;
}

function forParam(value: unknown): TimeForParam | undefined {
	const ref = parseTimeForParam(value);
	return ref ? timeForParam(ref) : undefined;
}

/**
 * A time entry id from `?entry=`. Kept when it is a plausible id token, not
 * only a uuid: a link to an entry that is gone must still open the page's
 * "This time entry doesn't exist or you can't open it." card rather than
 * silently showing nothing. Callers check `isUuid` before asking the API, and
 * treat anything else as that same miss.
 */
function entryParam(value: unknown): string | undefined {
	const raw = text(value);
	return raw && /^[A-Za-z0-9-]{1,64}$/.test(raw) ? raw : undefined;
}

// ── /time ───────────────────────────────────────────────────────────────────

export interface TimePageSearch {
	/** Filters to one context and sets the day strip's timezone and week start. */
	for?: TimeForParam;
	/** Filters to one project ("Your time on this project →"). */
	project?: string;
	/** Any day in the view week, `YYYY-MM-DD`; the page snaps it to the week start. */
	week?: string;
	/** Opens that entry's detail modal. */
	entry?: string;
}

export function validateTimePageSearch(
	search: Record<string, unknown>,
): TimePageSearch {
	return compact({
		for: forParam(search.for),
		project: uuidParam(search.project),
		week: dateParam(search.week),
		entry: entryParam(search.entry),
	});
}

// ── /time/timesheets/$timesheetId ───────────────────────────────────────────

export interface TimesheetReviewSearch {
	/** Opens that entry's detail modal over the review screen. */
	entry?: string;
}

export function validateTimesheetReviewSearch(
	search: Record<string, unknown>,
): TimesheetReviewSearch {
	return compact({ entry: entryParam(search.entry) });
}

// ── /w/$workspaceSlug/settings/time ─────────────────────────────────────────

export const WORKSPACE_TIME_TABS = ["policy", "report"] as const;
export type WorkspaceTimeTab = (typeof WORKSPACE_TIME_TABS)[number];

export interface WorkspaceTimeSettingsSearch {
	/** Omitted means `policy`, so the default tab keeps a clean URL. */
	tab?: WorkspaceTimeTab;
}

export function validateWorkspaceTimeSettingsSearch(
	search: Record<string, unknown>,
): WorkspaceTimeSettingsSearch {
	const tab = oneOf(search.tab, WORKSPACE_TIME_TABS);
	return tab && tab !== "policy" ? { tab } : {};
}

/** The tab to show, defaulting to the policy editor. */
export function workspaceTimeTab(
	search: WorkspaceTimeSettingsSearch,
): WorkspaceTimeTab {
	return search.tab ?? "policy";
}

// ── Team › Time (the team report) ───────────────────────────────────────────

/** Sheet statuses the report can filter on (backend `TimesheetStatus`). */
export const TIME_REPORT_STATUSES = [
	"open",
	"submitted",
	"returned",
	"approved",
] as const;
export type TimeReportStatus = (typeof TIME_REPORT_STATUSES)[number];

/**
 * The report's For filter is a context KIND, matching the report API's
 * `context_kind`. "Just me" time never appears in a report, so `personal` is
 * not a value here.
 */
export const TIME_REPORT_FOR_KINDS = GOVERNED_KINDS;
export type TimeReportForKind = (typeof TIME_REPORT_FOR_KINDS)[number];

/** Group-by choices in UI words (ux.md › Reports: person, project, task, day, week). */
export const TIME_REPORT_GROUPS = [
	"person",
	"project",
	"task",
	"day",
	"week",
] as const;
export type TimeReportGroup = (typeof TIME_REPORT_GROUPS)[number];

/** The report API's `group_by` value for a UI group (`person` is `member`). */
export function timeReportGroupBy(
	group: TimeReportGroup,
): "member" | "project" | "task" | "day" | "week" {
	return group === "person" ? "member" : group;
}

export interface TeamTimeReportSearch {
	/** A person's user id (`?person=`; old `team-logs?member=` links land here). */
	person?: string;
	project?: string;
	for?: TimeReportForKind;
	status?: TimeReportStatus;
	/** Inclusive range in the scope's policy timezone, `YYYY-MM-DD`. */
	from?: string;
	to?: string;
	group?: TimeReportGroup;
}

export function validateTeamTimeReportSearch(
	search: Record<string, unknown>,
): TeamTimeReportSearch {
	let from = dateParam(search.from);
	let to = dateParam(search.to);
	// An inverted range is someone's typo, not a request for nothing.
	if (from && to && from > to) [from, to] = [to, from];
	return compact({
		person: uuidParam(search.person),
		project: uuidParam(search.project),
		for: oneOf(search.for, TIME_REPORT_FOR_KINDS),
		status: oneOf(search.status, TIME_REPORT_STATUSES),
		from,
		to,
		group: oneOf(search.group, TIME_REPORT_GROUPS),
	});
}

// ── String links ────────────────────────────────────────────────────────────

/**
 * `/time` with its search params as a plain string, for the places that build
 * an href rather than a router `<Link>` (push links, `window.location`, test
 * fixtures). Router links should pass `to="/time"` and a `search` object
 * instead. `hash: "waiting"` scrolls to Waiting for you.
 */
export function timeHref(
	search: TimePageSearch = {},
	hash?: "waiting",
): string {
	const params = new URLSearchParams();
	const parsed = validateTimePageSearch(search as Record<string, unknown>);
	if (parsed.for) params.set("for", parsed.for);
	if (parsed.project) params.set("project", parsed.project);
	if (parsed.week) params.set("week", parsed.week);
	if (parsed.entry) params.set("entry", parsed.entry);
	const query = params.toString();
	return `/time${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`;
}

/** `/time/timesheets/<id>`, optionally opening one entry. */
export function timesheetHref(timesheetId: string, entryId?: string): string {
	const base = `/time/timesheets/${encodeURIComponent(timesheetId)}`;
	const entry = entryParam(entryId);
	return entry ? `${base}?entry=${encodeURIComponent(entry)}` : base;
}
