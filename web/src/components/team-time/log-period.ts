import type { PayPeriodConfig, PayPeriodDef } from "@/services/teams.service";

export type LogPeriodPreset =
	| "this_week"
	| "this_month"
	| "this_year"
	| "cutoff"
	| "current_cutoff"
	| "custom"
	| "all_time";

export interface TeamLogPeriodSearch {
	from?: string;
	to?: string;
	preset?: LogPeriodPreset;
	cutoff_month?: string;
	/** Id of the selected pay period within the team's cut-off config. */
	cutoff_period?: string;
	/** Preselected member filter (e.g. arriving from Manage Rates → View logs). */
	member?: string;
	/** Preselected status tab (e.g. arriving from Payouts → Review pending). */
	status?: string;
}

export interface TeamLogResolvedPeriod {
	preset: LogPeriodPreset;
	fromIso: string;
	toIso: string;
	customFromDate: string;
	customToDate: string;
	cutoffMonth: string;
	cutoffPeriodId: string;
	/** Scheduled pay date for cutoff / current_cutoff presets (ISO), else null. */
	payDateIso: string | null;
}

const PRESETS: LogPeriodPreset[] = [
	"this_week",
	"this_month",
	"this_year",
	"cutoff",
	"current_cutoff",
	"custom",
	"all_time",
];

// ─── Pay-period configuration ────────────────────────────────────────────────
// A team's cut-off schedule lives on `teams.pay_period_config` (nullable). When
// unset we fall back to this default, which matches the app's historical PH
// semi-monthly behaviour (1–15 / 16–EOM) plus the pay dates the team actually
// uses (1–15 paid on the 22nd; 16–EOM paid on the 7th of the next month).

export const DEFAULT_PAY_PERIOD_CONFIG: PayPeriodConfig = {
	cadence: "monthly",
	periods: [
		{
			id: "h1",
			label: "1st half",
			start_day: 1,
			end_day: 15,
			pay_day: 22,
			pay_month_offset: 0,
		},
		{
			id: "h2",
			label: "2nd half",
			start_day: 16,
			end_day: "EOM",
			pay_day: 7,
			pay_month_offset: 1,
		},
	],
};

export interface ResolvedPayPeriod {
	id: string;
	label: string;
	from: Date;
	to: Date;
	payDate: Date;
	/** e.g. "1–15" */
	dayRangeLabel: string;
}

/** Returns the config when it has at least one period, else the default. */
export function normalizePayPeriodConfig(
	config?: PayPeriodConfig | null,
): PayPeriodConfig {
	if (
		config &&
		config.cadence === "monthly" &&
		Array.isArray(config.periods) &&
		config.periods.length > 0
	) {
		return config;
	}
	return DEFAULT_PAY_PERIOD_CONFIG;
}

function lastDayOfMonth(year: number, monthIndex: number): number {
	return new Date(year, monthIndex + 1, 0).getDate();
}

function resolveOnePayPeriod(
	def: PayPeriodDef,
	year: number,
	monthIndex: number,
): ResolvedPayPeriod {
	const eom = lastDayOfMonth(year, monthIndex);
	const startDay = Math.min(Math.max(1, def.start_day), eom);
	const endDay =
		def.end_day === "EOM" ? eom : Math.min(Math.max(1, def.end_day), eom);
	const from = new Date(year, monthIndex, startDay);
	const to = new Date(year, monthIndex, endDay);
	// Pay date lives in a later month (offset) at pay_day, clamped to that
	// month's length so e.g. pay_day 31 in a 30-day month lands on the 30th.
	const payMonthIndex = monthIndex + (def.pay_month_offset ?? 0);
	const payEom = lastDayOfMonth(year, payMonthIndex);
	const payDate = new Date(
		year,
		payMonthIndex,
		Math.min(Math.max(1, def.pay_day), payEom),
	);
	const dayRangeLabel =
		def.end_day === "EOM" ? `${startDay}–EOM` : `${startDay}–${endDay}`;
	return { id: def.id, label: def.label, from, to, payDate, dayRangeLabel };
}

/** Concrete pay-period windows for a given `YYYY-MM` month. */
export function resolvePayPeriods(
	config: PayPeriodConfig | null | undefined,
	month: string,
): ResolvedPayPeriod[] {
	const cfg = normalizePayPeriodConfig(config);
	const parsed = parseMonthInput(month) ?? new Date();
	const year = parsed.getFullYear();
	const monthIndex = parsed.getMonth();
	return cfg.periods.map((def) => resolveOnePayPeriod(def, year, monthIndex));
}

