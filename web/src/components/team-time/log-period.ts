export type LogPeriodPreset =
	| "this_week"
	| "this_month"
	| "this_year"
	| "cutoff"
	| "custom"
	| "all_time";
export type CutoffHalf = "1" | "2";

export interface TeamLogPeriodSearch {
	from?: string;
	to?: string;
	preset?: LogPeriodPreset;
	cutoff_month?: string;
	cutoff_half?: CutoffHalf;
}

export interface TeamLogResolvedPeriod {
	preset: LogPeriodPreset;
	fromIso: string;
	toIso: string;
	customFromDate: string;
	customToDate: string;
	cutoffMonth: string;
	cutoffHalf: CutoffHalf;
}

const PRESETS: LogPeriodPreset[] = [
	"this_week",
	"this_month",
	"this_year",
	"cutoff",
	"custom",
	"all_time",
];

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
	const cutoffHalf =
		search.cutoff_half === "2"
			? "2"
			: search.cutoff_half === "1"
				? "1"
				: undefined;
	return {
		preset,
		from,
		to,
		cutoff_month: cutoffMonth,
		cutoff_half: cutoffHalf,
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

function cutoffBounds(
	month: string,
	half: CutoffHalf,
): { from: Date; to: Date } {
	const parsed = parseMonthInput(month) ?? new Date();
	const year = parsed.getFullYear();
	const monthIndex = parsed.getMonth();
	if (half === "1") {
		return {
			from: new Date(year, monthIndex, 1),
			to: new Date(year, monthIndex, 15),
		};
	}
	return {
		from: new Date(year, monthIndex, 16),
		to: new Date(year, monthIndex + 1, 0),
	};
}

export function resolveTeamLogPeriod(
	search: TeamLogPeriodSearch,
	now = new Date(),
): TeamLogResolvedPeriod {
	const fallbackCutoffMonth = toMonthInput(now);
	const cutoffMonth = search.cutoff_month ?? fallbackCutoffMonth;
	const cutoffHalf: CutoffHalf = search.cutoff_half === "2" ? "2" : "1";
	const preset: LogPeriodPreset = search.preset ?? "this_week";

	let fromDate: Date;
	let toDate: Date;
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
	} else if (preset === "cutoff") {
		const bounds = cutoffBounds(cutoffMonth, cutoffHalf);
		fromDate = bounds.from;
		toDate = bounds.to;
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
		cutoffHalf,
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
		cutoff_half: period.cutoffHalf,
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

export function cutoffLabel(month: string, half: CutoffHalf): string {
	const parsed = parseMonthInput(month) ?? new Date();
	const year = parsed.getFullYear();
	const monthIndex = parsed.getMonth();
	const bounds = cutoffBounds(month, half);
	const fromDay = bounds.from.getDate();
	const toDay = bounds.to.getDate();
	const monthName = new Intl.DateTimeFormat(undefined, {
		month: "short",
		year: "numeric",
	}).format(new Date(year, monthIndex, 1));
	return `${fromDay}-${toDay} ${monthName}`;
}
