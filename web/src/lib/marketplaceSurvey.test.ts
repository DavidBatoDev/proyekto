import { describe, expect, it } from "vitest";
import type { MarketplaceSurvey } from "@/queries/marketplaceSurvey";
import {
	heroCtaFor,
	INTENT_LABELS,
	intentLabel,
	leadCategorySlug,
	primaryIntent,
	surveyIsOutstanding,
} from "./marketplaceSurvey";

function survey(overrides: Partial<MarketplaceSurvey> = {}): MarketplaceSurvey {
	return {
		status: "completed",
		intents: ["client"],
		categories: [],
		talent_goal: null,
		company_size: null,
		completed_at: "2026-08-19T00:00:00Z",
		updated_at: "2026-08-19T00:00:00Z",
		...overrides,
	};
}

describe("intent labels", () => {
	it("renders the consultant intent as 'Solutions Lead' while storing 'consultant'", () => {
		// The whole reason this table exists: the stored value matches
		// consultant_profiles and every route, only the copy differs.
		expect(intentLabel("consultant")).toBe("Solutions Lead");
		expect(Object.keys(INTENT_LABELS)).toEqual([
			"client",
			"consultant",
			"talent",
		]);
	});

	it("never says 'Prodigy' — the product is Proyekto", () => {
		expect(JSON.stringify(INTENT_LABELS)).not.toMatch(/prodigy/i);
	});
});

describe("primaryIntent", () => {
	it("returns null when nothing was answered", () => {
		expect(primaryIntent(undefined)).toBeNull();
		expect(primaryIntent([])).toBeNull();
	});

	it("prefers client over everything, whatever order they were picked in", () => {
		// Someone who hires and also does the work is on the storefront to hire.
		// Leading with 'find work' for them is the worse of the two mistakes.
		expect(primaryIntent(["talent", "client"])).toBe("client");
		expect(primaryIntent(["consultant", "client"])).toBe("client");
	});

	it("prefers consultant over talent", () => {
		expect(primaryIntent(["talent", "consultant"])).toBe("consultant");
	});
});

describe("heroCtaFor", () => {
	it("returns nothing for a client, because the hero's post/hire toggle already is their CTA", () => {
		expect(heroCtaFor(["client"])).toBeNull();
	});

	it("returns nothing when the survey has not been answered", () => {
		expect(heroCtaFor(undefined)).toBeNull();
		expect(heroCtaFor([])).toBeNull();
	});

	it("sends a stated Solutions Lead who is not verified to apply, not to a page that would refuse them", () => {
		const cta = heroCtaFor(["consultant"], { isConsultant: false });
		expect(cta?.to).toBe("/marketplace/consultant/apply");
	});

	it("sends a verified consultant to their own profile", () => {
		const cta = heroCtaFor(["consultant"], {
			isConsultant: true,
			userId: "user-1",
		});
		expect(cta?.to).toBe("/profile/user-1");
	});

	it("does not build a broken profile link when the user id is missing", () => {
		const cta = heroCtaFor(["consultant"], { isConsultant: true });
		expect(cta?.to).toBe("/marketplace");
	});

	it("sends talent to go-live", () => {
		expect(heroCtaFor(["talent"])?.to).toBe("/marketplace/talent/go-live");
	});
});

describe("leadCategorySlug", () => {
	it("takes the first pick, which is the order the user chose them in", () => {
		expect(
			leadCategorySlug(
				survey({
					categories: [
						{ slug: "ai-and-data", name: "AI & Data" },
						{ slug: "design-and-brand", name: "Design & Brand" },
					],
				}),
			),
		).toBe("ai-and-data");
	});

	it("is undefined rather than null, so it can be spread into query params", () => {
		expect(leadCategorySlug(survey())).toBeUndefined();
		expect(leadCategorySlug(null)).toBeUndefined();
	});
});

describe("surveyIsOutstanding", () => {
	it("decides nothing while the answer is still loading", () => {
		// undefined is "not loaded". Treating it as "never asked" is what flashes
		// the modal at somebody who already answered.
		expect(surveyIsOutstanding(undefined)).toBe(false);
	});

	it("is outstanding when the user has never been asked", () => {
		expect(surveyIsOutstanding(null)).toBe(true);
	});

	it("is outstanding when the survey was opened but not finished", () => {
		expect(surveyIsOutstanding(survey({ status: "in_progress" }))).toBe(true);
	});

	it("is settled once completed or skipped — skipped is terminal", () => {
		expect(surveyIsOutstanding(survey({ status: "completed" }))).toBe(false);
		expect(surveyIsOutstanding(survey({ status: "skipped" }))).toBe(false);
	});
});
