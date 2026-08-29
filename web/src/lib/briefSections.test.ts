import { describe, expect, it } from "vitest";
import {
	addSection,
	availableRecommendations,
	type BriefSection,
	isRichTextEmpty,
	missingPublishFields,
	removeSection,
	updateSection,
} from "./briefSections";

const sections = (...keys: string[]): BriefSection[] =>
	keys.map((key, position) => ({ key, value: `body of ${key}`, position }));

describe("missingPublishFields", () => {
	// Mirrors the backend's list exactly; publish is rejected server-side, so a
	// drift here shows the author "ready to publish" on a brief that then 400s.
	it("names every structured field the board filters on", () => {
		expect(missingPublishFields({})).toEqual([
			"Overview",
			"Budget",
			"Timeline",
			"Category",
		]);
	});

	it("treats a cleared rich-text overview as missing", () => {
		expect(missingPublishFields({ summary: "<p></p>" })).toContain("Overview");
		expect(missingPublishFields({ summary: "<p>&nbsp;</p>" })).toContain(
			"Overview",
		);
	});

	it("accepts a brief carrying only one end of the budget range", () => {
		expect(missingPublishFields({ budget_max: 5000 })).not.toContain("Budget");
	});

	it("does not ask for any particular prose section", () => {
		const ready = missingPublishFields({
			summary: "<p>Build a marketplace</p>",
			budget_min: 5000,
			duration: "3-6_months",
			category_id: "cat-1",
		});
		expect(ready).toEqual([]);
	});

	it("accepts a timeline the author wrote themselves", () => {
		expect(
			missingPublishFields({
				summary: "<p>Build a marketplace</p>",
				budget_min: 5000,
				duration: "custom",
				duration_custom: "about ten weeks",
				category_id: "cat-1",
			}),
		).toEqual([]);
	});

	it('does not count "Something else" with an empty box as a timeline', () => {
		expect(missingPublishFields({ duration: "custom" })).toContain("Timeline");
		expect(
			missingPublishFields({ duration: "custom", duration_custom: "  " }),
		).toContain("Timeline");
	});
});

describe("isRichTextEmpty", () => {
	it("sees through empty markup but keeps real text", () => {
		expect(isRichTextEmpty("<p><br></p>")).toBe(true);
		expect(isRichTextEmpty(null)).toBe(true);
		expect(isRichTextEmpty("<p>Two user types</p>")).toBe(false);
	});
});

describe("section editing", () => {
	it("keeps positions dense when a middle section is removed", () => {
		const next = removeSection(sections("Scope", "Deliverables", "Budget"), 1);

		expect(next.map((section) => section.key)).toEqual(["Scope", "Budget"]);
		expect(next.map((section) => section.position)).toEqual([0, 1]);
	});

	it("appends after the last section rather than colliding at 0", () => {
		const next = addSection(sections("Scope"), "Deliverables");

		expect(next.map((section) => section.position)).toEqual([0, 1]);
		expect(next[1]).toMatchObject({ key: "Deliverables", value: "" });
	});

	it("edits one section without disturbing its neighbours", () => {
		const next = updateSection(sections("Scope", "Deliverables"), 0, {
			value: "rewritten",
		});

		expect(next[0].value).toBe("rewritten");
		expect(next[1].value).toBe("body of Deliverables");
	});
});

describe("availableRecommendations", () => {
	it("stops offering a section the brief already has", () => {
		const offered = availableRecommendations(sections("Scope of work"));

		expect(offered.map((entry) => entry.key)).not.toContain("Scope of work");
		expect(offered.map((entry) => entry.key)).toContain("Deliverables");
	});

	it("matches case-insensitively, so a retyped heading is not offered twice", () => {
		const offered = availableRecommendations([
			{ key: "scope of WORK", value: "x", position: 0 },
		]);

		expect(offered.map((entry) => entry.key)).not.toContain("Scope of work");
	});
});
