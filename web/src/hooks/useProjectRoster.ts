import { useQueries, useQuery } from "@tanstack/react-query";
import {
	listCuratedMembers,
	listProjectTeams,
	listTeamMembers,
	type TeamMember,
} from "@/services/teams.service";

/** One person actually participating in the project, and the team they came via. */
export interface ProjectRosterRow {
	teamId: string;
	member: TeamMember;
}

/**
 * The members actually ADDED to this project, across every attached team.
 *
 * A team's roster can be large, but only the curated participants take part —
 * so anything that pays or budgets people (rate calculator, hour caps, the
 * budget split) must scope to this intersection, not the whole roster.
 *
 * Previously duplicated inline on the Time settings page; the Financials budget
 * panel needs the identical set, and two copies would drift.
 */
export function useProjectRoster(projectId: string, enabled = true) {
	const teamsQuery = useQuery({
		queryKey: ["project", projectId, "teams"],
		queryFn: () => listProjectTeams(projectId),
		enabled,
	});
	const teams = teamsQuery.data ?? [];

	// Full roster of each attached team — carries position and avatar.
	const memberQueries = useQueries({
		queries: teams.map((t) => ({
			queryKey: ["team", t.team_id, "members"] as const,
			queryFn: () => listTeamMembers(t.team_id),
			enabled,
		})),
	});
	const curatedQueries = useQueries({
		queries: teams.map((t) => ({
			queryKey: ["project", projectId, "teams", t.team_id, "curated"] as const,
			queryFn: () => listCuratedMembers(projectId, t.team_id),
			enabled,
		})),
	});

	const rows: ProjectRosterRow[] = teams.flatMap((t, i) => {
		const curatedIds = new Set(
			(curatedQueries[i]?.data ?? []).map((m) => m.user_id),
		);
		return (memberQueries[i]?.data ?? [])
			.filter((member) => curatedIds.has(member.user_id))
			.map((member) => ({ teamId: t.team_id, member }));
	});

	return {
		rows,
		isPending:
			teamsQuery.isPending ||
			memberQueries.some((q) => q.isPending) ||
			curatedQueries.some((q) => q.isPending),
	};
}

/** Display name for a roster member, falling back through the usual chain. */
export function rosterMemberLabel(m: TeamMember): string {
	const composed = [m.user?.first_name, m.user?.last_name]
		.filter(Boolean)
		.join(" ")
		.trim();
	return m.user?.display_name || composed || m.user?.email || m.user_id;
}
