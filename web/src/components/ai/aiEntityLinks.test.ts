import { describe, expect, it } from "vitest";
import {
	aiMarkdownUrlTransform,
	ENTITY_URI_SCHEME,
	entityKey,
	entityLabelsMatch,
	normalizeEntityLabel,
	parseEntityHref,
	stripEntityLinks,
} from "./aiEntityLinks";

const ID = "a91b9842-15ae-48c1-bf90-627a71179e38";
const ANCHOR = {
	type: "element" as const,
	tagName: "a",
	properties: {},
	children: [],
};

describe("parseEntityHref", () => {
	it.each([
		"project",
		"roadmap",
		"epic",
		"feature",
		"task",
		"milestone",
		"team",
		"workspace",
	])("accepts a UUID for %s", (kind) => {
		expect(parseEntityHref(`proyekto://${kind}/${ID}`)).toEqual({
			kind,
			id: ID,
		});
	});

	it.each([
		"proyekto://epic/E1",
		"proyekto://feature/E1.F2",
		"proyekto://roadmap/R2",
		"proyekto://epic/R2.E1",
		`https://task/${ID}`,
		`javascript://task/${ID}`,
		`proyekto:///${ID}`,
		`proyekto://person/${ID}`,
		"proyekto://task/",
		"proyekto://task/not-a-uuid",
		`proyekto://task/${ID}/extra`,
		`proyekto://task/${ID}?nodeId=other`,
		`proyekto://task/${ID}#fragment`,
	])("rejects an invalid entity URI: %s", (href) => {
		expect(parseEntityHref(href)).toBeNull();
	});

	it("uses distinct entity keys for different kinds", () => {
		expect(ENTITY_URI_SCHEME).toBe("proyekto:");
		expect(entityKey("task", ID)).toBe(`task:${ID}`);
		expect(entityKey("task", ID)).not.toBe(entityKey("epic", ID));
	});
});

describe("entity label grounding", () => {
	it.each([
		[" (Month 1) Supply network baseline!", "supplynetworkbaseline"],
		["Ａｃｍｅ – Workspace", "acmeworkspace"],
		["Straße ẞ", "strassess"],
		["ΟΣ ος", "οσοσ"],
		["ı I", "ıi"],
		["Ꭰ ꭰ", "ᎠᎠ"],
		["(First) (Second) Acme", "secondacme"],
		["\u0085(Month 1) Acme", "acme"],
		["\ufeff(Month 1) Acme", "month1acme"],
	])("normalizes %s identically to the agent", (label, expected) => {
		expect(normalizeEntityLabel(label)).toBe(expected);
	});

	it.each([
		["Acme", "ＡＣＭＥ", true],
		["(Month 1) Supply network baseline", "Supply network baseline", true],
		["Supply network baseline", "Supply network baseline report", true],
		["Test", "Test Project", false],
		["abcdefghijk", "abcdefghijkl", false],
		["abcdefghijkl", "abcdefghijklmnop", true],
		["David's Workspace", "Claude Maxxing", false],
		["", "", false],
		["...", "!", false],
		["𐐀𐐀𐐀𐐀𐐀𐐀", "𐐀𐐀𐐀𐐀𐐀𐐀X", false],
	])("matches %s against %s: %s", (left, right, expected) => {
		expect(entityLabelsMatch(left, right)).toBe(expected);
		expect(entityLabelsMatch(right, left)).toBe(expected);
	});
});

describe("aiMarkdownUrlTransform", () => {
	it("preserves valid entity links while retaining the default URL protection", () => {
		const href = `proyekto://task/${ID}`;
		expect(aiMarkdownUrlTransform(href, "href", ANCHOR)).toBe(href);
		expect(aiMarkdownUrlTransform("javascript:alert(1)", "href", ANCHOR)).toBe(
			"",
		);
		expect(aiMarkdownUrlTransform("proyekto://epic/E1", "href", ANCHOR)).toBe(
			"",
		);
		expect(
			aiMarkdownUrlTransform("https://proyekto.app/help", "href", ANCHOR),
		).toBe("https://proyekto.app/help");
	});
});

describe("stripEntityLinks", () => {
	it("keeps entity titles and relationship prose, including unexpanded handles", () => {
		expect(
			stripEntityLinks(
				`[Drag Task](proyekto://task/${ID}) in [Roadmap](proyekto://roadmap/R2) under [Feature](proyekto://feature/E1.F2) / [Epic](proyekto://epic/E1).`,
			),
		).toBe("Drag Task in Roadmap under Feature / Epic.");
	});

	it("leaves ordinary links and existing plain replies unchanged", () => {
		const text = "Done. [Documentation](https://proyekto.app/help) [note]\n";
		expect(stripEntityLinks(text)).toBe(text);
	});

	it.each([
		"proyekto:",
		"proyekto:/",
		"proyekto://task/",
		"proyekto://task/a91b9842-15ae",
		"proyekto://epic/R2.E1",
	])("hides an incomplete entity URI in streaming text: %s", (partial) => {
		expect(stripEntityLinks(`See [Drag Task](${partial}`)).toBe(
			"See Drag Task",
		);
	});

	it("preserves completed titles before an incomplete streaming link", () => {
		expect(
			stripEntityLinks(
				`[Task](proyekto://task/${ID}) in [Roadmap](proyekto://roadmap/`,
			),
		).toBe("Task in Roadmap");
		expect(stripEntityLinks("[Docs](https://proyekto.app/")).toBe(
			"[Docs](https://proyekto.app/",
		);
	});
});
