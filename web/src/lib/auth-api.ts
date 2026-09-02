/**
 * Auth API client for interacting with backend auth endpoints.
 */

import { apiClient } from "@/api";
import type { Profile, ProfileUpdateData } from "../types";

export interface CompleteOnboardingResult {
	profile: Profile;
	personal_project_id: string | null;
	personal_team_id: string | null;
	/** The organization-tier workspace, distinct from the personal project. */
	workspace_id: string | null;
}

/**
 * Complete onboarding through the server-owned path. Lane-free: the server
 * records completion and provisions the personal project. A network or
 * backend failure deliberately leaves onboarding incomplete and retryable.
 */
export async function completeOnboarding(): Promise<CompleteOnboardingResult> {
	const response = await apiClient.patch("/api/auth/onboarding/complete", {});
	return response.data;
}

export async function getProfile(): Promise<{ data: Profile }> {
	const response = await apiClient.get("/api/auth/profile");
	return response.data;
}

export async function updateProfile(
	data: ProfileUpdateData,
): Promise<{ data: Profile }> {
	const response = await apiClient.patch("/api/auth/profile", data);
	return response.data;
}
