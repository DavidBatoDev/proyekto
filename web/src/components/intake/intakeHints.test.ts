import { describe, expect, it } from "vitest";
import {
	currencyOptions,
	currencyQuestionText,
	importerSideHint,
} from "./intakeHints";

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

describe("currency question", () => {
	const existing = {
		document_currencies: ["AUD"],
		project_currency: "USD",
		project_is_new: false,
		suggested: null,
	};

	it("asks to set or keep the project currency", () => {
		expect(currencyQuestionText(existing, true)).toBe(
			"Invoices are in AUD; the project is in USD. Set the project currency to AUD, or keep USD?",
		);
		expect(currencyOptions(existing)).toEqual([
			{ value: "AUD", label: "Set project currency to AUD" },
			{ value: "USD", label: "Keep USD" },
		]);
	});

	it("offers the documents' currency first for a new project", () => {
		const fresh = { ...existing, project_is_new: true, suggested: "AUD" };
		expect(currencyOptions(fresh)[0]).toEqual({
			value: "AUD",
			label: "Create the project in AUD",
		});
		expect(currencyQuestionText(fresh, false)).toContain(
			"a new project defaults to USD",
		);
	});
});
