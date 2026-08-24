import { type QueryClient, useQuery } from "@tanstack/react-query";
import { projectService } from "@/services/project.service";
import { useUser } from "@/stores/authStore";

/**
 * The one definition of the dashboard-projects query. The key is shared by
 * every surface that lists the user's projects (sidebars, project switcher,
 * inbox, global search) and by the invalidation in
 * ProjectInvitePromptManager — a drifted copy means one surface silently
 * shows stale projects, so new call sites must go through here.
 */
export function dashboardProjectsQueryOptions(userId: string | undefined) {
	return {
		queryKey: ["dashboard", "projects", userId ?? "anonymous"] as const,
		queryFn: () => projectService.listDashboardProjects(),
		enabled: Boolean(userId),
		staleTime: 30_000,
	};
}

/**
 * Invalidate the cached dashboard-projects list (prefix match covers every
 * user id). Call after any mutation that changes what the dashboard shows —
 * create/rename/status/delete/transfer/leave — especially right before
 * navigating to /dashboard, so it mounts into a refetch instead of serving
 * the pre-mutation list for the rest of the 30s staleTime.
 */
export function invalidateDashboardProjects(queryClient: QueryClient) {
	return queryClient.invalidateQueries({ queryKey: ["dashboard", "projects"] });
}

export function useDashboardProjectsQuery(options?: { enabled?: boolean }) {
	const user = useUser();
	const base = dashboardProjectsQueryOptions(user?.id);
	return useQuery({
		...base,
		enabled: base.enabled && (options?.enabled ?? true),
	});
}
