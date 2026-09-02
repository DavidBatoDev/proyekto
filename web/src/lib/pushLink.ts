import { mapLegacyPath } from "@/lib/legacyRoutePaths";

export const PUSH_FALLBACK_PATH = "/notifications";

/**
 * Where a tapped push notification should take the app.
 *
 * The backend sends `link_url` as an in-app path, and an old notification can
 * carry a path from any earlier URL scheme, so the link is treated exactly the
 * way the notification bell treats a persisted one: run through the legacy
 * map, never trusted to be anything but a path. Bare organizational paths
 * (`/dashboard`, `/teams/<id>/…`) need no mapping — they are real routes that
 * redirect to their workspace-scoped twin.
 *
 * An absolute URL is reduced to its path (a stray origin must not send the
 * WebView off to a website, and a `javascript:` or other non-path value is
 * dropped). Anything unusable falls back to the notifications list.
 */
export function resolvePushLink(link: string | undefined | null): string {
	if (!link) return PUSH_FALLBACK_PATH;
	let path = link.trim();

	if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
		try {
			const url = new URL(path);
			if (url.protocol !== "http:" && url.protocol !== "https:") {
				return PUSH_FALLBACK_PATH;
			}
			path = `${url.pathname}${url.search}${url.hash}`;
		} catch {
			return PUSH_FALLBACK_PATH;
		}
	}

	if (!path.startsWith("/") || path.startsWith("//")) return PUSH_FALLBACK_PATH;
	return mapLegacyPath(path);
}
