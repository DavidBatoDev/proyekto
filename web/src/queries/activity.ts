import {
	activityService,
	type ActivityFilters,
	type ActivityPage,
} from "@/services/activity.service";

export const activityKeys = {
	all: ["activity"] as const,
	feed: (projectId: string, filters: ActivityFilters) =>
		["activity", "feed", projectId, filters] as const,
};

export function fetchProjectActivity(
	projectId: string,
	filters: ActivityFilters,
	cursor?: string,
): Promise<ActivityPage> {
	return activityService.list(projectId, { ...filters, cursor });
}
