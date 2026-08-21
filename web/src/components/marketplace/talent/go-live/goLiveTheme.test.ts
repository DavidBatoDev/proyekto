import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Go live wizard was the worst theme offender in the marketplace: 25 copies
 * of `#3b82f6`, 20 of `#333438`, a `#ff9933` progress fill, and `bg-white` /
 * `border-gray-200` at every surface. None of it inverted, so the page rendered
 * light-only under all four themes. This keeps it from drifting back.
 *
 * Scope is the wizard's own surface — the route plus the primitives it draws
 * from. The neutral and brand families are what regress (a copied `bg-white`
 * card, a pasted blue), so those are banned outright.
 *
 * Semantic families — amber for caution, emerald for verified — are NOT banned:
 * the house pattern is an alpha tint over the theme surface plus a `dark:` text
 * variant (`bg-amber-500/10 text-amber-700 dark:text-amber-300`), which is
 * exactly what a themeable warning looks like. Banning them would push callers
 * back to raw hex, which is worse.
 */
const DIR = resolve(process.cwd(), "src/components/marketplace/talent/go-live");
const ROUTE = resolve(
	process.cwd(),
	"src/routes/marketplace/talent/go-live.tsx",
);

const FIXED_NEUTRAL_OR_BRAND =
	/\b(?:bg-white(?:\/\d+)?|(?:bg|text|border|from|to|ring)-(?:slate|gray|zinc|neutral|stone|blue|cyan|indigo|sky|violet|purple)-(?:50|100|200|300|400|500|600|700|800|900|950)(?:\/\d+)?)\b/g;

const RAW_HEX = /#[0-9a-fA-F]{3,8}\b/g;

/**
 * Comments are prose, not paint. The docblocks in this folder quote the exact
 * colours they replaced — that is the point of them — so scanning raw source
 * would fail a file on its own explanation. Strip block comments, and line
 * comments that are not the `//` of a URL.
 */
function withoutComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
}

/**
 * Recursive on purpose. The first version read only the top level, so the
 * moment the wizard grew `steps/` and `sections/` subfolders every file in them
 * slipped past the guard — the exact place new hardcoded colour is most likely
 * to arrive.
 */
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
	["route: go-live.tsx", ROUTE] as const,
];

describe("go-live theme compliance", () => {
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

	it("keeps the wizard inside the marketplace shell", () => {
		const source = readFileSync(ROUTE, "utf8");
		// pt-app-header clears the global header. The marketplace footer is
		// deliberately NOT here: a wizard wants no competing navigation, and a
		// full link farm under a five-step form invites people to wander off
		// mid-flow.
		expect(source).toContain("pt-app-header");
		expect(source).not.toContain("<MarketplaceFooter />");
	});
});
