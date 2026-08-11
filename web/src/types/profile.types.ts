/**
 * Profile Types
 * Types related to user profiles
 */

import type { AppearancePreferencesV1 } from "@/theme/types";

/**
 * New rows carry only completed_at; lane is legacy data from the retired
 * signup-lane era and is never read for authorization.
 */
export interface OnboardingSettings {
	completed_at: string; // ISO timestamp
	lane?: "client_freelancer" | "client" | "talent" | "consultant";
}

// Profile settings JSONB type
export interface ProfileSettings {
	onboarding?: OnboardingSettings;
	appearance?: AppearancePreferencesV1;
	[key: string]: any; // Allow for future settings
}

export type ConsultantEnrollmentStatus =
	| "pending"
	| "verified"
	| "suspended"
	| "revoked";

export type FreelancerEnrollmentStatus = "active" | "paused";

// Profile interface
export interface Profile {
	id: string;
	email: string;
	display_name: string | null;
	avatar_url: string | null;
	banner_url: string | null;
	consultant_status: ConsultantEnrollmentStatus | null;
	freelancer_status: FreelancerEnrollmentStatus | null;
	/** Computed compatibility field for older mobile bundles. */
	is_consultant_verified: boolean;
	/** Computed compatibility field for older mobile bundles. */
	is_public: boolean;
	bio: string | null;
	headline: string | null; // short professional tagline
	first_name: string | null;
	last_name: string | null;
	is_email_verified: boolean;
	gender: string | null;
	phone_number: string | null;
	country: string | null;
	date_of_birth: string | null;
	city: string | null;
	zip_code: string | null;
	skills?: string[];
	settings: ProfileSettings;
	has_completed_onboarding: boolean;
	tutorials_completed?: Record<string, any>;
	migrated_from_guest_id: string | null;
	created_at: string;
	updated_at: string;
}

// Profile insert type (for creating new profiles)
export interface ProfileInsert {
	id: string;
	email: string;
	avatar_url?: string | null;
	banner_url?: string | null;
	bio?: string | null;
	headline?: string | null;
	first_name?: string | null;
	last_name?: string | null;
	is_email_verified?: boolean;
	gender?: string | null;
	phone_number?: string | null;
	country?: string | null;
	date_of_birth?: string | null;
	city?: string | null;
	zip_code?: string | null;
	settings?: ProfileSettings;
	has_completed_onboarding?: boolean;
}

// Profile update type (for updating existing profiles)
export interface ProfileUpdate {
	email?: string;
	display_name?: string | null;
	avatar_url?: string | null;
	banner_url?: string | null;
	bio?: string | null;
	headline?: string | null;
	first_name?: string | null;
	last_name?: string | null;
	is_email_verified?: boolean;
	gender?: string | null;
	phone_number?: string | null;
	country?: string | null;
	date_of_birth?: string | null;
	city?: string | null;
	zip_code?: string | null;
	settings?: ProfileSettings;
	has_completed_onboarding?: boolean;
	migrated_from_guest_id?: string | null;
}
