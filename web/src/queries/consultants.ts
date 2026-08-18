import { apiClient } from "@/api";
import type { ConsultantExpertise } from "../types/marketplace-taxonomy";
import type { Profile } from "../types/profile.types";

/**
 * A consultant as the public profile endpoint returns them.
 *
 * Only the detail route carries `expertise` and `consultant_verified_at`; the
 * directory deliberately does not, so the extra fields sit on this type rather
 * than on `Profile`, where every consumer would have to treat them as maybe-set.
 */
/** One published catalog entry, as the profile grid renders it. */
export interface ConsultantPublicService {
	id: string;
	title: string;
	description: string | null;
	cover_url: string | null;
	starting_price: number | null;
	currency: string;
	price_unit: string;
	delivery_days: number | null;
}

export interface ConsultantPublicSkill {
	name: string;
	slug: string;
	category: string | null;
	proficiencyLevel: string | null;
	yearsExperience: number | null;
}

/**
 * The shared rate card. Null when the consultant has not set an hourly rate —
 * the profile then renders nothing rather than "rate on request", which would
 * be a claim they did not make.
 */
export interface ConsultantPublicRates {
	hourlyRate: number | null;
	currency: string;
	availability: string | null;
}

export interface ConsultantPublicLanguage {
	code: string;
	name: string;
	fluency: string | null;
}

export interface ConsultantPublicExperience {
	id: string;
	company: string | null;
	title: string | null;
	location: string | null;
	is_remote: boolean | null;
	description: string | null;
	start_date: string | null;
	end_date: string | null;
	is_current: boolean | null;
}

export interface ConsultantPublicTemplate {
	id: string;
	slug: string;
	title: string;
	summary: string;
	preview_url: string;
	difficulty: string;
	estimated_duration_days: number;
	rating_average: number;
	rating_count: number;
	use_count: number;
	published_at: string | null;
}

export interface ConsultantPublicPortfolio {
	id: string;
	title: string;
	description: string | null;
	url: string | null;
	image_url: string | null;
	tags: string[] | null;
	position: number | null;
}

export interface ConsultantPublicProfile extends Profile {
	consultant_verified_at: string | null;
	expertise: ConsultantExpertise[];
	services: ConsultantPublicService[];
	skills: ConsultantPublicSkill[];
	rates: ConsultantPublicRates | null;
	templates: ConsultantPublicTemplate[];
	languages: ConsultantPublicLanguage[];
	experiences: ConsultantPublicExperience[];
	portfolios: ConsultantPublicPortfolio[];
}

/**
 * Fetch all verified consultants
 */
export async function fetchConsultants(): Promise<Profile[]> {
	const response = await apiClient.get("/api/consultants");
	return response.data.data ?? response.data;
}

/**
 * Fetch a specific consultant by ID
 */
export async function fetchConsultantProfile(
	userId: string,
): Promise<ConsultantPublicProfile> {
	const response = await apiClient.get(`/api/consultants/${userId}`);
	return response.data.data ?? response.data;
}

export type ConsultantDirectoryParams = {
	category?: string;
	subcategory?: string;
	limit?: number;
	offset?: number;
};

export type ConsultantDirectoryPage = {
	items: Profile[];
	total: number;
	limit: number;
	offset: number;
};

/**
 * The paginated directory behind the marketplace category pages.
 *
 * Separate from `fetchConsultants` because that returns a bare array and three
 * call sites depend on that shape; this one carries a pagination envelope.
 */
export async function fetchConsultantDirectory(
	params: ConsultantDirectoryParams = {},
): Promise<ConsultantDirectoryPage> {
	const response = await apiClient.get("/api/consultants/directory", {
		params,
	});
	return response.data.data ?? response.data;
}

/**
 * Query key factory for consultant queries
 */
export const consultantKeys = {
	all: ["consultants"] as const,
	list: () => [...consultantKeys.all, "list"] as const,
	detail: (id: string) => [...consultantKeys.all, "detail", id] as const,
	directory: (params: ConsultantDirectoryParams) =>
		[...consultantKeys.all, "directory", params] as const,
};
