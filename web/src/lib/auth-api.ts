/**
 * Auth API client for interacting with backend auth endpoints
 */

import axios from "axios";
import { apiClient } from "@/api";
import { supabase } from "./supabase";
import type { PersonaType, Profile, ProfileUpdateData } from "../types";

export type OnboardingLane = "client_freelancer" | "consultant";

export interface CompleteOnboardingResult {
  profile: Profile;
  personal_workspace_id: string;
}

/**
 * Complete onboarding by setting user intent (freelancer/client/both) and
 * lane (client_freelancer | consultant). The backend persists settings,
 * conditionally sets active_persona, and provisions the personal workspace.
 */
export async function completeOnboarding(data: {
  lane: OnboardingLane;
  intent: {
    freelancer: boolean;
    client: boolean;
  };
}): Promise<CompleteOnboardingResult> {
  try {
    const response = await apiClient.patch("/api/auth/onboarding/complete", data);
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
      if (data.lane === "client_freelancer") {
        updatePayload.active_persona = "client";
      }

      const { data: profile, error: updateError } = await supabase
        .from("profiles")
        .update(updatePayload)
        .eq("id", user.id)
        .select("*")
        .single();

      if (updateError) throw updateError;

      // Best-effort fallback workspace lookup (no provisioning in offline mode —
      // backend will retry on next online completeOnboarding call).
      const { data: workspace } = await supabase
        .from("projects")
        .select("id")
        .eq("client_id", user.id)
        .eq("is_personal_workspace", true)
        .maybeSingle();

      return {
        profile: profile as Profile,
        personal_workspace_id: (workspace?.id as string | undefined) ?? "",
      };
    }

    throw error;
  }
}

/**
 * Switch active persona
 */
export async function switchPersona(
  persona: PersonaType,
): Promise<{ data: Profile }> {
  try {
    const response = await apiClient.patch("/api/auth/persona", { persona });
    return response.data;
  } catch (error) {
    // Fallback for local/dev when backend API is unavailable.
    if (axios.isAxiosError(error) && !error.response) {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) throw error;

      const { data: profile, error: updateError } = await supabase
        .from("profiles")
        .update({ active_persona: persona })
        .eq("id", user.id)
        .select("*")
        .single();

      if (updateError) throw updateError;

      return { data: profile as Profile };
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
