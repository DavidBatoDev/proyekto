import { openProjectInviteModal } from "@/components/invites/projectInviteModalEvents";
import { mapLegacyPath } from "@/lib/legacyRoutePaths";
import type { NotificationItem } from "@/services/notifications.service";

/**
 * Follows a notification to where it points. Shared by the header bell and
 * the /notifications page so both open the same place. Returns false when the
 * notification has nowhere to go.
 */
export function openNotificationTarget(
	notification: Pick<NotificationItem, "link_url" | "content" | "type">,
	profileId?: string | null,
): boolean {
	const inviteId = notification.content?.invite_id;
	if (
		notification.type?.name === "project_invite_received" &&
		typeof inviteId === "string" &&
		inviteId
	) {
		openProjectInviteModal(inviteId);
		return true;
	}

	const linkUrl = notification.link_url;
	if (!linkUrl) return false;
	// link_url is backend-authored and persisted, so historical rows still
	// carry pre-/marketplace paths; mapLegacyPath rewrites them without a
	// visible bounce through the route shim.
	window.location.href =
		linkUrl === "/freelancer/profile" && profileId
			? `/profile/${profileId}`
			: mapLegacyPath(linkUrl);
	return true;
}
