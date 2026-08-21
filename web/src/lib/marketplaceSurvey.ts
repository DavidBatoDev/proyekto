import type {
	MarketplaceSurvey,
	SurveyCompanySize,
	SurveyIntent,
	SurveyTalentGoal,
} from "@/queries/marketplaceSurvey";

/**
 * Labels and derivations for the marketplace intake survey.
 *
 * Pure: no React, no network. The point of the file is that
 * `consultant → "Solutions Lead"` is written down exactly once. The stored
 * value stays `consultant` because that is what `consultant_profiles`,
 * `/marketplace/consultant/*` and every guard already call it; only the
 * storefront copy differs, and a translation table is cheaper than a rename
 * across the product.
 */

export const INTENT_ORDER: readonly SurveyIntent[] = [
	"client",
	"consultant",
	"talent",
] as const;

export const INTENT_LABELS: Record<SurveyIntent, string> = {
	client: "Client",
	consultant: "Solutions Lead",
	talent: "Talent",
};

export const INTENT_DESCRIPTIONS: Record<SurveyIntent, string> = {
	client: "I want work delivered — I'll fund it and review it.",
	consultant: "I lead delivery — I scope the work and run the team.",
	talent: "I execute — I want to be found for the work I do.",
};

export const TALENT_GOAL_LABELS: Record<SurveyTalentGoal, string> = {
	find_work: "Find work to join",
	build_profile: "Build out my profile",
	get_verified: "Get verified as a Solutions Lead",
};

export const COMPANY_SIZE_LABELS: Record<SurveyCompanySize, string> = {
	solo: "Just me",
	"2_10": "2–10 people",
	"11_50": "11–50 people",
	"51_plus": "51+ people",
};

export function intentLabel(intent: SurveyIntent): string {
	return INTENT_LABELS[intent];
}

/**
 * The intent that wins when someone picks several.
 *
 * `INTENT_ORDER` decides, not the order they tapped: a Client who also does
 * Talent work is on the storefront to hire, and leading with "find work" for
 * them would be a worse first screen than the reverse mistake.
 */
export function primaryIntent(
	intents: readonly SurveyIntent[] | undefined,
): SurveyIntent | null {
	if (!intents?.length) return null;
	return INTENT_ORDER.find((intent) => intents.includes(intent)) ?? null;
}

export interface HeroCta {
	headline: string;
	subhead: string;
	label: string;
	to: string;
}

export interface HeroCtaContext {
	/**
	 * Whether the viewer is a verified consultant. This picks a DESTINATION, not
	 * a permission: both cases get a call to action, and someone who states
	 * Solutions Lead intent without the enrollment is sent to apply rather than
	 * to a page that would turn them away. Read it from
	 * `isActiveConsultant(profile)` — never from the survey, which knows nothing
	 * about capability.
	 */
	isConsultant?: boolean;
	/** For linking someone at their own profile editor. */
	userId?: string;
}

/**
 * What the storefront hero should lead with. Returns null for the un-surveyed
 * copy, which is what anonymous visitors and anyone who skipped will see —
 * that is the common path today, not an edge case.
 */
export function heroCtaFor(
	intents: readonly SurveyIntent[] | undefined,
	context: HeroCtaContext = {},
): HeroCta | null {
	switch (primaryIntent(intents)) {
		case "client":
			// Deliberately null. The default hero already IS the client call to
			// action — a post/hire toggle wired to exactly these two destinations —
			// so a band above it would duplicate the control sitting directly below.
			// The client payoff is the category-filtered consultant strip instead.
			return null;
		case "consultant":
			// Destination, not permission. /marketplace/consultant/manage does not
			// exist yet; when it lands it replaces the verified branch here.
			return context.isConsultant
				? {
						headline: "Put your practice in front of clients",
						subhead:
							"Your services, categories and rates are what clients search on. A fuller profile is a better match.",
						label: "Complete my profile",
						to: context.userId ? `/profile/${context.userId}` : "/marketplace",
					}
				: {
						headline: "Lead delivery on Proyekto",
						subhead:
							"Solutions Leads are vetted before they take on client work. Applying is the first step.",
						label: "Apply to lead delivery",
						to: "/marketplace/consultant/apply",
					};
		case "talent":
			return {
				headline: "Get found for the work you do",
				subhead:
					"Solutions Leads staff projects from the talent directory. Going live is how you get picked.",
				label: "Join the talent directory",
				to: "/marketplace/talent/go-live",
			};
		default:
			return null;
	}
}

/**
 * The category slug the storefront filters its consultant strip on.
 *
 * The first pick, because the survey stores `position` in the order the user
 * chose. Returns undefined rather than null so it can be spread straight into
 * query params without introducing a `category: null` key.
 */
export function leadCategorySlug(
	survey: MarketplaceSurvey | null | undefined,
): string | undefined {
	return survey?.categories?.[0]?.slug;
}

/** Whether the modal still has something to ask this user. */
export function surveyIsOutstanding(
	survey: MarketplaceSurvey | null | undefined,
): boolean {
	if (survey === undefined) return false; // not loaded yet — decide nothing
	if (survey === null) return true; // never asked
	return survey.status === "in_progress";
}
