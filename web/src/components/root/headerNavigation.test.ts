import { describe, expect, it } from "vitest";
import { HEADER_NAV_ITEMS, resolveHeaderNavAction } from "./headerNavigation";

describe("header navigation", () => {
	it("routes Templates to the marketplace from every page", () => {
		const templates = HEADER_NAV_ITEMS.find(
			(item) => item.label === "Templates",
		);
		if (!templates) throw new Error("Templates navigation item is missing");

		expect(resolveHeaderNavAction(templates, true)).toEqual({
			kind: "route",
			to: "/roadmap-templates",
		});
		expect(resolveHeaderNavAction(templates, false)).toEqual({
			kind: "route",
			to: "/roadmap-templates",
		});
	});

	it("keeps other marketing links as landing-section navigation", () => {
		const features = HEADER_NAV_ITEMS.find((item) => item.label === "Features");
		if (!features) throw new Error("Features navigation item is missing");

		expect(resolveHeaderNavAction(features, true)).toEqual({
			kind: "section",
			sectionIndex: 6,
		});
		expect(resolveHeaderNavAction(features, false)).toEqual({
			kind: "route",
			to: "/",
			hash: "features",
		});
	});
});
