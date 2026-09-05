import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Mechanical guard on the shared AI kit's boundary.
 *
 * `components/ai/` serves the roadmap panel and the dashboard assistant, and
 * the dashboard mounts it beside grids that render MANY roadmaps. The roadmap
 * store is a singleton (one loaded roadmap), so anything that displays many
 * roadmaps must never mount or mutate it; roadmap-only behaviour reaches the
 * kit through the thin `roadmap/ai/RoadmapAiAssistantPanel.tsx` wrapper via
 * props and hooks. That rule is easy to state and easy to break with one
 * convenient import, so it is asserted here (pattern: `lib/flow/importBoundary`).
 *
 * Test files are exempt.
 */

const FORBIDDEN = [
	{
		pattern: /from\s+["']@\/stores\/roadmapStore["']/,
		what: "roadmapStore imports",
	},
	{
		pattern: /from\s+["']@\/components\/roadmap\//,
		what: "@/components/roadmap/ imports",
	},
	{
		pattern: /from\s+["']\.\.\/roadmap\//,
		what: "relative ../roadmap/ imports",
	},
];

function sourceFiles(dir: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			found.push(...sourceFiles(full));
			continue;
		}
		if (!/\.tsx?$/.test(entry)) continue;
		if (/\.test\.tsx?$/.test(entry)) continue;
		found.push(full);
	}
	return found;
}

describe("components/ai import boundary", () => {
	const files = sourceFiles(__dirname);

	it("finds the kit's source files", () => {
		// Guards the guard: a broken traversal would make every assertion below
		// vacuously pass.
		expect(files.length).toBeGreaterThan(20);
	});

	for (const { pattern, what } of FORBIDDEN) {
		it(`contains no ${what}`, () => {
			const offenders = files.filter((file) =>
				pattern.test(readFileSync(file, "utf8")),
			);
			expect(offenders).toEqual([]);
		});
	}
});
