import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOC_ARTICLES, docFileKey } from "./docs.manifest";

/**
 * Guards over the written corpus.
 *
 * The prohibitions here are not style preferences. The docs render inside the
 * free mobile app, so a price or a link to the pricing page in an article is
 * the purchase-steering that store review looks for — the same line drawn in
 * `routes/not-available.tsx`. A test is the only thing that keeps that true
 * across 47 files and whoever writes the 48th.
 */

function read(slugPath: string): string {
	return readFileSync(
		fileURLToPath(
			new URL(`..${slugPath.replace("/src", "")}`, import.meta.url),
		),
		"utf8",
	);
}

const CORPUS = DOC_ARTICLES.map((article) => ({
	article,
	path: docFileKey(article),
	body: read(docFileKey(article)),
}));

describe("docs corpus", () => {
	it.each(CORPUS.map((e) => [e.article.slug, e] as const))(
		"%s has a body",
		(_slug, entry) => {
			expect(entry.body.trim().length).toBeGreaterThan(400);
			expect(entry.body.trim()).not.toBe("TODO");
		},
	);

	it("never shows a price", () => {
		// Currency amounts, and the phrases that carry one.
		const banned = [/\$\s?\d/, /\bUSD\b/, /per month\b/i, /per user\b/i];
		for (const { article, body } of CORPUS) {
			for (const pattern of banned) {
				expect(body, `${article.slug} matches ${pattern}`).not.toMatch(pattern);
			}
		}
	});

	it("never links to the pricing page", () => {
		// Plan articles link to /docs/workspaces-and-plans/plans instead; the
		// pricing link lives only in web-only chrome.
		for (const { article, body } of CORPUS) {
			expect(body, article.slug).not.toContain("/pricing");
		}
	});

	it("never says Prodigy", () => {
		for (const { article, body } of CORPUS) {
			expect(body, article.slug).not.toMatch(/prodigy/i);
		}
	});

	it("never mentions escrow, which does not exist", () => {
		for (const { article, body } of CORPUS) {
			expect(body, article.slug).not.toMatch(/escrow/i);
		}
	});

	it("starts with prose, not a title", () => {
		// The page renders the title from the manifest. A `# ` in the body would
		// print it twice.
		for (const { article, body } of CORPUS) {
			expect(body.trimStart().startsWith("# "), article.slug).toBe(false);
		}
	});

	it("only links to docs paths that exist", () => {
		const known = new Set(
			DOC_ARTICLES.map((a) => `/docs/${a.section}/${a.slug}`),
		);
		for (const { article, body } of CORPUS) {
			for (const match of body.matchAll(/\]\((\/docs\/[^)\s#]*)/g)) {
				const target = match[1].replace(/\/$/, "");
				expect(
					known.has(target) || target === "/docs",
					`${article.slug} → ${target}`,
				).toBe(true);
			}
		}
	});
});
