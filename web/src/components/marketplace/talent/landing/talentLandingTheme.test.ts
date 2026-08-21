import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = resolve(process.cwd(), "src/components/marketplace/talent/landing");

/**
 * The same guard `ProductExperienceTheme.test.ts` puts on the one compliant
 * marketing section, applied to every file in this folder.
 *
 * It exists because most of `components/root/` does NOT pass it — `#5E6AD2`,
 * `bg-[#f1f3f5]`, `text-slate-900` and friends are scattered through the
 * marketing tree, and they only look correct because `styles.css` carries a
 * large block of `html.dark` overrides written to rescue them. That block is a
 * safety net, not permission. A new page copying the section rhythm from
 * `consultant/index.tsx` would inherit its colours too unless something says
 * no, so this says no.
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

describe("talent landing theme compliance", () => {
	it("has files to check", () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it.each(files)("%s uses theme tokens, not a fixed palette", (file) => {
		const source = readFileSync(resolve(DIR, file), "utf8");
		expect(source.match(FIXED_LIGHT_SURFACE) ?? []).toEqual([]);
		expect(source.match(RAW_HEX) ?? []).toEqual([]);
	});

	it("keeps the CTA destination pointed at go-live", () => {
		const source = readFileSync(
			resolve(DIR, "StartSellingCtaButton.tsx"),
			"utf8",
		);
		expect(source).toContain("/marketplace/talent/go-live");
		// The signup detour is what carries the destination across a sign-in;
		// go-live's own redirect drops it.
		expect(source).toContain("redirect: GO_LIVE");
	});
});
