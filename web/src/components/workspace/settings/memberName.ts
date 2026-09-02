import type { WorkspaceMember } from "@/services/workspaces.service";

/** Display name with the same fallback chain the rest of the app uses. */
export function workspaceMemberName(member: WorkspaceMember): string {
	const user = member.user;
	if (!user) return "Unknown member";
	return (
		user.display_name ||
		[user.first_name, user.last_name].filter(Boolean).join(" ") ||
		user.email?.split("@")[0] ||
		"Unknown member"
	);
}
