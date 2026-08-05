import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const THEMED_PROJECT_POSTING_FILES = [
	new URL("../../routes/project-posting.tsx", import.meta.url),
	new URL("./Step1.tsx", import.meta.url),
	new URL("./Step2.tsx", import.meta.url),
	new URL("./TileOption.tsx", import.meta.url),
	new URL("./StepIndicator.tsx", import.meta.url),
	new URL("./ProjectTeamPicker.tsx", import.meta.url),
];

const LIGHT_ONLY_CLASS =
	/\b(?:bg|text|border|ring|from|via|to)-(?:white|slate|gray|orange|red)(?:\/\d+|-[\w/]+)?\b/g;
const HARDCODED_COLOR = /#[\da-f]{3,8}\b/gi;

describe("project posting theme", () => {
	it("uses semantic theme tokens throughout the complete form flow", () => {
		for (const fileUrl of THEMED_PROJECT_POSTING_FILES) {
			const source = readFileSync(fileURLToPath(fileUrl), "utf8");
			expect(source.match(LIGHT_ONLY_CLASS), fileUrl.pathname).toEqual(null);
			expect(source.match(HARDCODED_COLOR), fileUrl.pathname).toEqual(null);
		}
	});
});
