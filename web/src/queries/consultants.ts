import { apiClient } from "@/api";
import type { Profile } from "../types/profile.types";

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
export async function fetchConsultantProfile(userId: string): Promise<Profile> {
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
