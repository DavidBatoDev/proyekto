/**
 * Recurrence helpers — a thin, pure wrapper over the `rrule` library shared by
 * the meeting editor (build/summarize a repeat rule) and the calendar (expand
 * occurrences for previews).
 *
 * We store the *body* of an RFC-5545 rule (e.g. "FREQ=WEEKLY;INTERVAL=1;BYDAY=TU")
 * WITHOUT the "RRULE:" prefix and WITHOUT a DTSTART line — the meeting's start
 * (wall-clock + IANA timezone) is persisted separately, so a rule string carries
 * only the repeat pattern. Weekday integers follow rrule's convention: 0=Mon … 6=Sun.
 *
 * IMPORTANT: {@link expandOccurrences} returns *floating* dates for UI previews.
 * The DST-correct UTC start of each real occurrence is computed where a
 * wall-clock time is combined with the series timezone (see lib/datetime.ts on
 * the client and the backend materializer) — not here.
 */
import { RRule, rrulestr, type Weekday } from "rrule";

export type RepeatFreq = "daily" | "weekly" | "monthly" | "yearly";

export type RepeatPresetId =
	| "none"
	| "daily"
	| "weekdays"
	| "weekly"
	| "monthly"
	| "yearly"
	| "custom";

/** How a recurrence terminates. `on` dates are inclusive, treated in UTC. */
export type RecurrenceEnds =
	| { type: "never" }
	| { type: "on"; date: string } // yyyy-MM-dd
	| { type: "after"; count: number };

export interface RecurrenceRule {
	freq: RepeatFreq;
	/** Repeat every N periods; always >= 1. */
	interval: number;
	/** rrule weekday ints (0=Mon … 6=Sun), for weekly rules. */
	byweekday?: number[];
	/** Day-of-month (1–31), for monthly/yearly rules. */
	bymonthday?: number[];
	/** Month (1–12), for yearly rules. */
	bymonth?: number[];
	ends: RecurrenceEnds;
}

export interface RepeatOption {
	id: RepeatPresetId;
	label: string;
	/** Rule body, or null for "Does not repeat" / "Custom…". */
	rrule: string | null;
}

const FREQ_TO_RRULE: Record<RepeatFreq, number> = {
	daily: RRule.DAILY,
	weekly: RRule.WEEKLY,
	monthly: RRule.MONTHLY,
	yearly: RRule.YEARLY,
};

const RRULE_TO_FREQ: Record<number, RepeatFreq> = {
	[RRule.DAILY]: "daily",
	[RRule.WEEKLY]: "weekly",
	[RRule.MONTHLY]: "monthly",
	[RRule.YEARLY]: "yearly",
};

// getDay() (Sun=0 … Sat=6) → rrule weekday int (Mon=0 … Sun=6).
const JS_DAY_TO_RRULE_WEEKDAY = [6, 0, 1, 2, 3, 4, 5];
const WEEKDAY_LONG = [
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
	"Sunday",
];
const MONTH_LONG = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

/** rrule weekday int for a JS Date (Mon=0 … Sun=6). */
export function rruleWeekdayOf(date: Date): number {
	return JS_DAY_TO_RRULE_WEEKDAY[date.getDay()];
}

const WEEKDAY_STR_TO_INT: Record<string, number> = {
	MO: 0,
	TU: 1,
	WE: 2,
	TH: 3,
	FR: 4,
	SA: 5,
	SU: 6,
};

type ByWeekdayValue = number | string | Weekday;

function toWeekdayInt(w: ByWeekdayValue): number {
	if (typeof w === "number") return w;
	if (typeof w === "string") return WEEKDAY_STR_TO_INT[w] ?? 0;
	return w.weekday;
}

function normalizeWeekdays(
	value: ByWeekdayValue | ByWeekdayValue[] | null | undefined,
): number[] | undefined {
	if (value == null) return undefined;
	const arr = Array.isArray(value) ? value : [value];
	const ints = arr.map(toWeekdayInt);
	return ints.length ? ints : undefined;
}

function normalizeNumbers(
	value: number | number[] | null | undefined,
): number[] | undefined {
	if (value == null) return undefined;
	const arr = Array.isArray(value) ? value : [value];
	return arr.length ? arr : undefined;
}

function endsFromOptions(
	until: Date | null | undefined,
	count: number | null | undefined,
): RecurrenceEnds {
	if (until) {
		const y = until.getUTCFullYear();
		const m = String(until.getUTCMonth() + 1).padStart(2, "0");
		const d = String(until.getUTCDate()).padStart(2, "0");
		return { type: "on", date: `${y}-${m}-${d}` };
	}
	if (typeof count === "number" && count > 0) {
		return { type: "after", count };
	}
	return { type: "never" };
}

function untilDateFromISO(date: string): Date {
	const [y, m, d] = date.split("-").map(Number);
	// Inclusive end-of-day, in UTC, so serialization is deterministic across
	// the machine timezone the rule is built on.
	return new Date(Date.UTC(y, m - 1, d, 23, 59, 59));
}

