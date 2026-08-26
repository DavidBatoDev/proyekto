import { describe, expect, it } from "vitest";
import { FINANCE_NAV_ITEMS, isFinanceNavItemActive } from "./financeNavigation";

const item = (key: string) => {
	const found = FINANCE_NAV_ITEMS.find((entry) => entry.key === key);
	if (!found) throw new Error(`missing finance nav item ${key}`);
	return found;
};

describe("finance navigation", () => {
	it("gates the personal sections on the consultant capability, not an identity", () => {
		expect(item("finance-overview").requires).toBe("consultant");
		expect(item("finance-contracts").requires).toBe("consultant");
		expect(item("finance-invoices").requires).toBe("consultant");
	});

	it("keeps the way back to engagements ungated", () => {
		// The shell is deliberately not consultant-gated: the Teams group must
		// reach project admins who are not marketplace consultants.
		expect(item("engagements").requires).toBeUndefined();
		expect(item("engagements").to).toBe("/engagements");
	});

	it("matches the overview exactly so it does not claim every section", () => {
		const overview = item("finance-overview");
		expect(isFinanceNavItemActive(overview, "/engagements/finance")).toBe(true);
		expect(
			isFinanceNavItemActive(overview, "/engagements/finance/contracts"),
		).toBe(false);
	});

	it("keeps a section lit on its own deeper pages", () => {
		expect(
			isFinanceNavItemActive(
				item("finance-invoices"),
				"/engagements/finance/invoices/abc/edit",
			),
		).toBe(true);
	});

	it("does not light the engagements item from inside finance", () => {
		expect(
			isFinanceNavItemActive(item("engagements"), "/engagements/finance"),
		).toBe(false);
	});
});
