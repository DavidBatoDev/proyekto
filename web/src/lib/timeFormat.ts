/**
 * How the Time pages write numbers, dates, labels and statuses
 * (ux.md › Copy › Formats, The Time Page, Submit, Return, Reopen).
 *
 * | What                | Format                                                     |
 * |---------------------|------------------------------------------------------------|
 * | Durations in tables | `h:mm` ("38:15"); the running timer `hh:mm:ss`             |
 * | Durations in prose  | "38h 15m", "45m", "2h"                                     |
 * | Periods             | "Sep 22–28", "Sep 29–Oct 5"; the year only when it isn't   |
 * |                     | the current year, the timezone only when it isn't yours    |
 * | Money               | "PHP 6,885.00", one line per currency                      |
 * | Labels              | chips cut at 22 characters, cards at 32, each + "…"        |
 *
 * Everything here is deterministic English: month and weekday names are fixed
 * tables, and numbers go through `en-US`, so a device locale never changes a
 * figure or a test. Dates are local `YYYY-MM-DD` strings (lib/timePeriods.ts);
 * instants are formatted in an explicit timezone, never the device's by
 * accident.
 *
 * Error, warning, plan and toast sentences live in lib/timeErrors.ts.
 */

import { formatInTimeZone } from "date-fns-tz";
import { isNativeApp } from "@/lib/platform";
import type {
	ApproverScope,
	ContextKind,
	PeriodKind,
	SheetScopeKind,
	TimeDecider,
	TimesheetEventRow,
	TimesheetStatus,
	TimesheetSummary,
	WorkItem,
} from "@/services/time.types";
import {
	autoSubmitDate,
	daysBetween,
	isLocalDate,
	isValidTimezone,
	localDate,
	safeTimezone,
} from "./timePeriods";

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

/** Index = ISO weekday − 1 (Monday first). */
const WEEKDAYS = [
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
	"Sunday",
] as const;

const EN_DASH = "–";
const ELLIPSIS = "…";

/** The device's IANA timezone, or UTC when the runtime can't say. */
export function deviceTimeZone(): string {
	try {
		const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
		return tz && isValidTimezone(tz) ? tz : "UTC";
	} catch {
		return "UTC";
	}
}

// ── Durations ───────────────────────────────────────────────────────────────

function wholeSeconds(seconds: number | null | undefined): number | null {
	if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
	return Math.max(0, Math.floor(seconds));
}

/**
 * `h:mm` for tables and totals: "38:15", "0:45", "112:00". Minutes are
 * floored, negatives read as 0, and a missing value reads `empty` ("—").
 */
export function formatClock(
	seconds: number | null | undefined,
	empty = "—",
): string {
	const s = wholeSeconds(seconds);
	if (s === null) return empty;
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	return `${h}:${String(m).padStart(2, "0")}`;
}

/** The running timer: "01:12:44" (hours grow past 99 as needed). */
export function formatTimer(seconds: number | null | undefined): string {
	const s = wholeSeconds(seconds) ?? 0;
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	return [h, m, sec].map((part) => String(part).padStart(2, "0")).join(":");
}

