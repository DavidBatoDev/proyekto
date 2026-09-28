import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	classifySurface,
	isVisibleInApp,
	nativeDestinationFor,
} from "./platformSurfaces";

/**
 * The drift guard: every route the router generates must have a platform
 * decision, and the whole table is snapshotted so adding one is a deliberate
 * act rather than something a prefix rule silently absorbs.
 *
 * `routeTree.gen.ts` is generated and hook-protected, so it is read as TEXT and
 * never imported — the same technique `playwright/audit/assert-route-coverage.mjs`
 * uses. Importing it would pull half the app into this test.
 */

const ROUTE_TREE = fileURLToPath(
	new URL("../routeTree.gen.ts", import.meta.url),
);

function generatedPaths(): string[] {
	const source = readFileSync(ROUTE_TREE, "utf8");
	const found = new Set<string>();
	for (const match of source.matchAll(/fullPath: '([^']*)'/g)) {
		if (match[1]) found.add(match[1]);
	}
	return [...found].sort();
}

describe("every generated route has a platform decision", () => {
	const paths = generatedPaths();

	it("finds the generated route table", () => {
		// A rename or a format change in the generator would silently empty this
		// suite, and an empty suite passes.
		expect(paths.length).toBeGreaterThan(100);
	});

	it.each(paths)("classifies %s", (path) => {
		const surface = classifySurface(path);
		expect(
			surface,
			`"${path}" has no platform decision, so the installed app would hide it. Add a rule to SURFACE_RULES in web/src/lib/platformSurfaces.ts: "app" for a normal SaaS page, "commerce" if it sells anything or shows a price, "marketplace" if it belongs to the marketplace half of the product.`,
		).not.toBeNull();
	});

	it("matches the recorded surface of every route", () => {
		// Snapshot, not just a null check: a new route COVERED by an existing
		// prefix — /marketplace/gigs, say — still changes this table, which
		// forces a human to look at it before running with -u.
		expect(
			Object.fromEntries(paths.map((path) => [path, classifySurface(path)])),
		).toMatchSnapshot();
	});

	it("leaves the browser untouched", () => {
		// The mechanical proof that this change is invisible on the web: the
		// mobile bundle and the web bundle are the same artifact, so "web is
		// unchanged" is a runtime property and has to be asserted as one.
		for (const path of paths) {
			expect(isVisibleInApp(path, false), path).toBe(true);
		}
	});

	it("sends every hidden route somewhere the app actually shows", () => {
		const destinations = new Set<string>();
		for (const path of paths) {
			const to = nativeDestinationFor(path);
			if (to) destinations.add(to);
		}

		expect(destinations.size).toBeGreaterThan(0);
		for (const to of destinations) {
			// No loop, and no 404 — these are reached by push taps carrying
			// paths written months ago.
			expect(nativeDestinationFor(to), to).toBeNull();
			expect(classifySurface(to), to).toBe("app");
		}
	});
});
