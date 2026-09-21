import { describe, expect, it } from "vitest";
import {
	isMarketplaceNavItemActive,
	MARKETPLACE_NAV_ITEMS,
} from "./marketplaceNavigation";

describe("marketplace navigation", () => {
	it("no longer lists finance, which moved to /engagements/finance", () => {
		// Finance left the marketplace shell so team finance could sit outside
		// the consultant gate. The way there from this sidebar is Engagements.
		expect(
			MARKETPLACE_NAV_ITEMS.find((item) => item.key === "finance"),
		).toBeUndefined();
	});

	it("marks a prefix item active anywhere under it", () => {
		const browse = MARKETPLACE_NAV_ITEMS.find(
			(item) => item.key === "browse-consultants",
		);
		if (!browse) throw new Error("browse-consultants nav item missing");
		expect(
			isMarketplaceNavItemActive(browse, "/marketplace/consultant/browse"),
		).toBe(true);
		expect(isMarketplaceNavItemActive(browse, "/marketplace/talent")).toBe(
			false,
		);
	});
});

describe("engagements entry", () => {
	// The one item deliberately pointing outside /marketplace: the page is the
	// bridge between the marketplace and execution, shared with the execution
	// sidebar, and readable by every seat -- so it must never grow a gate.
	it("points at the top-level page and stays ungated", () => {
		const engagements = MARKETPLACE_NAV_ITEMS.find(
			(item) => item.key === "engagements",
		);
		expect(engagements?.to).toBe("/engagements");
		expect(engagements?.requires).toBeUndefined();
	});
});
