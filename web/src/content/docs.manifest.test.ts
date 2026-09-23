import { describe, expect, it } from "vitest";
import {
	DOC_ARTICLES,
	DOC_SECTIONS,
	docFileKey,
	docHref,
	popularArticles,
	sectionArticles,
} from "./docs.manifest";

/**
 * The manifest is data that four surfaces read — the sidebar, the home page,
 * search and the article route — so a typo in it is a broken docs site rather
 * than a compile error. These assertions are the cheapest place to catch that.
 */

describe("docs manifest", () => {
	it("has a unique section/slug pair for every article", () => {
		const paths = DOC_ARTICLES.map(docHref);
		expect(new Set(paths).size).toBe(paths.length);
	});

	it("puts every article in a section that exists", () => {
		const ids = new Set(DOC_SECTIONS.map((s) => s.id));
		for (const article of DOC_ARTICLES) {
			expect(ids.has(article.section), article.slug).toBe(true);
		}
	});

	it("gives every section exactly one hub", () => {
		for (const section of DOC_SECTIONS) {
			const hubs = sectionArticles(section.id).filter((a) => a.hub);
			expect(
				hubs.map((h) => h.slug),
				section.id,
			).toHaveLength(1);
		}
	});

	it("leaves no section empty", () => {
		for (const section of DOC_SECTIONS) {
			expect(sectionArticles(section.id).length, section.id).toBeGreaterThan(0);
		}
	});

	it("orders articles without collisions inside a section", () => {
		for (const section of DOC_SECTIONS) {
			const orders = sectionArticles(section.id).map((a) => a.order);
			expect(new Set(orders).size, section.id).toBe(orders.length);
		}
	});

	it("marks exactly four articles popular", () => {
		// The home page grid is a fixed 4-card row; a fifth would wrap oddly and
		// a third would leave a hole.
		expect(popularArticles().map((a) => a.slug)).toHaveLength(4);
	});

	it("never marks a web-only article popular", () => {
		// The Popular grid renders identically in the installed app, so a
		// web-only card there would be a link to a page the app refuses.
		for (const article of popularArticles()) {
			expect(article.surface, article.slug).toBeUndefined();
		}
	});

	it("resolves every related slug to a real article", () => {
		const slugs = new Set(DOC_ARTICLES.map((a) => a.slug));
		for (const article of DOC_ARTICLES) {
			for (const slug of article.related ?? []) {
				expect(slugs.has(slug), `${article.slug} → ${slug}`).toBe(true);
			}
		}
	});

	it("never relates an article to itself", () => {
		for (const article of DOC_ARTICLES) {
			expect(article.related ?? [], article.slug).not.toContain(article.slug);
		}
	});

	it("points every plan-gated article at the plans article", () => {
		// The R1 callout links there anyway, but an article that never mentions
		// it in its Related list reads as a dead end.
		for (const article of DOC_ARTICLES.filter((a) => a.plan)) {
			const reaches =
				article.slug === "plans" || (article.related ?? []).includes("plans");
			const viaHub = (article.related ?? []).includes("overview-governance");
			expect(reaches || viaHub, article.slug).toBe(true);
		}
	});

	it("keeps the whole web-only section web-only", () => {
		// platformSurfaces hides /docs/clients-and-marketplace wholesale, so an
		// article there without the flag would show in the app sidebar and then
		// bounce.
		for (const article of sectionArticles("clients-and-marketplace")) {
			expect(article.surface, article.slug).toBe("web");
		}
	});

	it("gives every article a one-sentence description", () => {
		for (const article of DOC_ARTICLES) {
			expect(article.description.length, article.slug).toBeGreaterThan(30);
			// Used as a meta description and on a card; two sentences overflow.
			expect(article.description.split(". ").length, article.slug).toBeLessThan(
				3,
			);
		}
	});

	it("derives a file key that matches the section and slug", () => {
		const article = DOC_ARTICLES[0];
		expect(docFileKey(article)).toBe(
			`/src/content/docs/${article.section}/${article.slug}.md`,
		);
	});

	it("carries the 48 articles the site was planned around", () => {
		// A tripwire, not a rule: if this changes, the sidebar and the home page
		// should be looked at rather than the number just bumped.
		expect(DOC_ARTICLES).toHaveLength(48);
		expect(DOC_SECTIONS).toHaveLength(10);
	});
});
