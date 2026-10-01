/**
 * Who must name themselves before continuing, and on which pages the prompt
 * stays out of the way. Seat and contract snapshots, invites and chat all
 * show `profiles.display_name`; without it they fall back to an email.
 */

export const DISPLAY_NAME_MAX_LENGTH = 80;

/** Pages that finish signing someone in or out, or are legal/static text. */
const EXEMPT_PREFIXES = [
	"/auth",
	"/oauth",
	"/privacy",
	"/terms",
	"/goodbye",
	"/unsubscribe",
	"/not-available",
];

export interface DisplayNameProfile {
	display_name: string | null;
	first_name?: string | null;
	last_name?: string | null;
	is_guest?: boolean | null;
	deleted_at?: string | null;
}

export function needsDisplayName(
	profile: DisplayNameProfile | null | undefined,
	pathname: string,
): boolean {
	if (!profile) return false;
	if (profile.is_guest || profile.deleted_at) return false;
	if (
		EXEMPT_PREFIXES.some(
			(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
		)
	) {
		return false;
	}
	return !profile.display_name?.trim();
}

/** The prompt's starting value: the person's own first and last name, if any. */
export function suggestedDisplayName(
	profile: DisplayNameProfile | null | undefined,
): string {
	return [profile?.first_name, profile?.last_name]
		.map((part) => part?.trim())
		.filter(Boolean)
		.join(" ");
}

/** The tidied name to save, or an error to show. */
export function validateDisplayName(
	raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
	const value = raw.replace(/\s+/g, " ").trim();
	if (!value) return { ok: false, error: "Enter your name." };
	if (value.length > DISPLAY_NAME_MAX_LENGTH) {
		return {
			ok: false,
			error: `Keep it under ${DISPLAY_NAME_MAX_LENGTH} characters.`,
		};
	}
	if (value.includes("@")) {
		return { ok: false, error: "Use your name, not an email address." };
	}
	return { ok: true, value };
}
