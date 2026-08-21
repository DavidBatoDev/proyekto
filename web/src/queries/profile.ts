/**
 * Profile Query Functions
 * TanStack Query functions for fetching and managing profile data
 */

import {
	attachMarketplaceEnrollmentFields,
	PROFILE_WITH_ENROLLMENT_SELECT,
} from "../lib/marketplace-enrollment";
import { supabase } from "../lib/supabase";
import type { Profile } from "../types";

/**
 * Fetch user profile from Supabase.
 *
 * Selects the enrollment embeds and derives `consultant_status`,
 * `talent_status`, `is_consultant_verified`, and `is_public` — those are
 * not columns, so a plain `select("*")` returns them as `undefined` and every
 * capability gate (`isActiveConsultant`, the Finance nav item, the /finance
 * page) fails closed for users who genuinely hold the capability.
 */
export async function fetchProfile(userId: string): Promise<Profile | null> {
	const { data, error } = await supabase
		.from("profiles")
		.select(PROFILE_WITH_ENROLLMENT_SELECT)
		.eq("id", userId)
		.maybeSingle();

	if (error) throw error;
	if (!data) return null;
	return attachMarketplaceEnrollmentFields(data) as unknown as Profile;
}

/**
 * Query key factory for profile queries
 */
export const profileKeys = {
	all: ["profile"] as const,
	byUser: (userId: string) => ["profile", userId] as const,
};

/**
 * Update user profile.
 *
 * Re-selects the same embeds as `fetchProfile`: the returned row is written
 * straight into the profile cache, so selecting without them would wipe the
 * derived enrollment fields on every profile edit.
 */
export async function updateProfileData(
	userId: string,
	updates: Partial<Profile>,
): Promise<Profile | null> {
	const { data, error } = await supabase
		.from("profiles")
		.update(updates)
		.eq("id", userId)
		.select(PROFILE_WITH_ENROLLMENT_SELECT)
		.single();

	if (error) throw error;
	if (!data) return null;
	return attachMarketplaceEnrollmentFields(data) as unknown as Profile;
}
