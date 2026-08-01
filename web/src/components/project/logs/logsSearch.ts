import { ACTION_FAMILIES } from "./activityCatalog";

export const DATE_PRESETS = ["all", "today", "7d", "30d"] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
	all: "All time",
	today: "Today",
	"7d": "Last 7 days",
	"30d": "Last 30 days",
};

export interface LogsSearch {
	family?: string;
	actor?: string;
	roadmap?: string;
	since: DatePreset;
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
	const family =
		typeof search.family === "string" &&
		(ACTION_FAMILIES as readonly string[]).includes(search.family)
			? search.family
			: undefined;

	const actor =
		typeof search.actor === "string" && UUID_RE.test(search.actor)
			? search.actor
			: undefined;

	const roadmap =
		typeof search.roadmap === "string" && UUID_RE.test(search.roadmap)
			? search.roadmap
			: undefined;

	const since =
		typeof search.since === "string" &&
		(DATE_PRESETS as readonly string[]).includes(search.since)
			? (search.since as DatePreset)
			: "all";

	return { family, actor, roadmap, since };
}

/** Inverse of parseLogsSearch — omits defaults so the URL stays clean. */
export function buildLogsSearch(value: LogsSearch): Record<string, string> {
	const out: Record<string, string> = {};
	if (value.family) out.family = value.family;
	if (value.actor) out.actor = value.actor;
	if (value.roadmap) out.roadmap = value.roadmap;
	if (value.since && value.since !== "all") out.since = value.since;
	return out;
}

export function hasActiveLogsFilters(value: LogsSearch): boolean {
	return Boolean(
		value.family || value.actor || value.roadmap || value.since !== "all",
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
