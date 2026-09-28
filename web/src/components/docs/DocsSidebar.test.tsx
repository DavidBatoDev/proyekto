/* @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ native: false }));
vi.mock("@/lib/platform", () => ({ isNativeApp: () => mocks.native }));

import { visibleArticles, visibleSections } from "./DocsSidebar";

describe("docs navigation", () => {
	it("shows every section on the web", () => {
		const sections = visibleSections(false);
		expect(sections).toHaveLength(10);
		expect(sections.map((s) => s.section.id)).toContain(
			"clients-and-marketplace",
		);
	});

	it("drops the marketplace section in the installed app", () => {
		// platformSurfaces already refuses those paths natively; hiding them here
		// is what stops the sidebar offering a link that bounces.
		const sections = visibleSections(true);
		expect(sections.map((s) => s.section.id)).not.toContain(
			"clients-and-marketplace",
		);
		// And nothing else is lost.
		expect(sections).toHaveLength(9);
	});

	it("never leaves an empty section in the rail", () => {
		for (const native of [false, true]) {
			for (const group of visibleSections(native)) {
				expect(group.articles.length, group.section.id).toBeGreaterThan(0);
			}
		}
	});

	it("hides exactly the web-only articles on native", () => {
		const web = visibleArticles(false);
		const app = visibleArticles(true);
		expect(web.length - app.length).toBe(
			web.filter((a) => a.surface === "web").length,
		);
		expect(app.every((a) => a.surface !== "web")).toBe(true);
	});
});
