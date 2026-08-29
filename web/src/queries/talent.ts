import { apiClient } from "@/api";
import type {
	ConsultantPublicExperience,
	ConsultantPublicLanguage,
	ConsultantPublicPortfolio,
	ConsultantPublicRates,
	ConsultantPublicSkill,
} from "@/queries/consultants";

/**
 * The public talent profile, as `GET /api/marketplace/talent/:id` returns it.
 * Only ACTIVE listings exist here — a paused or never-listed account is a
 * 404, so `is_open_to_work` is always true on a payload that arrived.
 *
 * Skills, rates, languages, experiences and portfolios share the consultant
 * public shapes on purpose: the backend serves both from one set of
 * allowlists, and the section components are shared between the two pages.
 */
export interface TalentPublicSpecialization {
	id: string;
	category: string;
	subCategory: string | null;
	yearsOfExperience: number | null;
	description: string | null;
}

export interface TalentPublicProfile {
	id: string;
	display_name: string | null;
	avatar_url: string | null;
	banner_url: string | null;
	headline: string | null;
	bio: string | null;
	country: string | null;
	city: string | null;
	created_at: string | null;
	is_open_to_work: boolean;
	specializations: TalentPublicSpecialization[];
	skills: ConsultantPublicSkill[];
	rates: ConsultantPublicRates | null;
	languages: ConsultantPublicLanguage[];
	experiences: ConsultantPublicExperience[];
	portfolios: ConsultantPublicPortfolio[];
}

export const talentKeys = {
	detail: (userId: string) => ["talent", "public", userId] as const,
};

/**
 * `noStore` is the owner's freshness path: the endpoint is served with a
 * public max-age, so after a WYSIWYG edit the browser HTTP cache would hand
 * the owner their own stale page for up to a minute even though Redis and the
 * edge were purged. A `Cache-Control: no-cache` REQUEST header forces
 * revalidation without fragmenting the edge cache the way a URL-buster would.
 */
export async function fetchTalentProfile(
	userId: string,
	options?: { noStore?: boolean },
): Promise<TalentPublicProfile> {
	const response = await apiClient.get(
		`/api/marketplace/talent/${userId}`,
		options?.noStore ? { headers: { "Cache-Control": "no-cache" } } : undefined,
	);
	return response.data.data ?? response.data;
}
