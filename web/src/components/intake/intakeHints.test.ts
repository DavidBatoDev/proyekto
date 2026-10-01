import { describe, expect, it } from "vitest";
import {
	currencyOptions,
	currencyQuestionText,
	importerSideHint,
	tradingNameAction,
	withTradingName,
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

describe("tradingNameAction", () => {
	it("offers to save the paper's name as a trading name of the team", () => {
		expect(
			tradingNameAction({
				read_name: "PRODIGITALITY",
				team_name: "JC Studio",
				team_id: "team-1",
				matches: false,
			}),
		).toEqual({
			teamId: "team-1",
			name: "PRODIGITALITY",
			label: 'Save "PRODIGITALITY" as a trading name of JC Studio',
		});
	});

	it("offers nothing when the names match or there is no team", () => {
		expect(
			tradingNameAction({
				read_name: null,
				team_name: "JC Studio",
				team_id: "team-1",
				matches: true,
			}),
		).toBeNull();
		expect(
			tradingNameAction({
				read_name: "PRODIGITALITY",
				team_name: null,
				team_id: null,
				matches: false,
			}),
		).toBeNull();
	});

	it("adds a name once, keeping the existing ones", () => {
		expect(withTradingName(["Pro Digi"], " PRODIGITALITY ")).toEqual([
			"Pro Digi",
			"PRODIGITALITY",
		]);
		expect(withTradingName(["Prodigitality"], "PRODIGITALITY")).toEqual([
			"Prodigitality",
		]);
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
