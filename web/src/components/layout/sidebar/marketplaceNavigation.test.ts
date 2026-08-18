import { describe, expect, it } from "vitest";
import {
	isMarketplaceNavChildActive,
	isMarketplaceNavItemActive,
	MARKETPLACE_NAV_ITEMS,
} from "./marketplaceNavigation";

const finance = MARKETPLACE_NAV_ITEMS.find((item) => item.key === "finance");
if (!finance?.children) throw new Error("finance nav item lost its sections");
const children = finance.children;
const child = (key: string) => {
	const found = children.find((entry) => entry.key === key);
	if (!found) throw new Error(`missing nav child ${key}`);
	return found;
};

describe("marketplace finance sub-navigation", () => {
	it("gates finance on the consultant capability, not an identity", () => {
		expect(finance.requires).toBe("consultant");
	});

	it("lists one entry per addressable section", () => {
		expect(children.map((entry) => entry.to)).toEqual([
			"/marketplace/finance",
			"/marketplace/finance/contracts",
			"/marketplace/finance/engagements",
			"/marketplace/finance/invoices",
		]);
	});

	it("marks the parent active anywhere under finance", () => {
		expect(
			isMarketplaceNavItemActive(finance, "/marketplace/finance/invoices/new"),
		).toBe(true);
		expect(
			isMarketplaceNavItemActive(finance, "/marketplace/consultant/browse"),
		).toBe(false);
	});

	it("matches the overview exactly so it does not claim every section", () => {
		const overview = child("finance-overview");
		expect(
			isMarketplaceNavChildActive(overview, finance, "/marketplace/finance"),
		).toBe(true);
		expect(
			isMarketplaceNavChildActive(
				overview,
				finance,
				"/marketplace/finance/contracts",
			),
		).toBe(false);
	});

	it("keeps a section lit on its own deeper pages", () => {
		expect(
			isMarketplaceNavChildActive(
				child("finance-invoices"),
				finance,
				"/marketplace/finance/invoices/abc/edit",
			),
		).toBe(true);
	});

	it("lights nothing for a contract, which is not a section", () => {
		const contractPath =
			"/marketplace/finance/7f3c1e2a-0000-4000-8000-000000000000";
		expect(
			children.filter((entry) =>
				isMarketplaceNavChildActive(entry, finance, contractPath),
			),
		).toEqual([]);
	});
});
