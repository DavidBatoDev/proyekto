import type { QueryClient } from "@tanstack/react-query";
import { projectKeys } from "@/queries/project";
import { teamKeys } from "@/queries/teams";

/**
 * Invalidation helpers for the dashboard's TEAMS and ROADMAPS sections,
 * companions to invalidateDashboardProjects in useDashboardProjectsQuery.ts.
 * Call after any mutation that changes what those sections show — otherwise
 * the 30s staleTime serves the pre-mutation list when the user navigates
 * back to /dashboard.
 */

/**
 * The user's team list (["teams", "mine", userId] — dashboard TEAMS cards,
 * left-rail team group, project team pickers) plus their pending invites.
 */
export function invalidateMyTeams(queryClient: QueryClient) {
	return Promise.all([
		queryClient.invalidateQueries({ queryKey: ["teams", "mine"] }),
		queryClient.invalidateQueries({ queryKey: ["teams", "my-invites"] }),
	]);
}

/**
 * Every cache holding this team's row, across BOTH key families.
 *
 * The `["teams", ...]` prefix covers the detail, member, project, invite and
 * list queries. It does NOT cover `["team", teamId]`, which the time subtree,
 * `useProjectRoster` and `ProjectHeader` read — that omission is why renaming
 * a team used to leave the old name showing on `/teams/:id/time/*` until the
 * query went stale on its own.
 *
 * Use this for any write that changes the team row itself (name, avatar,
 * description, status). Writes that touch only a sub-collection should
 * invalidate that collection's key instead: invalidating the whole `["teams"]`
 * prefix refetches one curated-members query per attached project, which on a
 * team with a dozen projects is a lot of network for a renamed link.
 */
export function invalidateTeamEverywhere(
	queryClient: QueryClient,
	teamId: string,
) {
	return Promise.all([
		queryClient.invalidateQueries({ queryKey: teamKeys.all }),
		// A prefix of ["team", id, "members"] and the rest of Family B.
		queryClient.invalidateQueries({ queryKey: teamKeys.legacyDetail(teamId) }),
	]);
}

/** The dashboard ROADMAPS preview (also consumed by DashboardWidgets). */
export function invalidateDashboardRoadmaps(queryClient: QueryClient) {
	return queryClient.invalidateQueries({
		queryKey: ["dashboard", "roadmaps-preview"],
	});
}

/**
 * The project → roadmap link (["project", "linked-roadmap", projectId]), read
 * by the project layout, overview, timeline, work-items and the roadmap tab's
 * empty state. Every door that creates a roadmap *for* a project must call
 * this, or the layout keeps `linkedRoadmapId = null` for the query's 60s
 * staleTime and the sidebar does not know the roadmap exists yet.
 *
 * `"n"` is the no-project sentinel: nothing to invalidate.
 */
export function invalidateProjectLinkedRoadmap(
	queryClient: QueryClient,
	projectId: string | null | undefined,
) {
	if (!projectId || projectId === "n") return Promise.resolve();
	return queryClient.invalidateQueries({
		queryKey: projectKeys.linkedRoadmap(projectId),
	});
}
