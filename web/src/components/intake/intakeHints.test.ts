import { describe, expect, it } from "vitest";
import { importerSideHint } from "./intakeHints";

describe("importerSideHint", () => {
	it("suggests the team name when the paper names the importer differently", () => {
		const hint = importerSideHint({
			read_name: "PRODIGITALITY",
			team_name: "JC Studio",
			matches: false,
		});
		expect(hint).toContain(
			'name you "PRODIGITALITY", not your team "JC Studio"',
		);
		expect(hint).toContain("recorded under JC Studio");
	});

	it("says nothing when the paper names the importer as they are known", () => {
		expect(
			importerSideHint({
				read_name: null,
				team_name: "JC Studio",
				matches: true,
			}),
		).toBeNull();
		expect(importerSideHint(undefined)).toBeNull();
	});
});
