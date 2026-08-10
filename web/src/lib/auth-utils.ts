/**
 * Auth utility functions
 */

import type { Profile } from "../types/profile.types";

export function isConsultant(profile: Profile | null | undefined): boolean {
	return profile?.role === "consultant";
}

export function isClient(profile: Profile | null | undefined): boolean {
	return profile?.role === "client";
}

export function isTalent(profile: Profile | null | undefined): boolean {
	return profile?.role === "talent";
}

/** Check whether consultant identity and vetting grant the capability. */
export function isActiveConsultant(
	profile: Profile | null | undefined,
): boolean {
	return isConsultant(profile) && profile?.is_consultant_verified === true;
}

/** @deprecated Use isActiveConsultant. */
export function isVerifiedConsultant(
	profile: Profile | null | undefined,
): boolean {
	return isActiveConsultant(profile);
}

/** Get the display name or fall back to the email prefix. */
export function getDisplayName(
	profile: Profile | null,
	email?: string,
): string {
	if (profile?.display_name) {
		return profile.display_name;
	}

	if (email) {
		return email.split("@")[0];
	}

	return "User";
}

/**
 * Get avatar URL or initials
 */
export function getAvatarDisplay(profile: Profile | null): {
	type: "url" | "initials";
	value: string;
} {
	if (profile?.avatar_url) {
		return { type: "url", value: profile.avatar_url };
	}

	const name = profile?.display_name || profile?.email || "U";
	const initials = name
		.split(" ")
		.map((part) => part[0])
		.join("")
		.toUpperCase()
		.slice(0, 2);

	return { type: "initials", value: initials };
}

/** Validate an email address. */
export function isValidEmail(email: string): boolean {
	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	return emailRegex.test(email);
}

/**
 * Validate password strength
 */
export function validatePassword(password: string): {
	isValid: boolean;
	errors: string[];
} {
	const errors: string[] = [];

	if (password.length < 8) {
		errors.push("Password must be at least 8 characters long");
	}

	if (!/[A-Z]/.test(password)) {
		errors.push("Password must contain at least one uppercase letter");
	}

	if (!/[a-z]/.test(password)) {
		errors.push("Password must contain at least one lowercase letter");
	}

	if (!/[0-9]/.test(password)) {
		errors.push("Password must contain at least one number");
	}

	return {
		isValid: errors.length === 0,
		errors,
	};
}

/** Check whether the required basic profile fields are present. */
export function isProfileComplete(profile: Profile | null): boolean {
	if (!profile) return false;

	return !!(profile.display_name && profile.email);
}

/**
 * Get profile completion percentage
 */
export function getProfileCompletion(profile: Profile | null): number {
	if (!profile) return 0;

	const fields = [profile.display_name, profile.avatar_url, profile.bio];

	const completedFields = fields.filter(Boolean).length;
	return Math.round((completedFields / fields.length) * 100);
}
