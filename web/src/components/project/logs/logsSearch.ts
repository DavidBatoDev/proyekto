import { ACTION_FAMILIES } from "./activityCatalog";

export const DATE_PRESETS = ["all", "today", "7d", "30d"] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
	all: "All time",
	today: "Today",
	"7d": "Last 7 days",
	"30d": "Last 30 days",
};

/**
 * The SPARSE shape written to the URL.
 *
 * Every field is optional and omitted when it holds its default, because
 * TanStack Router serialises whatever validateSearch returns — returning
 * `{ actor: [], since: "all" }` would leave `?actor=[]&since=all` glued to the
 * URL forever and make "Reset" look broken. Use `normalizeLogsSearch` to read
 * it with defaults applied.
 */
export interface LogsSearch {
	/** Multi-select: OR within the list. Absent means "all". */
	family?: string[];
	actor?: string[];
	roadmap?: string;
	since?: DatePreset;
}

/** The DENSE shape components read. */
export interface ResolvedLogsSearch {
	family: string[];
	actor: string[];
	roadmap?: string;
	since: DatePreset;
}

export function normalizeLogsSearch(value: LogsSearch): ResolvedLogsSearch {
	return {
		family: value.family ?? [],
		actor: value.actor ?? [],
		roadmap: value.roadmap,
		since: value.since ?? "all",
	};
}

/** URL params carry repeats or a single value; normalise both to a list. */
function toList(value: unknown): string[] {
	if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
	return typeof value === "string" && value ? [value] : [];
}

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse the Logs route search params.
 *
 * Everything unrecognised is DROPPED rather than passed through: these values
 * go straight into an API query whose DTO rejects unknown enum members with a
 * 400, so a stale or hand-edited URL would otherwise turn the whole page into
 * an error instead of just ignoring a bad filter.
 */
export function parseLogsSearch(search: Record<string, unknown>): LogsSearch {
	const family = toList(search.family).filter((f) =>
		(ACTION_FAMILIES as readonly string[]).includes(f),
	);

	const actor = toList(search.actor).filter((a) => UUID_RE.test(a));

	const roadmap =
		typeof search.roadmap === "string" && UUID_RE.test(search.roadmap)
			? search.roadmap
			: undefined;

	const since =
		typeof search.since === "string" &&
		(DATE_PRESETS as readonly string[]).includes(search.since)
			? (search.since as DatePreset)
			: "all";

	// Omit defaults so they never reach the URL.
	return {
		...(family.length ? { family } : {}),
		...(actor.length ? { actor } : {}),
		...(roadmap ? { roadmap } : {}),
		...(since !== "all" ? { since } : {}),
	};
}

/** Inverse of parseLogsSearch — omits defaults so the URL stays clean. */
export function buildLogsSearch(value: LogsSearch): LogsSearch {
	const resolved = normalizeLogsSearch(value);
	return {
		...(resolved.family.length ? { family: resolved.family } : {}),
		...(resolved.actor.length ? { actor: resolved.actor } : {}),
		...(resolved.roadmap ? { roadmap: resolved.roadmap } : {}),
		...(resolved.since !== "all" ? { since: resolved.since } : {}),
	};
}

/** Toggle one value in a multi-select list. */
export function toggleInList(list: string[], value: string): string[] {
	return list.includes(value)
		? list.filter((v) => v !== value)
		: [...list, value];
}

/** Clears every filter. Spread over the current search to reset. */
export const EMPTY_LOGS_SEARCH: LogsSearch = {
	family: undefined,
	actor: undefined,
	roadmap: undefined,
	since: undefined,
};

export function hasActiveLogsFilters(value: LogsSearch): boolean {
	const r = normalizeLogsSearch(value);
	return Boolean(
		r.family.length || r.actor.length || r.roadmap || r.since !== "all",
	);
}

/** Resolve a preset to an ISO `from` bound. `all` has none. */
export function presetToFrom(
	since: DatePreset,
	now: Date = new Date(),
): string | undefined {
	if (since === "all") return undefined;
	const start = new Date(now);
	if (since === "today") {
		start.setHours(0, 0, 0, 0);
	} else {
		start.setDate(start.getDate() - (since === "7d" ? 7 : 30));
	}
	return start.toISOString();
}
