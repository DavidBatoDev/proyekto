/**
 * The `?inviteId=` parameter on `/invites`, as sent by an invitation email.
 *
 * Lives outside `src/routes` so it can be tested as a plain function — the
 * route directory is scanned by the TanStack Router plugin, which warns about
 * any file there that is not a route. Same reason as `inviteEmailParam.ts`.
 *
 * It is a POINTER, not a credential. It only decides which card the page
 * highlights and scrolls to; responding to an invite still requires the session
 * and a server-side check that the invite belongs to the caller. So the job
 * here is narrow: refuse anything that is not shaped like an id, so a junk or
 * hostile value never reaches a DOM lookup or gets echoed back into a URL.
 */

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseInviteIdParam(raw: unknown): string | undefined {
	if (typeof raw !== "string") return undefined;
	return UUID_RE.test(raw) ? raw : undefined;
}
