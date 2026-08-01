import { useInfiniteQuery } from "@tanstack/react-query";
import { activityKeys, fetchProjectActivity } from "@/queries/activity";
import type { ActivityFilters } from "@/services/activity.service";

/**
 * The project activity feed.
 *
 * `refetchOnWindowFocus` is deliberate rather than incidental: the feed orders
 * by event time, so a row whose write flushed slowly lands mid-list rather
 * than at the top. Refetching page 1 on focus bounds how long a returning user
 * can be looking at a list that is missing it.
 */
export function useProjectActivityQuery(
	projectId: string,
	filters: ActivityFilters,
) {
	return useInfiniteQuery({
		queryKey: activityKeys.feed(projectId, filters),
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) =>
			fetchProjectActivity(projectId, filters, pageParam),
		getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
		enabled: Boolean(projectId),
		staleTime: 30_000,
		refetchOnWindowFocus: true,
	});
}
