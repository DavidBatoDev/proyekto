import { describe, expect, it } from "vitest";
import {
	EXECUTION_PRIMARY_NAV_ITEMS,
	isExecutionNavItemActive,
} from "./executionNavigation";

describe("EXECUTION_PRIMARY_NAV_ITEMS", () => {
	it("carries an icon on every item", () => {
		// The icons used to live in a separate map keyed by `key`; a missing
		// entry there rendered nothing instead of failing.
		for (const item of EXECUTION_PRIMARY_NAV_ITEMS) {
			expect(item.icon, `${item.key} has no icon`).toBeTruthy();
		}
	});

	it("keeps marketplace surfaces out of the execution shell", () => {
		// Finance moved to the marketplace nav. The execution sidebar offers the
		// marketplace as a destination, not its individual pages.
		const targets = EXECUTION_PRIMARY_NAV_ITEMS.map((item) => item.to);
		expect(targets).toContain("/marketplace");
		expect(targets.some((to) => to.startsWith("/marketplace/"))).toBe(false);
	});

	it("matches the marketplace entry across the whole subtree", () => {
		const marketplace = EXECUTION_PRIMARY_NAV_ITEMS.find(
			(item) => item.key === "marketplace",
		);
		if (!marketplace) throw new Error("marketplace nav item missing");
		expect(isExecutionNavItemActive(marketplace, "/marketplace")).toBe(true);
		expect(isExecutionNavItemActive(marketplace, "/marketplace/finance")).toBe(
			true,
		);
	});

	it("matches exact items only on their own path", () => {
		const dashboard = EXECUTION_PRIMARY_NAV_ITEMS.find(
			(item) => item.key === "dashboard",
		);
		if (!dashboard) throw new Error("dashboard nav item missing");
		expect(isExecutionNavItemActive(dashboard, "/dashboard")).toBe(true);
		expect(isExecutionNavItemActive(dashboard, "/dashboard/extra")).toBe(false);
	});
});
