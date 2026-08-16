import { describe, expect, it } from "vitest";
import {
	buildLogsSearch,
	hasActiveLogsFilters,
	normalizeLogsSearch,
	parseLogsSearch,
	presetToFrom,
} from "./logsSearch";

const UUID = "11111111-2222-3333-4444-555555555555";

describe("parseLogsSearch", () => {
	it("defaults to no filters", () => {
		expect(normalizeLogsSearch(parseLogsSearch({}))).toEqual({
			family: [],
			actor: [],
			roadmap: undefined,
			since: "all",
		});
	});

	it("keeps valid values", () => {
		expect(
			normalizeLogsSearch(
				parseLogsSearch({ family: "task", actor: UUID, since: "7d" }),
			),
		).toEqual({
			family: ["task"],
			actor: [UUID],
			roadmap: undefined,
			since: "7d",
		});
	});

	/**
	 * These values go straight into an API query whose DTO rejects unknown
	 * enum members with a 400. Dropping them means a hand-edited or stale URL
	 * ignores a bad filter instead of turning the page into an error.
	 */
	it("keeps repeated values as a list", () => {
		// The sidebar filters with checkboxes, so the URL carries repeats.
		expect(parseLogsSearch({ family: ["task", "epic"] }).family).toEqual([
			"task",
			"epic",
		]);
	});

	it("drops an unknown family but keeps the valid siblings", () => {
		expect(parseLogsSearch({ family: ["task", "nope"] }).family).toEqual([
			"task",
		]);
		expect(parseLogsSearch({ family: "nope" }).family).toBeUndefined();
	});

	it("drops a non-UUID actor or roadmap", () => {
		expect(parseLogsSearch({ actor: "me" }).actor).toBeUndefined();
		expect(parseLogsSearch({ roadmap: "123" }).roadmap).toBeUndefined();
	});

	it("clamps an unknown preset to all", () => {
		expect(parseLogsSearch({ since: "forever" }).since).toBeUndefined();
	});

	it("ignores non-string values", () => {
		expect(parseLogsSearch({ family: 42, actor: null }).family).toBeUndefined();
	});
});

describe("buildLogsSearch", () => {
	it("round-trips", () => {
		const value = { family: ["epic"], actor: [UUID], since: "30d" as const };
		const built = buildLogsSearch(value) as Record<string, unknown>;
		expect(parseLogsSearch(built)).toEqual(value);
	});

	// TanStack Router serialises whatever validateSearch returns straight into
	// the URL, so any default left in the object sticks there forever and makes
	// "Reset" look broken.
	it("omits every default from the parsed shape", () => {
		expect(parseLogsSearch({})).toEqual({});
		expect(parseLogsSearch({ since: "all", family: [] })).toEqual({});
	});

	it("omits defaults so the URL stays clean", () => {
		expect(
			buildLogsSearch({
				family: [],
				actor: [],
				roadmap: undefined,
				since: "all",
			}),
		).toEqual({});
	});
});

describe("hasActiveLogsFilters", () => {
	it("is false for the default state", () => {
		expect(hasActiveLogsFilters(parseLogsSearch({}))).toBe(false);
	});

	it("is true when any filter is set", () => {
		expect(hasActiveLogsFilters(parseLogsSearch({ family: "task" }))).toBe(
			true,
		);
		expect(hasActiveLogsFilters(parseLogsSearch({ since: "today" }))).toBe(
			true,
		);
	});
});

describe("presetToFrom", () => {
	const now = new Date("2026-08-15T13:00:00.000Z");

	it("has no lower bound for all-time", () => {
		expect(presetToFrom("all", now)).toBeUndefined();
	});

	it("uses local midnight for today", () => {
		const from = presetToFrom("today", now);
		expect(from).toBeTruthy();
		const d = new Date(from as string);
		expect(d.getHours()).toBe(0);
		expect(d.getMinutes()).toBe(0);
	});

	it("goes back the right number of days", () => {
		const seven = new Date(presetToFrom("7d", now) as string);
		const days = Math.round(
			(now.getTime() - seven.getTime()) / (24 * 3600_000),
		);
		expect(days).toBe(7);
	});
});
