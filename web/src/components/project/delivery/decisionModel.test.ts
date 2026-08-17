import { describe, expect, it } from "vitest";
import type {
	Decision,
	DecisionCategory,
	DecisionLink,
} from "@/services/delivery.service";
import {
	CATEGORY_ACCENT,
	CATEGORY_COLORS,
	CATEGORY_ICON,
	CATEGORY_ICONS,
	CATEGORY_PRESETS,
	categoryCounts,
	daysOpen,
	decisionLinkSegments,
	decisionReference,
	needsAttention,
	selectedOption,
	summarizeDecisions,
	uncategorizedCount,
} from "./decisionModel";

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
		decided_by: "user-1",
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

function category(overrides: Partial<DecisionCategory> = {}): DecisionCategory {
	return {
		id: "cat-1",
		project_id: "p1",
		name: "Technical",
		color: "blue",
		icon: "cpu",
		position: 0,
		created_at: "2026-08-01T00:00:00Z",
		updated_at: "2026-08-01T00:00:00Z",
		...overrides,
	};
}

describe("decisionReference", () => {
	it("pads to three digits", () => {
		expect(decisionReference(decision({ reference: 24 }))).toBe("DEC-024");
		expect(decisionReference(decision({ reference: 7 }))).toBe("DEC-007");
		expect(decisionReference(decision({ reference: 1234 }))).toBe("DEC-1234");
	});

	it("renders an unsaved optimistic row without inventing a number", () => {
		expect(decisionReference(decision({ reference: null }))).toBe("DEC-—");
	});
});

describe("summarizeDecisions", () => {
	it("counts each status", () => {
		const stats = summarizeDecisions([
			decision({ id: "a", status: "final" }),
			decision({ id: "b", status: "proposed" }),
			decision({ id: "c", status: "superseded" }),
		]);
		expect(stats).toMatchObject({
			total: 3,
			final: 1,
			proposed: 1,
			superseded: 1,
		});
	});

	it("excludes superseded rows from the settled percentage", () => {
		// A long-running project accumulates superseded decisions; counting them
		// as unsettled would make the headline fall as the log gets better.
		const stats = summarizeDecisions([
			decision({ id: "a", status: "final" }),
			decision({ id: "b", status: "final" }),
			decision({ id: "c", status: "superseded" }),
			decision({ id: "d", status: "superseded" }),
		]);
		expect(stats.finalPercent).toBe(100);
	});

	it("reports null rather than 0% when there is nothing live", () => {
		expect(summarizeDecisions([]).finalPercent).toBeNull();
		expect(
			summarizeDecisions([decision({ status: "superseded" })]).finalPercent,
		).toBeNull();
	});

	it("counts unlinked live decisions but not superseded ones", () => {
		const stats = summarizeDecisions([
			decision({ id: "a", links: [] }),
			decision({ id: "b", links: [{ id: "l1" } as DecisionLink] }),
			decision({ id: "c", status: "superseded", links: [] }),
		]);
		expect(stats.unlinked).toBe(1);
	});

	it("takes the latest final decision date", () => {
		const stats = summarizeDecisions([
			decision({ id: "a", decided_on: "2026-08-01" }),
			decision({ id: "b", decided_on: "2026-08-17" }),
			decision({ id: "c", decided_on: "2026-08-09" }),
		]);
		expect(stats.lastDecidedOn).toBe("2026-08-17");
	});
});

describe("needsAttention", () => {
	it("lists proposed decisions oldest first", () => {
		// The column exists to surface what has been sitting.
		const result = needsAttention([
			decision({ id: "new", status: "proposed", updated_at: "2026-08-16" }),
			decision({ id: "old", status: "proposed", updated_at: "2026-08-01" }),
		]);
		expect(result.map((d) => d.id)).toEqual(["old", "new"]);
	});

	it("puts proposed decisions ahead of unlinked final ones", () => {
		const result = needsAttention([
			decision({ id: "unlinked", status: "final", links: [] }),
			decision({ id: "proposed", status: "proposed" }),
		]);
		expect(result.map((d) => d.id)).toEqual(["proposed", "unlinked"]);
	});

	it("ignores final decisions that already point at work", () => {
		const result = needsAttention([
			decision({ id: "linked", links: [{ id: "l1" } as DecisionLink] }),
		]);
		expect(result).toEqual([]);
	});

	it("honours the limit", () => {
		const many = Array.from({ length: 9 }, (_, i) =>
			decision({ id: `d${i}`, status: "proposed" }),
		);
		expect(needsAttention(many, 4)).toHaveLength(4);
	});
});

describe("daysOpen", () => {
	it("counts whole days since the last update", () => {
		const now = Date.parse("2026-08-17T12:00:00Z");
		expect(
			daysOpen(decision({ updated_at: "2026-08-14T12:00:00Z" }), now),
		).toBe(3);
	});

	it("never goes negative on a future timestamp", () => {
		const now = Date.parse("2026-08-17T00:00:00Z");
		expect(
			daysOpen(decision({ updated_at: "2026-08-20T00:00:00Z" }), now),
		).toBe(0);
	});

	it("survives an unparseable timestamp", () => {
		expect(daysOpen(decision({ updated_at: "not a date" }))).toBe(0);
	});
});

