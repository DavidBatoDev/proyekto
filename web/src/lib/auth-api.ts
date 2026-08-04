/**
 * Auth API client for interacting with backend auth endpoints
 */

import axios from "axios";
import { apiClient } from "@/api";
import type { Profile, ProfileUpdateData } from "../types";
import { supabase } from "./supabase";

export type OnboardingLane = "client_freelancer" | "consultant";

export interface CompleteOnboardingResult {
	profile: Profile;
	personal_workspace_id: string | null;
	personal_team_id: string | null;
}

/**
 * Complete onboarding by setting user intent (freelancer/client/both) and
 * lane (client_freelancer | consultant). The backend persists settings and
 * provisions the lane-appropriate personal workspace or team.
 */
export async function completeOnboarding(data: {
	lane: OnboardingLane;
	intent: {
		freelancer: boolean;
		client: boolean;
	};
}): Promise<CompleteOnboardingResult> {
	try {
		const response = await apiClient.patch(
			"/api/auth/onboarding/complete",
			data,
		);
		return response.data;
	} catch (error) {
		// Allow onboarding to proceed in local/dev when backend API is temporarily unavailable.
		if (axios.isAxiosError(error) && !error.response) {
			const {
				data: { user },
				error: userError,
			} = await supabase.auth.getUser();

			if (userError) throw userError;
			if (!user) throw error;

			const { data: existingProfile, error: existingError } = await supabase
				.from("profiles")
				.select("settings")
				.eq("id", user.id)
				.single();

			if (existingError) throw existingError;

			const existingSettings =
				existingProfile &&
				typeof existingProfile.settings === "object" &&
				existingProfile.settings !== null
					? (existingProfile.settings as Record<string, unknown>)
					: {};

			const updatePayload: Record<string, unknown> = {
				has_completed_onboarding: true,
				settings: {
					...existingSettings,
					onboarding: {
						lane: data.lane,
						intent: {
							freelancer: Boolean(data.intent.freelancer),
							client: Boolean(data.intent.client),
						},
						completed_at: new Date().toISOString(),
					},
				},
			};
			const { data: profile, error: updateError } = await supabase
				.from("profiles")
				.update(updatePayload)
				.eq("id", user.id)
				.select("*")
				.single();

			if (updateError) throw updateError;

			// Best-effort fallback lookup (no provisioning in offline mode —
			// backend will retry on next online completeOnboarding call).
			// Look up the lane-appropriate artifact: workspace for clients,
			// personal team for consultants.
			let personal_workspace_id: string | null = null;
			let personal_team_id: string | null = null;

			if (data.lane === "consultant") {
				const { data: team } = await supabase
					.from("teams")
					.select("id")
					.eq("owner_id", user.id)
					.eq("is_personal", true)
					.maybeSingle();
				personal_team_id = (team?.id as string | undefined) ?? null;
			} else {
				const { data: workspace } = await supabase
					.from("projects")
					.select("id")
					.eq("client_id", user.id)
					.eq("is_personal_workspace", true)
					.maybeSingle();
				personal_workspace_id = (workspace?.id as string | undefined) ?? null;
			}

			return {
				profile: profile as Profile,
				personal_workspace_id,
				personal_team_id,
			};
		}

		throw error;
	}
}

/**
 * Get current user's profile
 */
export async function getProfile(): Promise<{ data: Profile }> {
	const response = await apiClient.get("/api/auth/profile");
	return response.data;
}

/**
 * Update user profile
 */
export async function updateProfile(
	data: ProfileUpdateData,
): Promise<{ data: Profile }> {
	const response = await apiClient.patch("/api/auth/profile", data);
	return response.data;
}
