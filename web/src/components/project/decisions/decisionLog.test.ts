import { describe, expect, it } from "vitest";
import type { Decision } from "@/services/delivery.service";
import {
	filterDecisions,
	groupDecisionsByMonth,
	hasActiveDecisionFilters,
	monthLabel,
	NO_DECISION_FILTERS,
	supersededWithin,
} from "./decisionLog";

function decision(overrides: Partial<Decision> = {}): Decision {
	return {
		id: "dec-1",
		project_id: "p1",
		reference: 1,
		title: "Database choice",
		context: null,
		decision: "Use PostgreSQL.",
		rationale: null,
		alternatives_considered: null,
		category_id: null,
		decided_by: null,
		decided_on: "2026-08-10",
		status: "final",
		supersedes_decision_id: null,
		version: 1,
		visibility: "shared",
		created_at: "2026-08-10T00:00:00Z",
		updated_at: "2026-08-10T00:00:00Z",
		links: [],
		options: [],
		...overrides,
	};
}

describe("groupDecisionsByMonth", () => {
	it("collects a run of the same month into one band", () => {
		const groups = groupDecisionsByMonth([
			decision({ id: "a", decided_on: "2026-08-17" }),
			decision({ id: "b", decided_on: "2026-08-02" }),
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0].key).toBe("2026-08");
		expect(groups[0].decisions.map((d) => d.id)).toEqual(["a", "b"]);
	});

	it("starts a new band when the month changes", () => {
		const groups = groupDecisionsByMonth([
			decision({ id: "a", decided_on: "2026-08-01" }),
			decision({ id: "b", decided_on: "2026-07-31" }),
		]);
		expect(groups.map((g) => g.key)).toEqual(["2026-08", "2026-07"]);
	});

	it("crosses a year boundary", () => {
		const groups = groupDecisionsByMonth([
			decision({ id: "a", decided_on: "2027-01-01" }),
			decision({ id: "b", decided_on: "2026-12-31" }),
		]);
		expect(groups.map((g) => g.label)).toEqual([
			"January 2027",
			"December 2026",
		]);
	});

	it("files the first of the month under that month, not the previous one", () => {
		// The bug this guards: `new Date("2026-08-01")` is UTC midnight, which is
		// July 31st in every zone behind UTC.
		const groups = groupDecisionsByMonth([
			decision({ decided_on: "2026-08-01" }),
		]);
		expect(groups[0].key).toBe("2026-08");
	});

	it("preserves the order it was given rather than sorting", () => {
		// The server orders by decided_on DESC; re-sorting here would disagree with
		// the order the API paginates in.
		const groups = groupDecisionsByMonth([
			decision({ id: "a", decided_on: "2026-07-01" }),
			decision({ id: "b", decided_on: "2026-08-01" }),
			decision({ id: "c", decided_on: "2026-07-02" }),
		]);
		// Unsorted input honestly produces a repeated band.
		expect(groups.map((g) => g.key)).toEqual(["2026-07", "2026-08", "2026-07"]);
	});

	it("skips an unparseable date rather than dropping the whole page", () => {
		const groups = groupDecisionsByMonth([
			decision({ id: "bad", decided_on: "not a date" }),
			decision({ id: "good", decided_on: "2026-08-10" }),
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0].decisions.map((d) => d.id)).toEqual(["good"]);
	});

	it("returns nothing for an empty log", () => {
		expect(groupDecisionsByMonth([])).toEqual([]);
	});
});

describe("monthLabel", () => {
	it("reads as a band heading", () => {
		expect(monthLabel(new Date(2026, 7, 17))).toBe("August 2026");
	});
});

describe("filterDecisions", () => {
	const log = [
		decision({ id: "a", status: "final", category_id: "tech" }),
		decision({ id: "b", status: "proposed", category_id: "tech" }),
		decision({ id: "c", status: "final", category_id: "design" }),
		decision({ id: "d", status: "superseded", category_id: null }),
	];

	it("returns everything when nothing is checked", () => {
		expect(filterDecisions(log, NO_DECISION_FILTERS)).toHaveLength(4);
	});

	it("ORs within a facet", () => {
		const result = filterDecisions(log, {
			statuses: ["final", "proposed"],
			categoryIds: [],
		});
		expect(result.map((d) => d.id)).toEqual(["a", "b", "c"]);
	});

	it("ANDs across facets", () => {
		const result = filterDecisions(log, {
			statuses: ["final"],
			categoryIds: ["tech"],
		});
		expect(result.map((d) => d.id)).toEqual(["a"]);
	});

	it("treats the empty string as the uncategorised bucket", () => {
		const result = filterDecisions(log, { statuses: [], categoryIds: [""] });
		expect(result.map((d) => d.id)).toEqual(["d"]);
	});

	it("can combine a real category with the uncategorised bucket", () => {
		const result = filterDecisions(log, {
			statuses: [],
			categoryIds: ["design", ""],
		});
		expect(result.map((d) => d.id)).toEqual(["c", "d"]);
	});

	it("returns nothing when the facets cannot both be satisfied", () => {
		expect(
			filterDecisions(log, { statuses: ["superseded"], categoryIds: ["tech"] }),
		).toEqual([]);
	});

	it("preserves the order it was given", () => {
		const result = filterDecisions(log, {
			statuses: ["superseded", "final"],
			categoryIds: [],
		});
		expect(result.map((d) => d.id)).toEqual(["a", "c", "d"]);
	});
});

describe("hasActiveDecisionFilters", () => {
	it("is false when every facet is empty", () => {
		expect(hasActiveDecisionFilters(NO_DECISION_FILTERS)).toBe(false);
	});

	it("is true when either facet has a value", () => {
		expect(
			hasActiveDecisionFilters({ statuses: ["final"], categoryIds: [] }),
		).toBe(true);
		expect(hasActiveDecisionFilters({ statuses: [], categoryIds: [""] })).toBe(
			true,
		);
	});
});

describe("supersededWithin", () => {
	it("marks a decision that a later one replaces", () => {
		const replaced = supersededWithin([
			decision({ id: "new", supersedes_decision_id: "old" }),
			decision({ id: "old" }),
		]);
		expect(replaced.has("old")).toBe(true);
		expect(replaced.has("new")).toBe(false);
	});

	it("ignores a target that is not on screen", () => {
		// A connector pointing at a filtered-out row is worse than none.
		const replaced = supersededWithin([
			decision({ id: "new", supersedes_decision_id: "filtered-out" }),
		]);
		expect(replaced.size).toBe(0);
	});

	it("handles a chain of replacements", () => {
		const replaced = supersededWithin([
			decision({ id: "v3", supersedes_decision_id: "v2" }),
			decision({ id: "v2", supersedes_decision_id: "v1" }),
			decision({ id: "v1" }),
		]);
		expect([...replaced].sort()).toEqual(["v1", "v2"]);
	});

	it("is empty when nothing supersedes anything", () => {
		expect(supersededWithin([decision({ id: "a" })]).size).toBe(0);
	});
});
