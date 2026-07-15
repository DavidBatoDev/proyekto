import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const FIXED_LIGHT_SURFACE =
	/\b(?:bg-white(?:\/\d+)?|(?:bg|text|border|from|to)-(?:slate|gray|blue|cyan|indigo|sky)-(?:50|100|200)(?:\/\d+)?)\b|#fcfcfd/g;

describe("ProductExperienceSection theme", () => {
	it("uses semantic surfaces and readable text across dark themes", () => {
		const source = readFileSync(
			resolve(
				process.cwd(),
				"src/components/root/ProductExperienceSection.tsx",
			),
			"utf8",
		);

		expect(source.match(FIXED_LIGHT_SURFACE) ?? []).toEqual([]);
		expect(source).toContain("bg-card/80");
		expect(source).toContain("text-muted-foreground");
		expect(source).toContain("from-background via-background/85");
	});
});
