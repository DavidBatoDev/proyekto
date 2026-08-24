import type { QueryClient } from "@tanstack/react-query";

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

/** The dashboard ROADMAPS preview (also consumed by DashboardWidgets). */
export function invalidateDashboardRoadmaps(queryClient: QueryClient) {
	return queryClient.invalidateQueries({
		queryKey: ["dashboard", "roadmaps-preview"],
	});
}
