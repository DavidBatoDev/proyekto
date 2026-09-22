import { describe, expect, it } from "vitest";
import { DOC_ARTICLES, docFileKey } from "./docs.manifest";
import { bodyKeys, hasBody, searchDocs } from "./docsContent";

describe("docs bodies", () => {
	it("has a file for every article and an article for every file", () => {
		// The manifest and the folder drift apart silently otherwise: an orphan
		// file is invisible, and a dangling entry is a 404.
		const expected = new Set(DOC_ARTICLES.map(docFileKey));
		const actual = new Set(bodyKeys());

		expect([...expected].filter((k) => !actual.has(k))).toEqual([]);
		expect([...actual].filter((k) => !expected.has(k))).toEqual([]);
	});

	it("resolves each article to its body", () => {
		for (const article of DOC_ARTICLES) {
			expect(hasBody(article), article.slug).toBe(true);
		}
	});
});

describe("docs search", () => {
	it("returns nothing for an empty query", () => {
		expect(searchDocs("   ", { includeWebOnly: true })).toEqual([]);
	});

	it("puts an exact title first", () => {
		const hits = searchDocs("tasks", { includeWebOnly: true });
		expect(hits[0]?.article.slug).toBe("tasks");
	});

	it("matches a word that appears only in keywords", () => {
		// "kanban" is nowhere in the board article's title or description; the
		// keywords field exists so metadata-only search still finds it.
		const hits = searchDocs("kanban", { includeWebOnly: true });
		expect(hits.map((h) => h.article.slug)).toContain("board");
	});

	it("matches on description", () => {
		const hits = searchDocs("acceptance criteria", { includeWebOnly: true });
		expect(hits.map((h) => h.article.slug)).toContain("deliverables");
	});

	it("hides web-only articles from the installed app", () => {
		const slugs = searchDocs("invoice", { includeWebOnly: false }).map(
			(h) => h.article.slug,
		);
		expect(slugs).not.toContain("contracts-and-invoices");
		expect(
			searchDocs("invoice", { includeWebOnly: true }).map(
				(h) => h.article.slug,
			),
		).toContain("contracts-and-invoices");
	});

	it("is case-insensitive", () => {
		expect(
			searchDocs("ROADMAP", { includeWebOnly: true }).length,
		).toBeGreaterThan(0);
	});
});
