import { apiClient } from "@/api";

/**
 * The marketplace intake survey.
 *
 * `intents` is what someone said they came here to do. It is a personalization
 * signal and nothing more — never gate a feature on it. Capability is
 * `consultant_profiles.status === "verified"` (`isActiveConsultant` in
 * `@/lib/auth-utils`); this steers copy and ordering.
 * `scripts/check_survey_is_not_authz.mjs` fails the build if that slips.
 */
export type SurveyIntent = "client" | "consultant" | "talent";
export type SurveyStatus = "in_progress" | "completed" | "skipped";
export type SurveyTalentGoal = "find_work" | "build_profile" | "get_verified";
export type SurveyCompanySize = "solo" | "2_10" | "11_50" | "51_plus";

export interface SurveyCategory {
	slug: string;
	name: string;
}

export interface MarketplaceSurvey {
	status: SurveyStatus;
	intents: SurveyIntent[];
	categories: SurveyCategory[];
	talent_goal: SurveyTalentGoal | null;
	company_size: SurveyCompanySize | null;
	completed_at: string | null;
	updated_at: string;
}

export interface SaveMarketplaceSurveyInput {
	intents: SurveyIntent[];
	category_slugs?: string[];
	talent_goal?: SurveyTalentGoal;
	company_size?: SurveyCompanySize;
	/**
	 * `skipped` is deliberately absent — dismissal goes through `skipSurvey()`,
	 * so the transition that means "never ask again" has exactly one way in.
	 */
	status?: "in_progress" | "completed";
}

/**
 * Unwraps the backend's `{ data }` envelope (ResponseInterceptor).
 *
 * Deliberately keyed on the envelope KEY rather than written as
 * `body.data ?? body`, which every other query in this repo can get away with
 * and this one cannot: `null` is a meaningful answer here — "never asked" — and
 * `??` falls through on it, handing back the envelope object itself. That is
 * truthy, so the modal reads it as an already-answered survey and never opens.
 */
function unwrap<T>(body: unknown): T | null {
	if (body && typeof body === "object" && "data" in body) {
		return ((body as { data: T | null }).data ?? null) as T | null;
	}
	return (body as T | null) ?? null;
}

/** Null when the user has never been asked, which is what opens the modal. */
export async function fetchMyMarketplaceSurvey(): Promise<MarketplaceSurvey | null> {
	const response = await apiClient.get("/api/marketplace/survey/mine");
	return unwrap<MarketplaceSurvey>(response.data);
}

export async function saveMarketplaceSurvey(
	input: SaveMarketplaceSurveyInput,
): Promise<MarketplaceSurvey> {
	const response = await apiClient.put("/api/marketplace/survey/mine", input);
	return unwrap<MarketplaceSurvey>(response.data) as MarketplaceSurvey;
}

export async function skipMarketplaceSurvey(): Promise<MarketplaceSurvey> {
	const response = await apiClient.post("/api/marketplace/survey/skip", {});
	return unwrap<MarketplaceSurvey>(response.data) as MarketplaceSurvey;
}

/** Shaped like `consultantKeys` so the two read the same way at call sites. */
export const marketplaceSurveyKeys = {
	all: ["marketplace-survey"] as const,
	mine: () => [...marketplaceSurveyKeys.all, "mine"] as const,
};
