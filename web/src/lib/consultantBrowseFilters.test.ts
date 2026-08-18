import { describe, expect, it } from "vitest";
import {
	countActiveFilters,
	parseConsultantBrowseSearch,
	toDirectoryParams,
} from "./consultantBrowseFilters";

describe("parseConsultantBrowseSearch", () => {
	it("drops values the rail never offers", () => {
		const parsed = parseConsultantBrowseSearch({
			budget: "free-please",
			delivery: 3,
			language: "EN",
			rating: "5",
		});

		expect(parsed.budget).toBeUndefined();
		expect(parsed.delivery).toBeUndefined();
		expect(parsed.language).toBe("en");
		expect("rating" in parsed).toBe(false);
	});

	// A sub-category slug is only unique inside its category, so one that
	// outlived its category being cleared would resolve to nothing - or worse,
	// to a leaf under a different discipline.
	it("drops a speciality left behind by a cleared category", () => {
		expect(
			parseConsultantBrowseSearch({
				subcategory: "llm-application-development",
			}).subcategory,
		).toBeUndefined();
	});

	it("keeps hourly bounds only while the hourly filter is on", () => {
		expect(
			parseConsultantBrowseSearch({ hourlyMin: 50, hourlyMax: 150 }).hourlyMin,
		).toBeUndefined();
		expect(
			parseConsultantBrowseSearch({ hourly: "true", hourlyMin: 50 }).hourlyMin,
		).toBe(50);
	});
});

describe("toDirectoryParams", () => {
	it("expands a budget bracket into the bounds the API takes", () => {
		expect(toDirectoryParams({ budget: "1k-5k" })).toMatchObject({
			budgetMin: 1000,
			budgetMax: 5000,
		});
	});

	it("leaves an unset toggle undefined rather than false", () => {
		// `false` would reach the API as a filter meaning "only consultants
		// WITHOUT an hourly rate", which is the opposite of "do not filter".
		const params = toDirectoryParams({});
		expect(params.offersHourly).toBeUndefined();
		expect(params.availableNow).toBeUndefined();
		expect(params.hasServices).toBeUndefined();
	});
});

describe("countActiveFilters", () => {
	it("ignores the free-text search, which has its own visible input", () => {
		expect(countActiveFilters({ q: "react" })).toBe(0);
		expect(countActiveFilters({ q: "react", category: "ai-and-data" })).toBe(1);
	});
});
