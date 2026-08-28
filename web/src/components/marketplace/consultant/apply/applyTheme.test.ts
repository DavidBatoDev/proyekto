import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Theme guard for the consultant application wizard, mirroring
 * goLiveTheme.test.ts. The page this replaced carried 42 slate-* and 50
 * gray-* classes plus raw hex shadows and rendered light-only; this keeps
 * that from coming back. Semantic families (amber/emerald alpha tints over
 * theme surfaces) stay allowed, same as the talent guard.
 */
const DIR = resolve(
	process.cwd(),
	"src/components/marketplace/consultant/apply",
);
const ROUTE = resolve(
	process.cwd(),
	"src/routes/marketplace/consultant/apply.tsx",
);

const FIXED_NEUTRAL_OR_BRAND =
	/\b(?:bg-white(?:\/\d+)?|(?:bg|text|border|from|to|ring)-(?:slate|gray|zinc|neutral|stone|blue|cyan|indigo|sky|violet|purple)-(?:50|100|200|300|400|500|600|700|800|900|950)(?:\/\d+)?)\b/g;

const RAW_HEX = /#[0-9a-fA-F]{3,8}\b/g;

/** Strip comments so a docblock quoting the colour it replaced cannot fail the file. */
function withoutComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
}

function collect(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) return collect(full);
		if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) {
			return [];
		}
		return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")
			? [full]
			: [];
	});
}

const targets = [
	...collect(DIR).map((file) => [relative(DIR, file), file] as const),
	["route: apply.tsx", ROUTE] as const,
];

describe("consultant apply theme compliance", () => {
	it("has files to check", () => {
		expect(targets.length).toBeGreaterThan(1);
	});

	it.each(targets)(
		"%s uses theme tokens, not a fixed palette",
		(_name, path) => {
			const source = withoutComments(readFileSync(path, "utf8"));
			expect(source.match(FIXED_NEUTRAL_OR_BRAND) ?? []).toEqual([]);
			expect(source.match(RAW_HEX) ?? []).toEqual([]);
		},
	);
});
