import { useQuery } from "@tanstack/react-query";
import { getRoadmapsPreview } from "@/api";
import { useUser } from "@/stores/authStore";

/**
 * The one definition of the dashboard roadmaps-preview query
 * (`GET /api/roadmaps/preview`, the full epic/feature/task tree of every
 * accessible roadmap). It used to be copied verbatim into three files
 * (useDashboardContent, RoadmapsGrid, DashboardWidgets); the AI mention
 * picker is a fourth reader, so it lives here now.
 *
 * The key keeps the `["dashboard", "roadmaps-preview"]` prefix that
 * `invalidateDashboardRoadmaps` matches on, and adds the user id so an account
 * switch can never serve the previous user's roadmaps from cache.
 */
export function roadmapsPreviewQueryOptions(userId: string | undefined) {
	return {
		queryKey: ["dashboard", "roadmaps-preview", userId ?? "anonymous"] as const,
		queryFn: () => getRoadmapsPreview(),
		staleTime: 30_000,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retry: 1,
	};
}

export function useRoadmapsPreviewQuery(options?: { enabled?: boolean }) {
	const user = useUser();
	return useQuery({
		...roadmapsPreviewQueryOptions(user?.id),
		enabled: options?.enabled ?? true,
	});
}