/** The pay period (and its month) that contains an arbitrary `date`. */
export function payPeriodForDate(
	config: PayPeriodConfig | null | undefined,
	date: Date,
): { month: string; period: ResolvedPayPeriod } {
	const month = toMonthInput(date);
	const periods = resolvePayPeriods(config, month);
	const day = startOfDay(date).getTime();
	const containing = periods.find(
		(p) => startOfDay(p.from).getTime() <= day && day <= startOfDay(p.to).getTime(),
	);
	if (containing) return { month, period: containing };
	// No period contains the date (e.g. a gap in the config) — fall back to the
	// last period that has already started, else the first period.
	const started = [...periods]
		.filter((p) => startOfDay(p.from).getTime() <= day)
		.sort((a, b) => b.from.getTime() - a.from.getTime());
	return { month, period: started[0] ?? periods[0] };
}

/** The pay period (and its month) that contains `now`. */
export function currentPayPeriod(
	config: PayPeriodConfig | null | undefined,
	now = new Date(),
): { month: string; period: ResolvedPayPeriod } {
	return payPeriodForDate(config, now);
}

/** e.g. "1–15 Jul 2026" for a resolved pay period. */
export function payPeriodLabel(period: ResolvedPayPeriod): string {
	const monthName = new Intl.DateTimeFormat(undefined, {
		month: "short",
		year: "numeric",
	}).format(period.from);
	return `${period.dayRangeLabel} ${monthName}`;
}

function isPreset(value: unknown): value is LogPeriodPreset {
	return (
		typeof value === "string" && PRESETS.includes(value as LogPeriodPreset)
	);
}

function isIsoLike(value: unknown): value is string {
	if (typeof value !== "string") return false;
	return !Number.isNaN(new Date(value).getTime());
}

function toLocalDateInput(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

function parseDateInput(value: string): Date | null {
	const trimmed = value.trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
	const local = new Date(`${trimmed}T00:00:00`);
	return Number.isNaN(local.getTime()) ? null : local;
}

function startOfDay(date: Date): Date {
	return new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
		0,
		0,
		0,
		0,
	);
}

function endOfDay(date: Date): Date {
	return new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
		23,
		59,
		59,
		999,
	);
}

function toMonthInput(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	return `${y}-${m}`;
}

function parseMonthInput(value: string): Date | null {
	const trimmed = value.trim();
	if (!/^\d{4}-\d{2}$/.test(trimmed)) return null;
	const local = new Date(`${trimmed}-01T00:00:00`);
	return Number.isNaN(local.getTime()) ? null : local;
}

export function parseTeamLogPeriodSearch(
	search: Record<string, unknown>,
): TeamLogPeriodSearch {
	const preset = isPreset(search.preset) ? search.preset : undefined;
	const from = isIsoLike(search.from) ? search.from : undefined;
	const to = isIsoLike(search.to) ? search.to : undefined;
	const cutoffMonth =
		typeof search.cutoff_month === "string" &&
		/^\d{4}-\d{2}$/.test(search.cutoff_month)
			? search.cutoff_month
			: undefined;
	const cutoffPeriod =
		typeof search.cutoff_period === "string" && search.cutoff_period.trim()
			? search.cutoff_period.trim()
			: undefined;
	const member =
		typeof search.member === "string" && search.member.trim()
			? search.member.trim()
			: undefined;
	const status =
		typeof search.status === "string" &&
		["pending", "approved", "paid", "rejected", "all"].includes(search.status)
			? search.status
			: undefined;
	return {
		preset,
		from,
		to,
		cutoff_month: cutoffMonth,
		cutoff_period: cutoffPeriod,
		member,
		status,
	};
}

function weekBounds(now: Date): { from: Date; to: Date } {
	const today = startOfDay(now);
	const day = today.getDay();
	const from = new Date(today);
	from.setDate(today.getDate() - day);
	const to = new Date(from);
	to.setDate(from.getDate() + 6);
	return { from, to };
}

function monthBounds(now: Date): { from: Date; to: Date } {
	const from = new Date(now.getFullYear(), now.getMonth(), 1);
	const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
	return { from, to };
}

