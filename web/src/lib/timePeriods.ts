/**
 * Timesheet periods and local dates, the web twin of the backend's
 * `backend/src/modules/execution/time/time-periods.ts`.
 *
 * The backend function is a port of SQL `time_period_for` (M1), and both are
 * checked against the same oracle: `__fixtures__/period-parity.json`, a copy
 * of the backend fixture whose outputs came from the SQL function itself. The
 * web reads periods for the day strip, the view week, "sends itself" dates and
 * the retroactive floor, so a day that disagrees with the server would put an
 * entry in the wrong week. Keep this file a line-for-line port; add web-only
 * helpers below the port, never inside it.
 *
 * Local dates are `YYYY-MM-DD` strings. Arithmetic on them is plain
 * UTC-calendar math, so the device timezone never leaks in; zone conversions go
 * through date-fns-tz.
 */

import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { PeriodKind } from "@/services/time.types";

export interface PeriodSpec {
	kind: PeriodKind;
	timezone: string;
	/** ISO weekday, 1 = Monday … 7 = Sunday. */
	weekStart: number;
	/** Biweekly anchor (`YYYY-MM-DD`); null uses the SQL default. */
	anchor?: string | null;
}

/** `YYYY-MM-DD`, inclusive on both ends. */
export interface LocalRange {
	start: string;
	end: string;
}

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A trailing zone designator: Z, ±hh, ±hhmm or ±hh:mm. */
const ZONE_SUFFIX_RE = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;
/** time_period_for's biweekly default anchor base: 2024-01-01 is a Monday. */
const BIWEEKLY_BASE = "2024-01-01";

// ── Port of backend time-periods.ts ─────────────────────────────────────────

