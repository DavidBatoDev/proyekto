import { describe, expect, it } from "vitest";
import {
	mapRetiredCategorySlug,
	RETIRED_CATEGORY_SLUGS,
} from "./marketplaceCategoryRedirects";

const SURVIVING = [
	"product-and-strategy",
	"software-engineering",
	"ai-and-data",
	"cloud-devops-and-security",
	"design-and-brand",
	"growth-and-sales",
	"business-operations",
];

describe("mapRetiredCategorySlug", () => {
	it("forwards each merged category to the one that absorbed it", () => {
		expect(mapRetiredCategorySlug("sales-and-revenue")).toBe(
			"growth-and-sales",
		);
		expect(mapRetiredCategorySlug("growth-and-marketing")).toBe(
			"growth-and-sales",
		);
		expect(mapRetiredCategorySlug("operations-and-delivery")).toBe(
			"business-operations",
		);
		expect(mapRetiredCategorySlug("people-and-organisation")).toBe(
			"business-operations",
		);
		expect(mapRetiredCategorySlug("finance-and-fundraising")).toBe(
			"business-operations",
		);
	});

	it("leaves the seven surviving categories alone", () => {
		// A redirect on a live slug would be an infinite loop, since the target
		// route is the one doing the redirecting.
		for (const slug of SURVIVING) {
			expect(mapRetiredCategorySlug(slug)).toBeUndefined();
		}
	});

	it("never forwards to a slug that is itself retired", () => {
		// Chained redirects would bounce twice, and the second hop only works by
		// accident of ordering.
		for (const target of Object.values(RETIRED_CATEGORY_SLUGS)) {
			expect(SURVIVING).toContain(target);
		}
	});

	it("does not forward industry-practices", () => {
		// Retired outright rather than merged: it classified sectors, not
		// disciplines, so any destination would be a guess.
		expect(mapRetiredCategorySlug("industry-practices")).toBeUndefined();
	});

	it("matches case-insensitively and ignores unknown slugs", () => {
		expect(mapRetiredCategorySlug("Sales-And-Revenue")).toBe(
			"growth-and-sales",
		);
		expect(mapRetiredCategorySlug("not-a-category")).toBeUndefined();
	});
});
