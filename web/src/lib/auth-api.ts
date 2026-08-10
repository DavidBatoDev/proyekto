/**
 * Auth API client for interacting with backend auth endpoints.
 */

import { apiClient } from "@/api";
import type { Profile, ProfileUpdateData } from "../types";
import type { CompleteOnboardingPayload } from "./onboardingLane";

export type { OnboardingLane } from "./onboardingLane";

export interface CompleteOnboardingResult {
	profile: Profile;
	personal_workspace_id: string | null;
	personal_team_id: string | null;
}

/**
 * Complete onboarding through the server-owned identity path. A network or
 * backend failure deliberately leaves onboarding incomplete and retryable.
 */
export async function completeOnboarding(
	data: CompleteOnboardingPayload,
): Promise<CompleteOnboardingResult> {
	const response = await apiClient.patch("/api/auth/onboarding/complete", data);
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
