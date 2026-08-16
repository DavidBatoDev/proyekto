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

/**
 * Query key factory for consultant queries
 */
export const consultantKeys = {
	all: ["consultants"] as const,
	list: () => [...consultantKeys.all, "list"] as const,
	detail: (id: string) => [...consultantKeys.all, "detail", id] as const,
};
