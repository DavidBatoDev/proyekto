import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Theme guard for the shared seller-profile components and the two public
 * profile routes they power, mirroring applyTheme.test.ts. Semantic families
 * (the emerald "open to work" chip) stay allowed, same as the other guards.
 */
const DIR = resolve(process.cwd(), "src/components/marketplace/profile");
const ROUTES = [
	resolve(process.cwd(), "src/routes/marketplace/consultant/$profileId.tsx"),
	resolve(process.cwd(), "src/routes/marketplace/talent/$profileId.tsx"),
];

const FIXED_NEUTRAL_OR_BRAND =
	/\b(?:bg-white(?:\/\d+)?|(?:bg|text|border|from|to|ring)-(?:slate|gray|zinc|neutral|stone|blue|cyan|indigo|sky|violet|purple)-(?:50|100|200|300|400|500|600|700|800|900|950)(?:\/\d+)?)\b/g;

const RAW_HEX = /#[0-9a-fA-F]{3,8}\b/g;

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
	...ROUTES.map(
		(file) => [`route: ${relative(process.cwd(), file)}`, file] as const,
	),
];

describe("seller profile theme compliance", () => {
	it("has files to check", () => {
		expect(targets.length).toBeGreaterThan(2);
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
