import { describe, expect, it } from "vitest";
import { isSurveySurface } from "./MarketplaceSurveyGate";

/**
 * The allowlist is the whole safety story for a modal mounted on a PUBLIC
 * layout, so it gets tested directly rather than through a render. Anonymous
 * visitors and auth hydration are handled by `useIsAuthenticated` /
 * `useIsLoading` inside the component; what can actually regress by accident is
 * this list quietly growing to cover a page it should not interrupt.
 */
describe("isSurveySurface", () => {
	it("fires on the storefront", () => {
		expect(isSurveySurface("/marketplace")).toBe(true);
		expect(isSurveySurface("/marketplace/")).toBe(true);
	});

	it("fires on the browse surfaces", () => {
		expect(isSurveySurface("/marketplace/talent/browse")).toBe(true);
		expect(isSurveySurface("/marketplace/consultant/browse")).toBe(true);
	});

	it("fires anywhere in the category tree", () => {
		expect(isSurveySurface("/marketplace/category")).toBe(true);
		expect(isSurveySurface("/marketplace/category/ai-and-data")).toBe(true);
		expect(
			isSurveySurface("/marketplace/category/ai-and-data/machine-learning"),
		).toBe(true);
	});

	it("stays silent on a public consultant profile", () => {
		// Somebody followed a shared link to a real person. A modal over that is
		// the worst first impression the marketplace can make.
		expect(
			isSurveySurface(
				"/marketplace/consultant/1314a8dc-4500-4255-b3be-7158840fc242",
			),
		).toBe(false);
	});

	it("stays silent on the consultant landing and finance portfolio", () => {
		expect(isSurveySurface("/marketplace/consultant")).toBe(false);
		expect(isSurveySurface("/marketplace/consultant/apply")).toBe(false);
		expect(isSurveySurface("/marketplace/finance")).toBe(false);
		expect(isSurveySurface("/marketplace/finance/contracts")).toBe(false);
	});

	it("stays silent outside the marketplace entirely", () => {
		expect(isSurveySurface("/dashboard")).toBe(false);
		expect(isSurveySurface("/profile/abc")).toBe(false);
	});

	it("does not match a route that merely starts with an allowlisted path", () => {
		// `/marketplace/talent-pool` is not `/marketplace/talent`.
		expect(isSurveySurface("/marketplace/talent-pool")).toBe(false);
		expect(isSurveySurface("/marketplace/categories")).toBe(false);
	});
});
