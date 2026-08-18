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
export interface ConsultantPublicProfile extends Profile {
	consultant_verified_at: string | null;
	expertise: ConsultantExpertise[];
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
