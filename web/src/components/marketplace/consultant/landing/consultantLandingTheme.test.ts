import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = resolve(
	process.cwd(),
	"src/components/marketplace/consultant/landing",
);
const ROUTE = resolve(
	process.cwd(),
	"src/routes/marketplace/consultant/index.tsx",
);
/** The combined storefront that now composes these sections (plus the toggle). */
const COMBINED_ROUTE = resolve(process.cwd(), "src/routes/start-selling.tsx");

/**
 * The talent landing's guard, applied to the consultant landing — the page it
 * replaced was the exact anti-pattern that guard's docblock warned against
 * copying (42 slate-* / 50 gray-* classes, raw-rgba shadows, light-only).
 * This keeps it from drifting back.
 */
const FIXED_LIGHT_SURFACE =
	/\b(?:bg-white(?:\/\d+)?|(?:bg|text|border|from|to)-(?:slate|gray|blue|cyan|indigo|sky)-(?:50|100|200|300|400|500|600|700|800|900|950)(?:\/\d+)?)\b/g;

/** Any raw hex colour, which the theme-token rule forbids outright. */
const RAW_HEX = /#[0-9a-fA-F]{3,8}\b/g;

const files = readdirSync(DIR).filter(
	(file) =>
		file.endsWith(".tsx") ||
		(file.endsWith(".ts") && !file.endsWith(".test.ts")),
);

const targets: [string, string][] = [
	...files.map((file) => [file, resolve(DIR, file)] as [string, string]),
	["route: consultant/index.tsx", ROUTE],
	["route: start-selling.tsx", COMBINED_ROUTE],
];

describe("consultant landing theme compliance", () => {
	it("has files to check", () => {
		expect(targets.length).toBeGreaterThan(1);
	});

	it.each(targets)(
		"%s uses theme tokens, not a fixed palette",
		(_name, path) => {
			const source = readFileSync(path, "utf8");
			expect(source.match(FIXED_LIGHT_SURFACE) ?? []).toEqual([]);
			expect(source.match(RAW_HEX) ?? []).toEqual([]);
		},
	);

	it("keeps the CTA destination pointed at the apply wizard", () => {
		const source = readFileSync(resolve(DIR, "ApplyCtaButton.tsx"), "utf8");
		expect(source).toContain("/marketplace/consultant/apply");
		// The signup detour is what carries the destination across a sign-in;
		// the apply route's own login redirect drops it.
		expect(source).toContain("redirect: APPLY");
	});
});
