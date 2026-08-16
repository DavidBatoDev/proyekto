/**
 * Profile Query Functions
 * TanStack Query functions for fetching and managing profile data
 */

import { supabase } from "../lib/supabase";
import type { Profile } from "../types";

/**
 * Fetch user profile from Supabase
 */
export async function fetchProfile(userId: string): Promise<Profile | null> {
	const { data, error } = await supabase
		.from("profiles")
		.select("*")
		.eq("id", userId)
		.maybeSingle();

	if (error) throw error;
	return data;
}

/**
 * Query key factory for profile queries
 */
export const profileKeys = {
	all: ["profile"] as const,
	byUser: (userId: string) => ["profile", userId] as const,
};

/**
 * Update user profile
 */
export async function updateProfileData(
	userId: string,
	updates: Partial<Profile>,
): Promise<Profile | null> {
	const { data, error } = await supabase
		.from("profiles")
		.update(updates)
		.eq("id", userId)
		.select()
		.single();

	if (error) throw error;
	return data;
}
