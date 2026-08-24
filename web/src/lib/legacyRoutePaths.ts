/**
 * Old → new app paths, for URLs that moved under the `/marketplace` prefix.
 *
 * Three kinds of caller need this, and none of them are type-checked, so the
 * compiler cannot find them for us:
 *
 *  - `notifications.link_url`, authored by the backend and persisted. Rows
 *    written before the move still say `/finance/{id}?section=signatures`, and
 *    they are rendered from the inbox at click time — historical rows never
 *    age out on their own.
 *  - `proyekto_auth_continuation` and `signup_redirect`, which hold arbitrary
 *    paths in sessionStorage and only validate a leading slash. `signup_redirect`
 *    has no TTL at all, and its value can arrive fresh from an email carrying
 *    `?redirect=`, so it is a live input rather than merely stale state.
 *  - Push payloads already delivered to a device tray, which cannot be rewritten.
 *
 * The route-level redirect shims are the backstop for anything that slips past
 * this map. Mapping here simply avoids a visible bounce.
 *
 * Ordering matters: entries are matched longest-prefix-first, so a specific
 * path wins over a shorter one that is also a prefix of it.
 */

/** Longest first — `/consultant/apply` must beat `/consultant`. */
const LEGACY_PREFIXES: ReadonlyArray<readonly [string, string]> = [
	["/consultant/marketplace", "/marketplace/talent/browse"],
	["/consultant/templates", "/marketplace/consultant/templates"],
	["/consultant/browse", "/marketplace/consultant/browse"],
	["/consultant/apply", "/marketplace/consultant/apply"],
	["/marketplace/freelancer/go-live", "/marketplace/talent/go-live"],
	["/marketplace/start-selling", "/marketplace/talent"],
	["/freelancer/go-live", "/marketplace/talent/go-live"],
	["/marketplace/project-posting", "/project/new"],
	["/project-posting", "/project/new"],
	["/finance", "/marketplace/finance"],
	["/consultant", "/marketplace/consultant"],
];

/**
 * `/marketplace/talent` is deliberately absent even though it moved meaning
 * (it was the consultant-only directory, it is now the talent landing page).
 * Mapping it to `/marketplace/talent/browse` would be a PREFIX, so it would
 * also rewrite `/marketplace/talent/go-live` into
 * `/marketplace/talent/browse/go-live`. There is no legacy data needing the
 * map anyway: production holds zero `notifications.link_url` rows with that
 * path, and the backend now writes `/marketplace/talent/browse`. Anyone
 * arriving on a stale link lands on the talent hub, which is a reasonable
 * place to be.
 *
 * `/freelancer/invites` is deliberately absent: it keeps its own top-level
 * shim to `/invites`, a live database trigger still writes that exact string
 * into `notifications.link_url`, and migrations are immutable. Rewriting it
 * here would send people to a marketplace path that does not exist.
 *
 * `/freelancer/profile` is also absent — it has never been a route, and
 * NotificationBell resolves it to the viewer's own profile.
 *
 * `/contract/sign` is absent because it did not move. It is the account-free
 * client signing page, mailed as the CTA of an email to someone who may have no
 * login, and this map only runs in signed-in contexts (NotificationBell,
 * authContinuation) — rewriting it would strand exactly the person it is for.
 */
const PRESERVED = ["/freelancer/invites", "/freelancer/profile"];

/**
 * Rewrite a moved path, preserving whatever follows it — path params, a
 * trailing segment, the query string and the hash all ride along untouched.
 * Anything unrecognised is returned as-is.
 */
export function mapLegacyPath(path: string): string {
	if (!path.startsWith("/")) return path;
	if (PRESERVED.some((kept) => path === kept || path.startsWith(`${kept}/`))) {
		return path;
	}

	for (const [from, to] of LEGACY_PREFIXES) {
		if (path === from) return to;
		// Only treat it as a match at a segment or query/hash boundary, so
		// `/financial` is never mistaken for `/finance`.
		const next = path.charAt(from.length);
		if (
			path.startsWith(from) &&
			(next === "/" || next === "?" || next === "#")
		) {
			return to + path.slice(from.length);
		}
	}
	return path;
}
