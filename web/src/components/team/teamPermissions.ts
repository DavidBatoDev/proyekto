import type { Team, TeamMember } from "@/services/teams.service";

/**
 * May this user edit the team's identity — name, avatar, description, status —
 * and manage its resources?
 *
 * Mirrors the backend split: the owner and team admins may; plain members and
 * non-members may not. Billing and payroll fields stay owner-only and are not
 * reachable from the Overview at all, so they are not modelled here.
 *
 * Derived from the member list rather than `team.viewer_role`, deliberately.
 * `viewer_role` is documented on the `Team` type as populated by `listMyTeams`;
 * `getTeam` populates it too as of the Overview work, but the Overview already
 * has the member list on hand and deriving from data it is definitely holding
 * beats depending on which endpoint filled a field.
 */
export function canEditTeam(
	team: Team | null | undefined,
	members: TeamMember[] | undefined,
	userId: string | null | undefined,
): boolean {
	if (!team || !userId) return false;
	if (team.owner_id === userId) return true;
	return (
		members?.some(
			(member) => member.user_id === userId && member.role === "admin",
		) ?? false
	);
}

/** Whether this user is the owner — the only one who may delete or bill. */
export function isTeamOwner(
	team: Team | null | undefined,
	userId: string | null | undefined,
): boolean {
	return Boolean(team && userId && team.owner_id === userId);
}
