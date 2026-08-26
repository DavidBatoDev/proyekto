import { describe, expect, it } from "vitest";
import {
	ENGAGEMENTS_NAV_ITEMS,
	FINANCE_TAB_PAGES,
	isEngagementsNavItemActive,
} from "./engagementsNavigation";

const item = (key: string) => {
	const found = ENGAGEMENTS_NAV_ITEMS.find((entry) => entry.key === key);
	if (!found) throw new Error(`missing engagements nav item ${key}`);
	return found;
};

describe("engagements navigation", () => {
	it("gates finance on the consultant capability, not an identity", () => {
		expect(item("finance").requires).toBe("consultant");
	});

	it("keeps the engagements entry ungated", () => {
		// Every seat on an engagement reads its own agreements, and the teams
		// nested under finance must reach project admins who are not marketplace
		// consultants.
		expect(item("engagements").requires).toBeUndefined();
		expect(item("engagements").to).toBe("/engagements");
	});

	it("names sections, not the tabs inside them", () => {
		// Overview / Contracts / Invoices are tabs on the finance page; listing
		// them here as well would give each one two places to be selected from.
		expect(ENGAGEMENTS_NAV_ITEMS).toHaveLength(2);
		expect(
			ENGAGEMENTS_NAV_ITEMS.some((entry) =>
				FINANCE_TAB_PAGES.some(
					(tab) => tab.to === entry.to && tab.key !== "finance-overview",
				),
			),
		).toBe(false);
	});

	it("keeps the finance tabs reachable from search", () => {
		expect(FINANCE_TAB_PAGES.map((tab) => tab.to)).toEqual([
			"/engagements/finance",
			"/engagements/finance/contracts",
			"/engagements/finance/invoices",
		]);
	});

	it("keeps finance lit on its own deeper pages", () => {
		expect(
			isEngagementsNavItemActive(
				item("finance"),
				"/engagements/finance/invoices/abc/edit",
			),
		).toBe(true);
	});

	it("hands a team's book to the team entry rather than to finance", () => {
		expect(
			isEngagementsNavItemActive(
				item("finance"),
				"/engagements/finance/team/team-1/invoices",
			),
		).toBe(false);
	});

	it("lights the engagements item on the detail page it owns", () => {
		expect(
			isEngagementsNavItemActive(item("engagements"), "/engagements/eng-1"),
		).toBe(true);
	});

	it("does not light the engagements item from inside finance", () => {
		expect(
			isEngagementsNavItemActive(item("engagements"), "/engagements/finance"),
		).toBe(false);
	});
});
