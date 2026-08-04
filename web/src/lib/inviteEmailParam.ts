/**
 * The `?email=` parameter on the signup route, as sent by a mention-invite email.
 *
 * Lives outside `src/routes` so it can be tested as a plain function — the route
 * directory is scanned by the TanStack Router plugin, which warns about any file
 * there that is not a route.
 *
 * Validated rather than cast, because this value is rendered into a form field
 * and persisted to sessionStorage, and it arrives from a URL anyone can
 * construct. It is also NOT a credential: reconciliation keys on the address the
 * person actually verifies at signup, never on this parameter — so the only job
 * here is to refuse anything that is not plausibly an address.
 */

/** RFC 5321 maximum for a forward path. */
const MAX_LENGTH = 254;

const SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function parseInviteEmailParam(raw: unknown): string | undefined {
	if (typeof raw !== "string") return undefined;
	if (raw.length === 0 || raw.length > MAX_LENGTH) return undefined;
	return SHAPE.test(raw) ? raw : undefined;
}
