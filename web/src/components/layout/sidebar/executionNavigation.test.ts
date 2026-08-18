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

	it("keeps the marketplace out of the execution shell entirely", () => {
		// Crossing between the two halves of the product is a top-level move and
		// belongs to the global header nav. Finance left this sidebar when the
		// shells split; the marketplace entry followed it out rather than giving
		// one jump two homes.
		const targets = EXECUTION_PRIMARY_NAV_ITEMS.map((item) => item.to);
		expect(targets.some((to) => to.startsWith("/marketplace"))).toBe(false);
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