/** Serialize a structured rule into an RFC-5545 body ("FREQ=…;…"). */
export function buildRRule(rule: RecurrenceRule): string {
	const options: Partial<ConstructorParameters<typeof RRule>[0]> = {
		freq: FREQ_TO_RRULE[rule.freq],
		interval: Math.max(1, Math.floor(rule.interval || 1)),
	};
	if (rule.byweekday?.length) options.byweekday = rule.byweekday;
	if (rule.bymonthday?.length) options.bymonthday = rule.bymonthday;
	if (rule.bymonth?.length) options.bymonth = rule.bymonth;
	if (rule.ends.type === "on") options.until = untilDateFromISO(rule.ends.date);
	if (rule.ends.type === "after") options.count = rule.ends.count;

	// toString() yields "RRULE:FREQ=…" (no DTSTART, since we pass none). Strip the
	// tag so we persist just the rule body.
	return new RRule(options).toString().replace(/^RRULE:/, "");
}

/** Parse a stored rule body (with or without the "RRULE:" tag) into structure. */
export function parseRRule(rruleStr: string): RecurrenceRule {
	const parsed = rrulestr(
		rruleStr.startsWith("RRULE:") ? rruleStr : `RRULE:${rruleStr}`,
	);
	const o = parsed.origOptions;
	const freq = RRULE_TO_FREQ[o.freq as number] ?? "weekly";
	return {
		freq,
		interval: o.interval ?? 1,
		byweekday: normalizeWeekdays(o.byweekday),
		bymonthday: normalizeNumbers(o.bymonthday),
		bymonth: normalizeNumbers(o.bymonth),
		ends: endsFromOptions(o.until, o.count),
	};
}

/**
 * Human-readable summary ("Every week on Tuesday"). Pass the start date so a
 * bare weekly/monthly rule can be described against its anchor.
 */
export function summarizeRRule(rruleStr: string, dtstart?: Date): string {
	const body = rruleStr.startsWith("RRULE:") ? rruleStr : `RRULE:${rruleStr}`;
	const rule = dtstart
		? new RRule({ ...rrulestr(body).origOptions, dtstart })
		: rrulestr(body);
	const text = rule.toText();
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The repeat-dropdown options for a given start date — mirrors Google Calendar's
 * quick presets (weekly-on-<day>, monthly-on-day-N, annually-on-<date>).
 */
export function presetsFor(startDate: Date): RepeatOption[] {
	const weekday = rruleWeekdayOf(startDate);
	const dom = startDate.getDate();
	const monthIdx = startDate.getMonth();
	const never: RecurrenceEnds = { type: "never" };

	return [
		{ id: "none", label: "Does not repeat", rrule: null },
		{
			id: "daily",
			label: "Daily",
			rrule: buildRRule({ freq: "daily", interval: 1, ends: never }),
		},
		{
			id: "weekly",
			label: `Weekly on ${WEEKDAY_LONG[weekday]}`,
			rrule: buildRRule({
				freq: "weekly",
				interval: 1,
				byweekday: [weekday],
				ends: never,
			}),
		},
		{
			id: "monthly",
			label: `Monthly on day ${dom}`,
			rrule: buildRRule({
				freq: "monthly",
				interval: 1,
				bymonthday: [dom],
				ends: never,
			}),
		},
		{
			id: "yearly",
			label: `Annually on ${MONTH_LONG[monthIdx]} ${dom}`,
			rrule: buildRRule({
				freq: "yearly",
				interval: 1,
				bymonth: [monthIdx + 1],
				bymonthday: [dom],
				ends: never,
			}),
		},
		{
			id: "weekdays",
			label: "Every weekday (Mon–Fri)",
			rrule: buildRRule({
				freq: "weekly",
				interval: 1,
				byweekday: [0, 1, 2, 3, 4],
				ends: never,
			}),
		},
		{ id: "custom", label: "Custom…", rrule: null },
	];
}

function sortedOrUndefined(nums?: number[]): string {
	return nums ? [...nums].sort((a, b) => a - b).join(",") : "";
}

function shapeKey(rule: RecurrenceRule): string {
	return [
		rule.freq,
		rule.interval,
		sortedOrUndefined(rule.byweekday),
		sortedOrUndefined(rule.bymonthday),
		sortedOrUndefined(rule.bymonth),
	].join("|");
}

/**
 * Which preset a stored rule corresponds to (so the editor can re-open on the
 * right dropdown item). A rule with an end date/count, or a non-1 interval,
 * counts as "custom".
 */
export function rruleToPresetId(
	rruleStr: string | null | undefined,
	startDate: Date,
): RepeatPresetId {
	if (!rruleStr) return "none";
	const rule = parseRRule(rruleStr);
	if (rule.ends.type !== "never" || rule.interval !== 1) return "custom";
	const key = shapeKey(rule);
	for (const preset of presetsFor(startDate)) {
		if (!preset.rrule || preset.id === "custom") continue;
		if (shapeKey(parseRRule(preset.rrule)) === key) return preset.id;
	}
	return "custom";
}

/**
 * Expand a rule into occurrence dates within [from, to] for UI previews.
 * Returns *floating* dates — see the module note on DST correctness. Capped to
 * avoid runaway expansion on open-ended rules.
 */
export function expandOccurrences(
	rruleStr: string,
	dtstart: Date,
	from: Date,
	to: Date,
	cap = 366,
): Date[] {
	const body = rruleStr.startsWith("RRULE:") ? rruleStr : `RRULE:${rruleStr}`;
	const rule = new RRule({ ...rrulestr(body).origOptions, dtstart });
	return rule.between(from, to, true).slice(0, cap);
}