describe("decisionLinkSegments", () => {
	it("builds the full epic -> feature -> task trail", () => {
		const segments = decisionLinkSegments({
			id: "l1",
			epic_id: null,
			feature_id: null,
			task_id: "t1",
			milestone_id: null,
			deliverable_id: null,
			position: 0,
			task: {
				id: "t1",
				title: "Write the migration",
				status: "todo",
				feature: {
					id: "f1",
					title: "Schema",
					epic: { id: "e1", title: "Backend" },
				},
			},
		} as DecisionLink);

		expect(segments).toEqual([
			{ kind: "epic", title: "Backend" },
			{ kind: "feature", title: "Schema" },
			{ kind: "task", title: "Write the migration" },
		]);
	});

	it("handles an epic target, which the deliverable junction cannot carry", () => {
		const segments = decisionLinkSegments({
			id: "l1",
			epic_id: "e1",
			feature_id: null,
			task_id: null,
			milestone_id: null,
			deliverable_id: null,
			position: 0,
			epic: { id: "e1", title: "Backend", status: "active" },
		} as DecisionLink);
		expect(segments).toEqual([{ kind: "epic", title: "Backend" }]);
	});

	it("handles a milestone target, which the change-request junction cannot carry", () => {
		const segments = decisionLinkSegments({
			id: "l1",
			epic_id: null,
			feature_id: null,
			task_id: null,
			milestone_id: "m1",
			deliverable_id: null,
			position: 0,
			milestone: {
				id: "m1",
				title: "MVP",
				status: "planned",
				target_date: null,
			},
		} as DecisionLink);
		expect(segments).toEqual([{ kind: "milestone", title: "MVP" }]);
	});

	it("borrows the feature glyph for a deliverable, which is not a roadmap node", () => {
		const segments = decisionLinkSegments({
			id: "l1",
			epic_id: null,
			feature_id: null,
			task_id: null,
			milestone_id: null,
			deliverable_id: "d1",
			position: 0,
			deliverable: { id: "d1", title: "Backend API", status: "in_progress" },
		} as DecisionLink);
		expect(segments).toEqual([{ kind: "feature", title: "Backend API" }]);
	});

	it("returns nothing when the parents were not embedded", () => {
		const segments = decisionLinkSegments({
			id: "l1",
			epic_id: null,
			feature_id: "f1",
			task_id: null,
			milestone_id: null,
			deliverable_id: null,
			position: 0,
		} as DecisionLink);
		expect(segments).toEqual([]);
	});

	it("skips a missing ancestor rather than rendering a blank segment", () => {
		const segments = decisionLinkSegments({
			id: "l1",
			epic_id: null,
			feature_id: "f1",
			task_id: null,
			milestone_id: null,
			deliverable_id: null,
			position: 0,
			feature: { id: "f1", title: "Schema", status: "active", epic: null },
		} as DecisionLink);
		expect(segments).toEqual([{ kind: "feature", title: "Schema" }]);
	});
});

describe("selectedOption", () => {
	it("finds the chosen option", () => {
		const result = selectedOption(
			decision({
				options: [
					{
						id: "o1",
						decision_id: "dec-1",
						title: "PostgreSQL",
						detail: null,
						is_selected: true,
						position: 0,
					},
					{
						id: "o2",
						decision_id: "dec-1",
						title: "MongoDB",
						detail: null,
						is_selected: false,
						position: 1,
					},
				],
			}),
		);
		expect(result?.title).toBe("PostgreSQL");
	});

	it("returns null when nothing has been chosen yet", () => {
		expect(selectedOption(decision({ options: [] }))).toBeNull();
	});
});

describe("category helpers", () => {
	it("counts decisions per category in the categories' own order", () => {
		const categories = [
			category({ id: "cat-1", name: "Technical" }),
			category({ id: "cat-2", name: "Design" }),
		];
		const result = categoryCounts(
			[
				decision({ id: "a", category_id: "cat-1" }),
				decision({ id: "b", category_id: "cat-1" }),
				decision({ id: "c", category_id: "cat-2" }),
				decision({ id: "d", category_id: null }),
			],
			categories,
		);
		expect(result.map((r) => [r.category.name, r.count])).toEqual([
			["Technical", 2],
			["Design", 1],
		]);
	});

	it("counts the uncategorised", () => {
		expect(
			uncategorizedCount([
				decision({ id: "a", category_id: null }),
				decision({ id: "b", category_id: "cat-1" }),
			]),
		).toBe(1);
	});
});

describe("category token maps", () => {
	it("covers every colour and icon the database will accept", () => {
		// The CHECK constraints in 20260817170000_decision_categories.sql are the
		// other half of this contract; a stored key with no entry here renders
		// nothing at all.
		for (const color of CATEGORY_COLORS) {
			expect(CATEGORY_ACCENT[color]).toBeTruthy();
		}
		for (const icon of CATEGORY_ICONS) {
			expect(CATEGORY_ICON[icon]).toBeTruthy();
		}
	});

	it("never paints a raw hex value", () => {
		// The failure mode this whole indirection exists to prevent.
		for (const className of Object.values(CATEGORY_ACCENT)) {
			expect(className).not.toMatch(/#[0-9a-f]{3,8}/i);
		}
	});

	it("offers presets that are all valid keys", () => {
		for (const preset of CATEGORY_PRESETS) {
			expect(CATEGORY_COLORS).toContain(preset.color);
			expect(CATEGORY_ICONS).toContain(preset.icon);
		}
	});
});