/** Prose: "38h 15m", "45m", "2h", "0m". Minutes are floored. */
export function formatDurationText(
	seconds: number | null | undefined,
	empty = "0m",
): string {
	const s = wholeSeconds(seconds);
	if (s === null) return empty;
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	if (h === 0) return `${m}m`;
	return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** A limit stored in minutes, in prose: 2400 → "40h", 2250 → "37h 30m". */
export function formatMinutesText(minutes: number | null | undefined): string {
	return formatDurationText(
		typeof minutes === "number" && Number.isFinite(minutes)
			? minutes * 60
			: null,
	);
}

/** Longest duration the quick-add field accepts by default (one day). */
export const MAX_DURATION_INPUT_SECONDS = 24 * 3600;

const HOUR_UNIT = "(?:h|hr|hrs|hour|hours)";
const MINUTE_UNIT = "(?:m|min|mins|minute|minutes)";
const NUMBER = "(\\d+(?:\\.\\d+)?|\\.\\d+)";
const CLOCK_RE = /^(\d{1,3})?:([0-5]\d)$/;
const HOURS_RE = new RegExp(`^${NUMBER}\\s*${HOUR_UNIT}$`);
const MINUTES_RE = new RegExp(`^${NUMBER}\\s*${MINUTE_UNIT}$`);
const HOURS_MINUTES_RE = new RegExp(
	`^(\\d+)\\s*${HOUR_UNIT}\\s*(\\d+)\\s*(?:${MINUTE_UNIT})?$`,
);
const BARE_RE = new RegExp(`^${NUMBER}$`);

/** Seconds for a normalised duration string, or null when no form matches. */
function durationSeconds(text: string): number | null {
	const clock = CLOCK_RE.exec(text);
	if (clock) return Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60;
	const both = HOURS_MINUTES_RE.exec(text);
	if (both) {
		const minutes = Number(both[2]);
		return minutes < 60 ? Number(both[1]) * 3600 + minutes * 60 : null;
	}
	const hours = HOURS_RE.exec(text) ?? BARE_RE.exec(text);
	if (hours) return Number(hours[1]) * 3600;
	const minutes = MINUTES_RE.exec(text);
	if (minutes) return Number(minutes[1]) * 60;
	return null;
}

/**
 * The quick-add duration field: `1:30`, `90m`, `1.5h`, plus `1h 30m`, `1h30`,
 * `:45` and a bare number of hours (`1.5`). A comma works as the decimal
 * point. Returns whole seconds, or null for anything empty, unreadable, zero
 * or longer than `maxSeconds` (24 h unless given).
 */
export function parseDurationInput(
	input: string | null | undefined,
	options: { maxSeconds?: number } = {},
): number | null {
	if (typeof input !== "string") return null;
	const text = input
		.trim()
		.toLowerCase()
		.replace(/,/g, ".")
		.replace(/\s+/g, " ");
	if (!text) return null;

	const seconds = durationSeconds(text);
	if (seconds === null || !Number.isFinite(seconds)) return null;
	const rounded = Math.round(seconds);
	const max = options.maxSeconds ?? MAX_DURATION_INPUT_SECONDS;
	if (rounded <= 0 || rounded > max) return null;
	return rounded;
}

// ── Dates and periods ───────────────────────────────────────────────────────

interface DateParts {
	y: number;
	m: number;
	d: number;
}

function partsOf(date: string): DateParts {
	const [y, m, d] = date.split("-").map(Number);
	return { y, m, d };
}

function monthDay(p: DateParts): string {
	return `${MONTHS[p.m - 1]} ${p.d}`;
}

export interface DateFormatOptions {
	/** "Now" for the current-year rule. Defaults to the real clock. */
	now?: Date;
	/** The reader's own timezone. Defaults to the device's. */
	userTimezone?: string;
	/** `auto` (default): the year only when it isn't the current year. */
	year?: "auto" | "always";
}

function currentYear(options: DateFormatOptions): number {
	const tz = options.userTimezone ?? deviceTimeZone();
	return Number(localDate(options.now ?? new Date(), tz).slice(0, 4));
}

function showsYear(year: number, options: DateFormatOptions): boolean {
	return options.year === "always" || year !== currentYear(options);
}

/** "Mon" … "Sun" for an ISO weekday (1 = Monday); "" when out of range. */
export function weekdayShort(isoWeekday: number): string {
	return WEEKDAYS[isoWeekday - 1]?.slice(0, 3) ?? "";
}

/** "Monday" … "Sunday" for an ISO weekday (1 = Monday); "" when out of range. */
export function weekdayName(isoWeekday: number): string {
	return WEEKDAYS[isoWeekday - 1] ?? "";
}

/** The ISO weekday of a local date. */
function isoWeekdayOf(date: string): number {
	const day = new Date(`${date}T00:00:00Z`).getUTCDay();
	return day === 0 ? 7 : day;
}

/**
 * A local date: "Oct 5", "Thu Oct 2" (`weekday`), "Oct 5, 2025" (another
 * year). A malformed value comes back unchanged.
 */
export function formatLocalDay(
	date: string,
	options: DateFormatOptions & { weekday?: boolean } = {},
): string {
	if (!isLocalDate(date)) return date;
	const p = partsOf(date);
	const head = options.weekday
		? `${weekdayShort(isoWeekdayOf(date))} ${monthDay(p)}`
		: monthDay(p);
	return showsYear(p.y, options) ? `${head}, ${p.y}` : head;
}

export interface PeriodFormatOptions extends DateFormatOptions {
	/** The period's own timezone: named in parentheses when it isn't the reader's. */
	timezone?: string | null;
	/** `always` names the timezone even when it is the reader's (review header). */
	showTimezone?: "auto" | "always";
	/** "Sep 22 – 28" (headers) instead of "Sep 22–28" (cards, rows). */
	spaced?: boolean;
}

/**
 * A period: "Sep 22–28", "Sep 29–Oct 5", "Sep 22–28, 2025",
 * "Dec 28, 2026–Jan 3, 2027", "Oct 6" (one day), plus " (America/New_York)"
 * when the period's timezone is not the reader's.
 */
export function formatPeriodRange(
	start: string,
	end: string,
	options: PeriodFormatOptions = {},
): string {
	const dash = options.spaced ? ` ${EN_DASH} ` : EN_DASH;
	if (!isLocalDate(start) || !isLocalDate(end)) {
		return [start, end].filter(Boolean).join(dash);
	}
	const a = partsOf(start);
	const b = partsOf(end);
	let text: string;
	if (a.y !== b.y) {
		text = `${monthDay(a)}, ${a.y}${dash}${monthDay(b)}, ${b.y}`;
	} else {
		const year = showsYear(a.y, options) ? `, ${a.y}` : "";
		if (start === end) text = `${monthDay(a)}${year}`;
		else if (a.m === b.m) text = `${monthDay(a)}${dash}${b.d}${year}`;
		else text = `${monthDay(a)}${dash}${monthDay(b)}${year}`;
	}
	const tz = options.timezone;
	if (tz) {
		const userTz = options.userTimezone ?? deviceTimeZone();
		if (options.showTimezone === "always" || tz !== userTz) {
			text += ` (${tz})`;
		}
	}
	return text;
}

/** An instant's local date in `tz`: "Sep 29" (see `formatLocalDay`); "—" when unreadable. */
export function formatInstantDay(
	iso: string | null | undefined,
	tz: string,
	options: DateFormatOptions & { weekday?: boolean } = {},
): string {
	if (!iso) return "—";
	try {
		return formatLocalDay(localDate(iso, tz), {
			...options,
			userTimezone: options.userTimezone ?? safeTimezone(tz),
		});
	} catch {
		return "—";
	}
}

/** An instant's wall-clock time in `tz`, 24-hour: "09:00"; "—" when unreadable. */
export function formatInstantTime(
	iso: string | null | undefined,
	tz: string,
): string {
	if (!iso) return "—";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "—";
	return formatInTimeZone(date, safeTimezone(tz), "HH:mm");
}

/** "Sep 29, 10:14" (another year: "Sep 29, 2025, 10:14"); "—" when unreadable. */
export function formatInstantDateTime(
	iso: string | null | undefined,
	tz: string,
	options: DateFormatOptions = {},
): string {
	const day = formatInstantDay(iso, tz, options);
	if (day === "—") return day;
	return `${day}, ${formatInstantTime(iso, tz)}`;
}

/**
 * When a sheet was sent, from the reader's side (Waiting for you, the home
 * card): "today", "yesterday", "2 days ago", then the date ("Sep 15"). Days
 * are counted in `timezone` (the viewer's). Empty when unknown or unreadable.
 */
export function submittedAgo(
	iso: string | null | undefined,
	options: { now?: Date; timezone?: string } = {},
): string {
	if (!iso) return "";
	const tz = options.timezone ?? deviceTimeZone();
	try {
		const now = options.now ?? new Date();
		const today = localDate(now, tz);
		const day = localDate(iso, tz);
		const days = daysBetween(day, today);
		if (days <= 0) return "today";
		if (days === 1) return "yesterday";
		if (days < 7) return `${days} days ago`;
		return formatLocalDay(day, { now, userTimezone: tz });
	} catch {
		return "";
	}
}

// ── Money ───────────────────────────────────────────────────────────────────

function fractionDigits(currency: string): number {
	try {
		return (
			new Intl.NumberFormat("en-US", {
				style: "currency",
				currency,
			}).resolvedOptions().maximumFractionDigits ?? 2
		);
	} catch {
		return 2;
	}
}

/** "PHP 6,885.00", "USD 120.00", "JPY 1,200" (the currency's own decimals). */
export function formatMoneyLine(
	amount: number | null | undefined,
	currency: string | null | undefined,
): string {
	const code = (currency || "USD").trim().toUpperCase();
	const digits = fractionDigits(code);
	const value =
		typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
	const number = new Intl.NumberFormat("en-US", {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits,
	}).format(value);
	return `${code} ${number}`;
}

/** One line per currency, in currency-code order; non-numbers are skipped. */
export function moneyLines(
	amountsByCurrency: Readonly<Record<string, number | null>> | null | undefined,
): string[] {
	if (!amountsByCurrency) return [];
	return Object.entries(amountsByCurrency)
		.filter(
			(entry): entry is [string, number] =>
				typeof entry[1] === "number" && Number.isFinite(entry[1]),
		)
		.sort(([a], [b]) => a.localeCompare(b, "en"))
		.map(([currency, amount]) => formatMoneyLine(amount, currency));
}

/** "PHP 6,885.00 · USD 120.00". */
export function joinMoneyLines(lines: readonly string[]): string {
	return lines.join(" · ");
}

/**
 * Whether an amount may show: never when the viewer's cost is hidden, and
 * never on native for agreement time (engagement sheets, assignment entries).
 */
export function canShowAmounts(options: {
	cost?: "visible" | "hidden" | null;
	kind?: ContextKind | SheetScopeKind | null;
	native?: boolean;
}): boolean {
	if (options.cost === "hidden") return false;
	const native = options.native ?? isNativeApp();
	if (
		native &&
		(options.kind === "engagement" || options.kind === "assignment")
	) {
		return false;
	}
	return true;
}

// ── Labels ──────────────────────────────────────────────────────────────────

/** A work item's name: the entries table, the For pickers, the Report, policy settings. */
export const WORK_ITEM_LABEL: Record<WorkItem, string> = {
	task: "Task",
	meeting: "Meeting",
	review: "Review",
	admin: "Admin",
	other: "Other",
};

/** "Task", "Meeting", "Review", "Admin", "Other" (unknown or missing: "Other"). */
export function workItemLabel(item: WorkItem | null | undefined): string {
	return (item && WORK_ITEM_LABEL[item]) || WORK_ITEM_LABEL.other;
}

/** For chips (the For chip, approval rows). */
export const CHIP_LABEL_MAX = 22;
/** For timesheet cards. */
export const CARD_LABEL_MAX = 32;

/** `label` cut to `max` characters + "…" (by code point; trailing spaces dropped). */
export function truncateLabel(label: string, max: number): string {
	const text = (label ?? "").trim();
	const chars = Array.from(text);
	if (chars.length <= max) return text;
	return `${chars.slice(0, Math.max(max, 1)).join("").trimEnd()}${ELLIPSIS}`;
}

/** The cut label plus the full one as a tooltip when it was cut. */
export function labelWithTitle(
	label: string,
	max: number,
): { text: string; title: string | undefined } {
	const full = (label ?? "").trim();
	const text = truncateLabel(full, max);
	return { text, title: text === full ? undefined : full };
}

export const chipLabel = (label: string) =>
	labelWithTitle(label, CHIP_LABEL_MAX);
export const cardLabel = (label: string) =>
	labelWithTitle(label, CARD_LABEL_MAX);

/** "Ana Reyes" → "Ana". */
export function firstName(
	displayName: string | null | undefined,
): string | null {
	const first = displayName?.trim().split(/\s+/)[0];
	return first ? first : null;
}

/** "Acme" → "Acme's". */
export function possessive(name: string): string {
	return `${name}'s`;
}

/** "Ana Reyes", "Ana Reyes and Leo Cruz", "Ana Reyes, Leo Cruz and 2 others". */
export function joinNames(
	names: readonly string[],
	conjunction: "and" | "or" = "and",
): string {
	const list = names.filter((name) => name.trim() !== "");
	if (list.length <= 2) return list.join(` ${conjunction} `);
	const others = list.length - 2;
	return `${list[0]}, ${list[1]} ${conjunction} ${others} ${others === 1 ? "other" : "others"}`;
}

/**
 * A timesheet card's label (ux.md › Timesheet cards): the workspace or team
 * name, or the counterparty + " · agreement" on web ("Acme Corp · agreement")
 * and the counterparty alone on native. `max` cuts the name, never the suffix.
 */
export function sheetScopeLabel(
	kind: SheetScopeKind,
	label: string,
	options: { native?: boolean; max?: number } = {},
): string {
	const native = options.native ?? isNativeApp();
	const name =
		options.max === undefined
			? label.trim()
			: truncateLabel(label, options.max);
	return kind === "engagement" && !native ? `${name} · agreement` : name;
}

/** A context's label as the For chip says it: "Just me" for personal. */
export function contextLabel(
	kind: ContextKind,
	label: string | null | undefined,
): string {
	if (kind === "personal") return "Just me";
	return label?.trim() || "";
}

/**
 * A report section heading (ux.md › Reports): "Prodigitality Services… · team",
 * "Acme · workspace", "Acme Corp · agreement". Personal time never appears in
 * reports.
 */
export function contextSectionLabel(
	kind: Exclude<ContextKind, "personal"> | SheetScopeKind,
	label: string,
	options: { max?: number } = {},
): string {
	const name =
		options.max === undefined
			? label.trim()
			: truncateLabel(label, options.max);
	const word =
		kind === "assignment" || kind === "engagement" ? "agreement" : kind;
	return `${name} · ${word}`;
}

/**
 * A scope inside a sentence: "your agreement with Acme Corp" for agreement
 * time, the name otherwise ("Prodigitality Services Inc. Team", "Acme").
 * Without a name: "this team", "this workspace", "your agreement".
 */
export function scopePhrase(
	kind: ContextKind | SheetScopeKind | null | undefined,
	label: string | null | undefined,
): string {
	const name = label?.trim();
	switch (kind) {
		case "assignment":
		case "engagement":
			return name ? `your agreement with ${name}` : "your agreement";
		case "team":
			return name || "this team";
		case "workspace":
			return name || "this workspace";
		case "personal":
			return "just you";
		default:
			return name || "this project";
	}
}

/** Capitalises the first letter of a phrase ("your agreement…" → "Your agreement…"). */
export function capitalize(text: string): string {
	return text ? text[0].toUpperCase() + text.slice(1) : text;
}

// ── Policy phrases ──────────────────────────────────────────────────────────

const PERIOD_KIND_LABEL: Record<PeriodKind, string> = {
	weekly: "weekly",
	biweekly: "every two weeks",
	semi_monthly: "twice a month",
	monthly: "monthly",
};

const PERIOD_KIND_TITLE: Record<PeriodKind, string> = {
	weekly: "Weekly",
	biweekly: "Every two weeks",
	semi_monthly: "Twice a month (1–15, 16–end)",
	monthly: "Monthly",
};

/** "weekly", "every two weeks", "twice a month", "monthly". */
export function periodKindLabel(kind: PeriodKind): string {
	return PERIOD_KIND_LABEL[kind] ?? kind;
}

/** The settings radio labels: "Weekly" … "Twice a month (1–15, 16–end)". */
export function periodKindTitle(kind: PeriodKind): string {
	return PERIOD_KIND_TITLE[kind] ?? kind;
}

/**
 * "weekly · starts Monday · Asia/Manila" (the popover's Timesheet line). Week
 * start only matters for weekly and two-weekly periods.
 */
export function timesheetRulesLine(policy: {
	period_kind: PeriodKind;
	week_start?: number | null;
	timezone?: string | null;
}): string {
	const parts: string[] = [periodKindLabel(policy.period_kind)];
	const weekly =
		policy.period_kind === "weekly" || policy.period_kind === "biweekly";
	const day = weekdayName(policy.week_start ?? 1);
	if (weekly && day) parts.push(`starts ${day}`);
	if (policy.timezone) parts.push(policy.timezone);
	return parts.join(" · ");
}

/** "Manual time up to 7 days back", "Manual time allowed" (no limit), "Manual time off". */
export function manualTimeLine(policy: {
	allow_manual_entries: boolean;
	retroactive_days?: number | null;
}): string {
	if (!policy.allow_manual_entries) return "Manual time off";
	const days = policy.retroactive_days;
	if (typeof days === "number" && Number.isFinite(days) && days > 0) {
		const n = Math.trunc(days);
		return `Manual time up to ${n} ${n === 1 ? "day" : "days"} back`;
	}
	return "Manual time allowed";
}

/** "No rounding" or "Rounds to the nearest 15 min". */
export function roundingLine(minutes: number | null | undefined): string {
	return typeof minutes === "number" && minutes > 0
		? `Rounds to the nearest ${minutes} min`
		: "No rounding";
}

// ── Who approves ────────────────────────────────────────────────────────────

/** ux.md: the member is the only possible approver and the route has no one else. */
export const NO_DECIDER_COPY =
	"No one else can approve this. Add a workspace admin.";
const SELF_COPY = "You're the only approver here, so this approves itself.";
const AUTO_COPY = "Approval is off here, so this approves itself.";

export interface GoesToContext {
	/** The sheet's scope kind: an `auto` route on an engagement sheet is the client confirmation. */
	scopeKind?: SheetScopeKind | null;
	/** `scope_label_snapshot`: the team, the workspace or the counterparty. */
	label?: string | null;
	/** The policy workspace's name, for workspace approvers of a team sheet. */
	workspaceName?: string | null;
}

function deciderNames(
	deciders: readonly TimeDecider[] | null | undefined,
): string[] {
	return (deciders ?? [])
		.map((decider) => decider.display_name?.trim() ?? "")
		.filter((name) => name !== "");
}

function hasNoDecider(
	scope: ApproverScope,
	deciders: readonly TimeDecider[] | null | undefined,
): boolean {
	return (
		Array.isArray(deciders) &&
		deciders.length === 0 &&
		(scope === "team" || scope === "workspace" || scope === "hirer")
	);
}

function workspaceNameFor(ctx: GoesToContext): string | null {
	const name =
		ctx.workspaceName?.trim() ||
		(ctx.scopeKind === "workspace" ? ctx.label?.trim() : "");
	return name || null;
}

/**
 * Who a sheet goes to, as a noun phrase: "Prodigitality Services Inc. Team's
 * owners and admins", "Acme's workspace owners and admins", "Ana Reyes". Null
 * for `auto`/`self` (nobody) and for an unknown route.
 */
export function goesToTarget(
	scope: ApproverScope | null | undefined,
	deciders?: readonly TimeDecider[] | null,
	ctx: GoesToContext = {},
): string | null {
	switch (scope) {
		case "team": {
			const team = ctx.label?.trim();
			return team
				? `${possessive(team)} owners and admins`
				: "the team's owners and admins";
		}
		case "workspace": {
			const workspace = workspaceNameFor(ctx);
			return workspace
				? `${possessive(workspace)} workspace owners and admins`
				: "the workspace owners and admins";
		}
		case "hirer": {
			const names = deciderNames(deciders);
			if (names.length) return joinNames(names, "and");
			return ctx.label?.trim() || "the person who hired you";
		}
		default:
			return null;
	}
}

/**
 * The Submit sheet's "Goes to" line (ux.md › Submit flow):
 *
 * | `approver_scope` | Copy                                                                    |
 * |------------------|-------------------------------------------------------------------------|
 * | `team`           | "Goes to Prodigitality Services Inc. Team's owners and admins"          |
 * | `workspace`      | "Goes to Acme's workspace owners and admins"                            |
 * | `hirer`          | "Goes to Ana Reyes"                                                     |
 * | `auto` (client)  | "Submitting confirms these hours for your agreement with Acme Corp."    |
 * | `self`           | "You're the only approver here, so this approves itself."              |
 * | none eligible    | "No one else can approve this. Add a workspace admin."                  |
 *
 * "None eligible" needs a decider list that came back empty (A1/A2 never send
 * `[]` on a failed read); an absent list just names the scope. Null when the
 * route is unknown (an open sheet without a preview).
 */
export function goesToCopy(
	scope: ApproverScope | null | undefined,
	deciders?: readonly TimeDecider[] | null,
	ctx: GoesToContext = {},
): string | null {
	if (!scope) return null;
	if (hasNoDecider(scope, deciders)) return NO_DECIDER_COPY;
	if (scope === "self") return SELF_COPY;
	if (scope === "auto") {
		if (ctx.scopeKind === "engagement") {
			return `Submitting confirms these hours for ${scopePhrase("engagement", ctx.label)}.`;
		}
		return AUTO_COPY;
	}
	const target = goesToTarget(scope, deciders, ctx);
	return target ? `Goes to ${target}` : null;
}

/**
 * The "Waiting on …" sublabel of a submitted sheet: the hirer by name ("Waiting
 * on Ana Reyes"), a team or workspace as a group ("Waiting on Acme's owners
 * and admins").
 */
function waitingOn(
	scope: ApproverScope,
	deciders: readonly TimeDecider[] | null | undefined,
	ctx: GoesToContext,
): string | null {
	switch (scope) {
		case "hirer": {
			const names = deciderNames(deciders);
			if (names.length) return `Waiting on ${joinNames(names, "or")}`;
			const hirer = ctx.label?.trim();
			return hirer ? `Waiting on ${hirer}` : null;
		}
		case "team": {
			const team = ctx.label?.trim();
			return `Waiting on ${team ? possessive(team) : "the team's"} owners and admins`;
		}
		case "workspace": {
			const workspace = workspaceNameFor(ctx);
			return `Waiting on ${workspace ? possessive(workspace) : "the workspace's"} owners and admins`;
		}
		default:
			return null;
	}
}

// ── Sheet status (four states, everything else a sublabel) ──────────────────

export type SheetTone = "neutral" | "muted" | "warning" | "success";

export interface SheetStatusView {
	status: TimesheetStatus;
	/** "Open", "Submitted", "Returned", "Approved". */
	label: string;
	/** The most useful sublabel ("until Oct 5", "Waiting on Ana Reyes"). */
	sublabel: string | null;
	/** Every sublabel that applies, most useful first. */
	sublabels: string[];
	/** Accent: grey for Submitted, green for Approved, amber for Returned. */
	tone: SheetTone;
	/** Submitted and Approved rows are read-only. */
	locked: boolean;
	/** Submit (Open) or Resubmit (Returned) can be offered now. */
	submitAvailable: boolean;
	/** "Submit", "Resubmit", or null. */
	submitLabel: "Submit" | "Resubmit" | null;
	/** Open, past its last day, routed to someone else. */
	overdue: boolean;
	/** Routed `auto`/`self`: the sheet sends itself. */
	sendsItself: boolean;
	/** When an `auto`/`self` sheet sends itself (`YYYY-MM-DD`). */
	sendsItselfOn: string | null;
}

export type SheetStatusInput = Pick<
	TimesheetSummary,
	"status" | "scope_kind" | "period_start" | "period_end" | "timezone"
> &
	Partial<
		Pick<
			TimesheetSummary,
			| "approver_scope"
			| "submission_kind"
			| "submitted_at"
			| "decision_kind"
			| "decided_by"
			| "decided_at"
			| "decision_note"
			| "overtime_approved"
			| "scope_label_snapshot"
			| "member_user_id"
			| "routing_preview"
			| "deciders"
			| "reminder_days"
		>
	>;

export interface SheetStatusContext extends DateFormatOptions {
	/** The signed-in user ("Returned by you", "Reopened by you"). */
	viewerId?: string | null;
	/**
	 * The policy's `reminder_days` for "sends itself" dates. Unset, the sheet's
	 * own `reminder_days` (D85) is used, else 1 day.
	 */
	reminderDays?: number | null;
	/** The sheet's history (detail only); tells a return from a reopen. */
	events?: readonly TimesheetEventRow[] | null;
	/** Display names by user id, for decided_by and event actors. */
	names?: Readonly<Record<string, string | null | undefined>>;
	/** The detail's `deciders_count` (0 → "No one else can approve this"). */
	decidersCount?: number | null;
	/** The policy workspace's name, for workspace approvers of a team sheet. */
	workspaceName?: string | null;
}

const STATUS_LABEL: Record<TimesheetStatus, string> = {
	open: "Open",
	submitted: "Submitted",
	returned: "Returned",
	approved: "Approved",
};

const STATUS_TONE: Record<TimesheetStatus, SheetTone> = {
	open: "neutral",
	submitted: "muted",
	returned: "warning",
	approved: "success",
};

/** Notes inside a sublabel are cut to this many characters. */
export const SUBLABEL_NOTE_MAX = 60;

function quoted(note: string | null | undefined): string | null {
	const text = note?.trim();
	return text ? `'${truncateLabel(text, SUBLABEL_NOTE_MAX)}'` : null;
}

function actorName(
	userId: string | null | undefined,
	ctx: SheetStatusContext,
): string | null {
	if (!userId) return null;
	if (ctx.viewerId && userId === ctx.viewerId) return "you";
	return firstName(ctx.names?.[userId]);
}

/** The newest event of the given kinds that landed on `toStatus`. */
function latestEvent(
	events: readonly TimesheetEventRow[] | null | undefined,
	kinds: readonly TimesheetEventRow["event"][],
	toStatus: TimesheetStatus,
): TimesheetEventRow | null {
	let latest: TimesheetEventRow | null = null;
	for (const event of events ?? []) {
		if (!kinds.includes(event.event) || event.to_status !== toStatus) continue;
		if (
			!latest ||
			event.created_at > latest.created_at ||
			(event.created_at === latest.created_at && event.id > latest.id)
		) {
			latest = event;
		}
	}
	return latest;
}

/**
 * A sheet's status word, sublabels and flags (ux.md › Status words):
 *
 * - **Open**: "until Oct 5" (before its last day) · "sends itself Oct 6"
 *   (`auto`/`self`) · "overdue" (past its end, manual routing) · "Reopened by
 *   you" (a member reopen of an own `auto`/`self` sheet; needs `events`).
 * - **Submitted**: "No one else can approve this. Add a workspace admin." ·
 *   "Waiting on Ana Reyes" / "Waiting on Acme's owners and admins" ·
 *   "Imported from per-entry review" · "Sent automatically Oct 6" · "Sent when
 *   the account was closed".
 * - **Returned**: "Returned by Ana · 'Split Thursday'" · "Reopened by Ana · '…'".
 * - **Approved**: "Confirmed" (client engagement, `auto`) · "Self-approved" ·
 *   "Overtime approved" · "Imported".
 *
 * Dates are local to the sheet's timezone. The route of an open sheet comes
 * from A1's `routing_preview` when the backend sends it.
 */
export function sheetStatusView(
	sheet: SheetStatusInput,
	ctx: SheetStatusContext = {},
): SheetStatusView {
	const status = sheet.status;
	const tz = safeTimezone(sheet.timezone);
	const today = localDate(ctx.now ?? new Date(), tz);
	const dateOptions: DateFormatOptions = {
		now: ctx.now,
		userTimezone: ctx.userTimezone ?? tz,
		year: ctx.year,
	};
	const scope =
		sheet.routing_preview?.approver_scope ?? sheet.approver_scope ?? null;
	const sendsItself = scope === "auto" || scope === "self";
	const goesTo: GoesToContext = {
		scopeKind: sheet.scope_kind,
		label: sheet.scope_label_snapshot,
		workspaceName: ctx.workspaceName,
	};
	const sublabels: string[] = [];
	let overdue = false;
	let sendsItselfOn: string | null = null;
	let submitAvailable = false;
	let submitLabel: SheetStatusView["submitLabel"] = null;

	switch (status) {
		case "open": {
			// Only when the reopen is what made it open: a later withdraw
			// (reopened → submitted → withdrawn) is open for another reason.
			const lastOpen = latestEvent(
				ctx.events,
				["reopened", "withdrawn", "legacy_import"],
				"open",
			);
			const reopened = lastOpen?.event === "reopened" ? lastOpen : null;
			if (reopened) {
				const who = actorName(reopened.actor_user_id, ctx);
				sublabels.push(who ? `Reopened by ${who}` : "Reopened");
			}
			if (sendsItself && isLocalDate(sheet.period_end)) {
				// D85: the sheet carries its reminder_days (the snapshot once
				// submitted, the live policy while open), so every screen that
				// shows "sends itself" agrees without passing it in.
				sendsItselfOn = autoSubmitDate(
					sheet.period_end,
					ctx.reminderDays ?? sheet.reminder_days,
				);
				sublabels.push(
					`sends itself ${formatLocalDay(sendsItselfOn, dateOptions)}`,
				);
				submitAvailable = true;
			} else if (today > sheet.period_end) {
				overdue = true;
				sublabels.push("overdue");
				submitAvailable = true;
			} else {
				sublabels.push(
					`until ${formatLocalDay(sheet.period_end, dateOptions)}`,
				);
				submitAvailable = today >= sheet.period_end;
			}
			submitLabel = submitAvailable ? "Submit" : null;
			break;
		}
		case "submitted": {
			const deciders = sheet.deciders;
			const noDecider =
				scope !== null &&
				!sendsItself &&
				(ctx.decidersCount === 0 || hasNoDecider(scope, deciders));
			if (noDecider) sublabels.push(NO_DECIDER_COPY);
			else if (scope && !sendsItself) {
				const waiting = waitingOn(scope, deciders, goesTo);
				if (waiting) sublabels.push(waiting);
			}
			if (sheet.submission_kind === "legacy") {
				sublabels.push("Imported from per-entry review");
			} else if (sheet.submission_kind === "auto") {
				const day = formatInstantDay(sheet.submitted_at, tz, dateOptions);
				sublabels.push(
					day === "—" ? "Sent automatically" : `Sent automatically ${day}`,
				);
			} else if (sheet.submission_kind === "on_deletion") {
				sublabels.push("Sent when the account was closed");
			}
			break;
		}
		case "returned": {
			const event = latestEvent(
				ctx.events,
				["returned", "reopened"],
				"returned",
			);
			const verb = event?.event === "reopened" ? "Reopened" : "Returned";
			const who = actorName(event?.actor_user_id ?? sheet.decided_by, ctx);
			const note = quoted(event ? event.note : sheet.decision_note);
			// Without a name, "Reopened" still says what happened (the status
			// word already says "Returned", so that one adds nothing alone).
			const head = who
				? `${verb} by ${who}`
				: verb === "Reopened"
					? verb
					: null;
			const line = [head, note].filter(Boolean).join(" · ");
			if (line) sublabels.push(line);
			submitAvailable = true;
			submitLabel = "Resubmit";
			break;
		}
		case "approved": {
			if (sheet.decision_kind === "self") sublabels.push("Self-approved");
			else if (sheet.decision_kind === "legacy") sublabels.push("Imported");
			else if (
				sheet.scope_kind === "engagement" &&
				(sheet.approver_scope === "auto" || sheet.decision_kind === "auto")
			) {
				sublabels.push("Confirmed");
			}
			if (sheet.overtime_approved) sublabels.push("Overtime approved");
			break;
		}
	}

	return {
		status,
		label: STATUS_LABEL[status] ?? status,
		sublabel: sublabels[0] ?? null,
		sublabels,
		tone: STATUS_TONE[status] ?? "neutral",
		locked: status === "submitted" || status === "approved",
		submitAvailable,
		submitLabel,
		overdue,
		sendsItself,
		sendsItselfOn,
	};
}

/** "Open · until Oct 5": the status word and its most useful sublabel. */
export function sheetStatusLine(view: SheetStatusView): string {
	return view.sublabel ? `${view.label} · ${view.sublabel}` : view.label;
}

/** A period's last day has started in the sheet's timezone (Submit shows from then). */
export function periodLastDayReached(
	periodEnd: string,
	timezone: string,
	now: Date = new Date(),
): boolean {
	return localDate(now, timezone) >= periodEnd;
}
