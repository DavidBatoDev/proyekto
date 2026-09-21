import { describe, expect, it } from "vitest";
import {
	ENGAGEMENTS_NAV_ITEMS,
	FINANCE_NAV_ITEMS,
	FINANCE_TAB_PAGES,
	isEngagementsNavItemActive,
} from "./engagementsNavigation";

const financeItem = (key: string) => {
	const found = FINANCE_NAV_ITEMS.find((entry) => entry.key === key);
	if (!found) throw new Error(`missing finance nav item ${key}`);
	return found;
};

describe("engagements navigation", () => {
	it("keeps the engagements entry ungated and alone in its section", () => {
		// Every seat on an engagement reads its own agreements; the finance
		// places live in their own labelled group.
		expect(ENGAGEMENTS_NAV_ITEMS).toHaveLength(1);
		expect(ENGAGEMENTS_NAV_ITEMS[0].to).toBe("/engagements");
	});

	it("names the three finance levels as places", () => {
		// Home is the launcher, Personal is the caller's own book; teams and
		// their project books are appended at render time from the hub payload,
		// so only the static two are listed here.
		expect(FINANCE_NAV_ITEMS.map((entry) => entry.key)).toEqual([
			"finance-home",
			"finance-personal",
		]);
		expect(financeItem("finance-home").to).toBe("/engagements/finance");
		expect(financeItem("finance-personal").to).toBe("/engagements/finance/me");
	});

	it("keeps Home from claiming the deeper finance surfaces", () => {
		const home = financeItem("finance-home");
		expect(isEngagementsNavItemActive(home, "/engagements/finance")).toBe(true);
		for (const path of [
			"/engagements/finance/me",
			"/engagements/finance/team/abc",
			"/engagements/finance/book/abc",
			"/engagements/finance/portfolio",
			"/engagements/finance/contracts",
			"/engagements/finance/invoices",
			"/engagements/finance/imports",
		]) {
			expect(isEngagementsNavItemActive(home, path)).toBe(false);
		}
	});

	it("keeps the engagement list from claiming finance", () => {
		const engagements = ENGAGEMENTS_NAV_ITEMS[0];
		expect(
			isEngagementsNavItemActive(engagements, "/engagements/some-id"),
		).toBe(true);
		expect(
			isEngagementsNavItemActive(engagements, "/engagements/finance"),
		).toBe(false);
	});

	it("keeps the portfolio tabs reachable from search", () => {
		expect(FINANCE_TAB_PAGES.map((tab) => tab.to)).toEqual([
			"/engagements/finance/portfolio",
			"/engagements/finance/contracts",
			"/engagements/finance/invoices",
			"/engagements/finance/imports",
		]);
	});
});
