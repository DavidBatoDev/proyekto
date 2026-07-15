import { describe, expect, it } from "vitest";
import {
	DASHBOARD_PRIMARY_NAV_ITEMS,
	isDashboardPrimaryNavItemActive,
} from "./dashboardNavigation";

describe("dashboard primary navigation", () => {
	it("routes Command Center to its renamed top-level page", () => {
		const commandCenter = DASHBOARD_PRIMARY_NAV_ITEMS.find(
			(item) => item.key === "command-center",
		);
		if (!commandCenter) throw new Error("Command Center navigation is missing");

		expect(commandCenter.label).toBe("Command Center");
		expect(commandCenter.to).toBe("/command-center");
		expect(
			isDashboardPrimaryNavItemActive(commandCenter, "/command-center"),
		).toBe(true);
		expect(isDashboardPrimaryNavItemActive(commandCenter, "/work-items")).toBe(
			false,
		);
	});
});