/** Intl + fallback false. */
export function isValidTimezone(tz: string): boolean {
	if (typeof tz !== "string" || tz.trim() === "") return false;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

/** invalid → 'UTC' (mirrors SQL: `coalesce(p_tz, 'UTC')`, and an unknown zone falls back to UTC). */
export function safeTimezone(tz: string | null | undefined): string {
	return typeof tz === "string" && isValidTimezone(tz) ? tz : "UTC";
}

/**
 * A Date or an ISO string as an instant. A string without a zone designator
 * reads as UTC, matching a timestamptz cast under the UTC session zone
 * PostgREST uses; a bare date is its UTC midnight.
 */
function toInstant(at: Date | string): Date {
	let instant: Date;
	if (at instanceof Date) {
		instant = at;
	} else {
		const s = String(at).trim();
		const iso = DATE_RE.test(s)
			? `${s}T00:00:00Z`
			: ZONE_SUFFIX_RE.test(s)
				? s
				: `${s}Z`;
		instant = new Date(iso);
	}
	if (Number.isNaN(instant.getTime()))
		throw new RangeError(`Invalid instant: ${String(at)}`);
	return instant;
}

/** UTC epoch ms of a local date's calendar day (validated). */
function dayMs(d: string): number {
	const match = DATE_RE.exec(String(d).slice(0, 10));
	if (!match) throw new RangeError(`Invalid local date: ${d}`);
	const y = Number(match[1]);
	const m = Number(match[2]);
	const day = Number(match[3]);
	const ms = Date.UTC(y, m - 1, day);
	const check = new Date(ms);
	if (
		check.getUTCFullYear() !== y ||
		check.getUTCMonth() !== m - 1 ||
		check.getUTCDate() !== day
	) {
		throw new RangeError(`Invalid local date: ${d}`);
	}
	return ms;
}

function fromDayMs(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

/** (at AT TIME ZONE tz)::date */
export function localDate(at: Date | string, tz: string): string {
	return formatInTimeZone(toInstant(at), safeTimezone(tz), "yyyy-MM-dd");
}

export function addDays(d: string, n: number): string {
	return fromDayMs(dayMs(d) + Math.trunc(n) * DAY_MS);
}

/** 1 = Monday … 7 = Sunday */
export function isoDow(d: string): number {
	const w = new Date(dayMs(d)).getUTCDay();
	return w === 0 ? 7 : w;
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
	return Math.round((dayMs(b) - dayMs(a)) / DAY_MS);
}

/** The week holding d that starts on ISO weekday weekStart (SQL: d − ((isodow − ws + 7) % 7)). */
export function weekWindow(d: string, weekStart: number): LocalRange {
	const ws = weekStart ?? 1;
	const start = addDays(d, -((isoDow(d) - ws + 7) % 7));
	return { start, end: addDays(start, 6) };
}

/** The calendar month holding d. */
export function monthWindow(d: string): LocalRange {
	const ms = dayMs(d);
	const day = new Date(ms);
	const y = day.getUTCFullYear();
	const m = day.getUTCMonth();
	return {
		start: fromDayMs(Date.UTC(y, m, 1)),
		end: fromDayMs(Date.UTC(y, m + 1, 0)),
	};
}

/** Exact parity with SQL time_period_for (M1 :406-456), including the biweekly default anchor
 *  2024-01-01 + (weekStart - 1) and floor division for dates before the anchor. */
export function periodFor(spec: PeriodSpec, at: Date | string): LocalRange {
	const d = localDate(at, spec.timezone);
	const ws = spec.weekStart ?? 1;
	switch (spec.kind) {
		case "weekly":
			return weekWindow(d, ws);
		case "biweekly": {
			const anchor = spec.anchor
				? fromDayMs(dayMs(spec.anchor))
				: addDays(BIWEEKLY_BASE, ws - 1);
			const start = addDays(
				anchor,
				14 * Math.floor(daysBetween(anchor, d) / 14),
			);
			return { start, end: addDays(start, 13) };
		}
		case "semi_monthly": {
			const month = monthWindow(d);
			const firstHalfEnd = addDays(month.start, 14);
			return d <= firstHalfEnd
				? { start: month.start, end: firstHalfEnd }
				: { start: addDays(month.start, 15), end: month.end };
		}
		case "monthly":
			return monthWindow(d);
		default:
			// SQL raises TIME_POLICY_INVALID for an unknown kind.
			throw new RangeError(`unknown period kind ${String(spec.kind)}`);
	}
}

/** [start 00:00 local, (end+1) 00:00 local) as UTC ISO strings, DST-correct. */
export function localRangeToUtc(
	r: LocalRange,
	tz: string,
): { fromIso: string; toExclusiveIso: string } {
	const zone = safeTimezone(tz);
	const from = fromZonedTime(`${fromDayMs(dayMs(r.start))}T00:00:00`, zone);
	const toExclusive = fromZonedTime(`${addDays(r.end, 1)}T00:00:00`, zone);
	return {
		fromIso: from.toISOString(),
		toExclusiveIso: toExclusive.toISOString(),
	};
}

/** Oldest allowed local start date for retroactive_days (null/0 → null = no limit). */
export function retroactiveFloor(
	now: Date,
	tz: string,
	days: number | null,
): string | null {
	if (
		days === null ||
		days === undefined ||
		!Number.isFinite(days) ||
		days <= 0
	)
		return null;
	return addDays(localDate(now, tz), -Math.trunc(days));
}

// ── Web helpers (not in the backend file) ───────────────────────────────────

/** A real `YYYY-MM-DD` calendar date. */
export function isLocalDate(value: unknown): value is string {
	if (typeof value !== "string" || !DATE_RE.test(value)) return false;
	try {
		dayMs(value);
		return true;
	} catch {
		return false;
	}
}

/** Today's local date in `tz` (invalid zones read as UTC, like SQL). */
export function todayIn(tz: string, now: Date = new Date()): string {
	return localDate(now, tz);
}

/** Every local date of a range, in order (empty when `end` is before `start`). */
export function eachDay(range: LocalRange): string[] {
	const count = daysBetween(range.start, range.end);
	const out: string[] = [];
	for (let i = 0; i <= count; i += 1) out.push(addDays(range.start, i));
	return out;
}

/** True when `d` falls inside the range (inclusive). */
export function rangeContains(range: LocalRange, d: string): boolean {
	return d >= range.start && d <= range.end;
}

/** True when two inclusive ranges share at least one day. */
export function rangesOverlap(a: LocalRange, b: LocalRange): boolean {
	return a.start <= b.end && b.start <= a.end;
}

/** The view week holding `d`, `n` weeks on (negative goes back). */
export function shiftWeek(d: string, weekStart: number, n: number): LocalRange {
	return weekWindow(addDays(weekWindow(d, weekStart).start, 7 * n), weekStart);
}

/**
 * When an `auto`/`self` sheet sends itself: period end + max(reminder_days, 1)
 * days (L33). Same day the reminder goes out for other sheets.
 */
export function autoSubmitDate(
	periodEnd: string,
	reminderDays?: number | null,
): string {
	const days =
		typeof reminderDays === "number" && Number.isFinite(reminderDays)
			? Math.max(Math.trunc(reminderDays), 1)
			: 1;
	return addDays(periodEnd, days);
}
