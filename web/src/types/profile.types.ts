/**
 * Profile Types
 * Types related to user profiles
 */

import type { AppearancePreferencesV1 } from "@/theme/types";

// Persona enum
export type PersonaType = "client" | "freelancer" | "consultant" | "admin";

// Onboarding intent type
export interface OnboardingIntent {
	freelancer: boolean;
	client: boolean;
}

// Onboarding settings type
export interface OnboardingSettings {
	intent: OnboardingIntent;
	completed_at: string; // ISO timestamp
}

// Profile settings JSONB type
export interface ProfileSettings {
	onboarding?: OnboardingSettings;
	appearance?: AppearancePreferencesV1;
	[key: string]: any; // Allow for future settings
}

// Profile interface
export interface Profile {
	id: string;
	email: string;
	display_name: string | null;
	avatar_url: string | null;
	banner_url: string | null;
	is_consultant_verified: boolean;
	is_public: boolean;
	active_persona: PersonaType;
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
	is_consultant_verified?: boolean;
	active_persona?: PersonaType;
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
	is_consultant_verified?: boolean;
	active_persona?: PersonaType;
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
