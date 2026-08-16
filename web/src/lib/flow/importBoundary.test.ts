import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Mechanical guard on the library boundary.
 *
 * `lib/flow/` is meant to be liftable into a standalone package, which is only
 * true while it depends on nothing but React. That property is easy to state in
 * a doc comment and easy to break with one convenient import, so it is asserted
 * here instead.
 *
 * Test files are exempt. The `@xyflow` patterns are kept even though those
 * packages are gone — the point is now to stop them being reintroduced, since
 * this library exists precisely so the app does not depend on one.
 */

const FORBIDDEN = [
	{ pattern: /from\s+["']@\//, what: "app-internal (@/) imports" },
	{ pattern: /from\s+["']@xyflow\//, what: "@xyflow imports" },
	{ pattern: /from\s+["']@mui\//, what: "MUI imports" },
	{ pattern: /from\s+["']framer-motion["']/, what: "framer-motion imports" },
	{ pattern: /from\s+["']@dnd-kit\//, what: "dnd-kit imports" },
	{ pattern: /from\s+["']zustand["']/, what: "zustand imports" },
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

describe("lib/flow import boundary", () => {
	const files = sourceFiles(__dirname);

	it("finds the library's source files", () => {
		// Guards the guard: a broken traversal would make every assertion below
		// vacuously pass.
		expect(files.length).toBeGreaterThan(4);
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
