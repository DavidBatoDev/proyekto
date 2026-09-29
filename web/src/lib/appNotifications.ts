import { mapLegacyPath } from "@/lib/legacyRoutePaths";
import { isVisibleInApp } from "@/lib/platformSurfaces";

/**
 * Notification types that only make sense with the marketplace, which the
 * installed app does not carry. Listed by type because some of them link to
 * an app page (`marketplace_profile_live` resolves to the profile) and would
 * otherwise slip past the link check below.
 */
const MARKETPLACE_ONLY_TYPES: ReadonlySet<string> = new Set([
	"marketplace_profile_live",
]);

interface NotificationLike {
	type?: { name?: string | null } | null;
	link_url?: string | null;
}

/**
 * Whether a notification row is listed in the installed app.
 *
 * The root route gate already stops a tap from opening a marketplace or
 * commerce page, but a row that can only bounce to "not available" still
 * advertises a surface the app does not have. So on native, rows about the
 * marketplace — by type, or by where they link — are not listed at all.
 * Rows with no link, or a link that is not an in-app path, are kept.
 * Always true in a browser.
 */
export function isNotificationShownInApp(
	notification: NotificationLike,
	isNative: boolean,
): boolean {
	if (!isNative) return true;
	const typeName = notification.type?.name;
	if (typeName && MARKETPLACE_ONLY_TYPES.has(typeName)) return false;
	const link = notification.link_url;
	if (!link?.startsWith("/")) return true;
	return isVisibleInApp(mapLegacyPath(link), isNative);
}