export function resolveTeamLogPeriod(
	search: TeamLogPeriodSearch,
	config?: PayPeriodConfig | null,
	now = new Date(),
): TeamLogResolvedPeriod {
	const cfg = normalizePayPeriodConfig(config);
	const fallbackCutoffMonth = toMonthInput(now);
	let cutoffMonth = search.cutoff_month ?? fallbackCutoffMonth;
	let cutoffPeriodId = search.cutoff_period ?? cfg.periods[0].id;
	const preset: LogPeriodPreset = search.preset ?? "this_week";

	let fromDate: Date;
	let toDate: Date;
	let payDate: Date | null = null;
	if (preset === "all_time") {
		fromDate = new Date(2000, 0, 1);
		toDate = new Date(now.getFullYear() + 5, 11, 31);
	} else if (preset === "this_month") {
		const bounds = monthBounds(now);
		fromDate = bounds.from;
		toDate = bounds.to;
	} else if (preset === "this_year") {
		fromDate = new Date(now.getFullYear(), 0, 1);
		toDate = new Date(now.getFullYear(), 11, 31);
	} else if (preset === "current_cutoff") {
		const { month, period } = currentPayPeriod(cfg, now);
		cutoffMonth = month;
		cutoffPeriodId = period.id;
		fromDate = period.from;
		toDate = period.to;
		payDate = period.payDate;
	} else if (preset === "cutoff") {
		const periods = resolvePayPeriods(cfg, cutoffMonth);
		const period =
			periods.find((p) => p.id === cutoffPeriodId) ?? periods[0];
		cutoffPeriodId = period.id;
		fromDate = period.from;
		toDate = period.to;
		payDate = period.payDate;
	} else if (preset === "custom") {
		const fromCandidate = search.from ? new Date(search.from) : null;
		const toCandidate = search.to ? new Date(search.to) : null;
		if (
			fromCandidate &&
			toCandidate &&
			!Number.isNaN(fromCandidate.getTime()) &&
			!Number.isNaN(toCandidate.getTime())
		) {
			fromDate = startOfDay(fromCandidate);
			toDate = endOfDay(toCandidate);
		} else {
			const bounds = weekBounds(now);
			fromDate = bounds.from;
			toDate = bounds.to;
		}
	} else {
		const bounds = weekBounds(now);
		fromDate = bounds.from;
		toDate = bounds.to;
	}

	const boundedFrom = startOfDay(fromDate);
	const boundedTo = endOfDay(toDate);

	return {
		preset,
		fromIso: boundedFrom.toISOString(),
		toIso: boundedTo.toISOString(),
		customFromDate: toLocalDateInput(boundedFrom),
		customToDate: toLocalDateInput(boundedTo),
		cutoffMonth,
		cutoffPeriodId,
		payDateIso: payDate ? payDate.toISOString() : null,
	};
}

export function buildTeamLogPeriodSearch(
	period: TeamLogResolvedPeriod,
): TeamLogPeriodSearch {
	return {
		preset: period.preset,
		from: period.fromIso,
		to: period.toIso,
		cutoff_month: period.cutoffMonth,
		cutoff_period: period.cutoffPeriodId,
	};
}

export function buildCustomPeriodFromDateInputs(
	fromDate: string,
	toDate: string,
): Pick<
	TeamLogResolvedPeriod,
	"fromIso" | "toIso" | "customFromDate" | "customToDate"
> | null {
	const parsedFrom = parseDateInput(fromDate);
	const parsedTo = parseDateInput(toDate);
	if (!parsedFrom || !parsedTo) return null;
	const from = startOfDay(parsedFrom);
	const to = endOfDay(parsedTo);
	if (to.getTime() < from.getTime()) return null;
	return {
		fromIso: from.toISOString(),
		toIso: to.toISOString(),
		customFromDate: toLocalDateInput(from),
		customToDate: toLocalDateInput(to),
	};
}

// ─── cross-tab persistence ───────────────────────────────────────────────
// The period lives in the team-logs route's URL search, which is lost when
// the user visits another Time tab. Mirror it into localStorage per team so
// it can be restored (e.g. a custom range the user set) on return.

const PERIOD_STORAGE_PREFIX = "teamLogPeriod:";

export function loadStoredPeriodSearch(
	teamId: string,
): TeamLogPeriodSearch | null {
	try {
		const raw = localStorage.getItem(`${PERIOD_STORAGE_PREFIX}${teamId}`);
		if (!raw) return null;
		const parsed = parseTeamLogPeriodSearch(JSON.parse(raw));
		return parsed.preset ? parsed : null;
	} catch {
		return null;
	}
}

export function storePeriodSearch(
	teamId: string,
	search: TeamLogPeriodSearch,
): void {
	try {
		localStorage.setItem(
			`${PERIOD_STORAGE_PREFIX}${teamId}`,
			JSON.stringify(search),
		);
	} catch {
		// ignore quota / unavailable storage
	}
}

export function periodRangeLabel(period: TeamLogResolvedPeriod): string {
	if (period.preset === "all_time") return "All time";
	const start = new Date(period.fromIso);
	const end = new Date(period.toIso);
	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
		return "Invalid period";
	}
	const fmt = new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
	return `${fmt.format(start)} – ${fmt.format(end)}`;
}

/** e.g. "1–15 Jul 2026" for the selected cut-off period. */
export function cutoffLabel(
	config: PayPeriodConfig | null | undefined,
	month: string,
	periodId: string,
): string {
	const periods = resolvePayPeriods(config, month);
	const period = periods.find((p) => p.id === periodId) ?? periods[0];
	if (!period) return "";
	const monthName = new Intl.DateTimeFormat(undefined, {
		month: "short",
		year: "numeric",
	}).format(period.from);
	return `${period.dayRangeLabel} ${monthName}`;
}

/** e.g. "Pays Jul 22, 2026". */
export function payDateLabel(iso: string | null | undefined): string | null {
	if (!iso) return null;
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return null;
	return `Pays ${new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(d)}`;
}
