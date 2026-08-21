/**
 * Client-side derivation of marketplace enrollment fields.
 *
 * `profiles.consultant_status`, `talent_status`, `is_consultant_verified`,
 * and `is_public` are NOT columns — they were dropped by
 * `20260812101000_retire_profile_capability_flags.sql`. The enrollment tables
 * are the only source of truth, and these four are derived on read.
 *
 * The backend derives them in `backend/src/common/auth/consultant-capability.ts`
 * for `GET /api/auth/profile`. This module is the browser's mirror of that
 * logic, used because the app hydrates profiles straight from Supabase rather
 * than through the API. Keep the two in step: the status literals below must
 * match `ConsultantEnrollmentStatus` / `TalentEnrollmentStatus`.
 *
 * Reading the embeds from the browser is RLS-safe — `consultant_profiles` and
 * `talent_profiles` both allow `auth.uid() = user_id` on SELECT, so a user
 * can always see their own enrollment.
 */

import type {
	ConsultantEnrollmentStatus,
	TalentEnrollmentStatus,
} from "@/types/profile.types";

/**
 * Select fragment that hydrates the embeds this module reads. Every query whose
 * result reaches the profile cache must use it, or the derived fields silently
 * become `undefined` and every capability gate fails closed.
 *
 * The `!consultant_profiles_user_id_fkey` hint is required, not decorative:
 * `consultant_profiles` has two foreign keys to `profiles` (`user_id` and
 * `status_changed_by`), so an unhinted embed is ambiguous and PostgREST refuses
 * the whole query. `talent_profiles` has only `user_id`, so it needs none.
 * This matches the embeds the backend uses in
 * `common/auth/consultant-capability.ts` consumers.
 */
export const PROFILE_WITH_ENROLLMENT_SELECT =
	"*, consultant_profile:consultant_profiles!consultant_profiles_user_id_fkey(status), talent_profile:talent_profiles(status)";

interface EnrollmentStatusRow<TStatus extends string> {
	status?: TStatus | null;
}

/** PostgREST returns an embed as an object or a single-element array. */
function relationRow<T>(value: unknown): T | null {
	if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
	if (value && typeof value === "object") return value as T;
	return null;
}

export function consultantStatusFromEmbed(
	value: unknown,
): ConsultantEnrollmentStatus | null {
	const status =
		relationRow<EnrollmentStatusRow<ConsultantEnrollmentStatus>>(value)?.status;
	return status === "pending" ||
		status === "verified" ||
		status === "suspended" ||
		status === "revoked"
		? status
		: null;
}

export function talentStatusFromEmbed(
	value: unknown,
): TalentEnrollmentStatus | null {
	const status =
		relationRow<EnrollmentStatusRow<TalentEnrollmentStatus>>(value)?.status;
	return status === "active" || status === "paused" ? status : null;
}

export interface MarketplaceEnrollmentFields {
	consultant_status: ConsultantEnrollmentStatus | null;
	talent_status: TalentEnrollmentStatus | null;
	is_consultant_verified: boolean;
	is_public: boolean;
}

/**
 * Replace the raw embeds with the four derived fields the app gates on. The
 * embeds are dropped so nothing downstream starts depending on their shape.
 */
export function attachMarketplaceEnrollmentFields<T extends object>(
	profile: T,
): T & MarketplaceEnrollmentFields {
	const record = profile as Record<string, unknown>;
	const consultantStatus = consultantStatusFromEmbed(record.consultant_profile);
	const freelancerStatus = talentStatusFromEmbed(record.talent_profile);
	const profileFields = { ...record };
	delete profileFields.consultant_profile;
	delete profileFields.talent_profile;

	return {
		...profileFields,
		consultant_status: consultantStatus,
		talent_status: freelancerStatus,
		is_consultant_verified: consultantStatus === "verified",
		is_public: freelancerStatus === "active",
	} as T & MarketplaceEnrollmentFields;
}
