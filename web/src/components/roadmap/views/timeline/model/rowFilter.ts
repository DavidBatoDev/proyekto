import type { RoadmapEpic, RoadmapFeature } from "@/types/roadmap";
import type { TimelineFilters } from "../components/TimelineFilterMenu";
import { countActiveFilters } from "../components/TimelineFilterMenu";

interface BuildMatchedRowKeysParams {
	epics: RoadmapEpic[];
	query: string;
	filters: TimelineFilters;
}

/**
 * The row keys the search box and filter menu leave visible, or `null` when
 * nothing is filtering and every row should show.
 *
 * An epic is kept whenever any of its features match, so a matching feature is
 * never orphaned from its parent.
 *
 * Shared by the desktop and mobile timelines so the two can never drift on what
 * "matches" means.
 */
export function buildMatchedRowKeys({
	epics,
	query,
	filters,
}: BuildMatchedRowKeysParams): Set<string> | null {
	const trimmed = query.trim().toLowerCase();
	if (!trimmed && countActiveFilters(filters) === 0) return null;

	const featureMatches = (feature: RoadmapFeature): boolean => {
		if (trimmed && !feature.title.toLowerCase().includes(trimmed)) {
			return false;
		}
		if (filters.statuses.size > 0 && !filters.statuses.has(feature.status)) {
			return false;
		}
		if (filters.assigneeIds.size > 0) {
			const ids = feature.assignees?.map((assignee) => assignee.id) ?? [];
			if (!ids.some((id) => filters.assigneeIds.has(id))) return false;
		}
		if (filters.schedule !== "all") {
			const isScheduled = Boolean(feature.start_date && feature.end_date);
			if (filters.schedule === "scheduled" && !isScheduled) return false;
			if (filters.schedule === "unscheduled" && isScheduled) return false;
		}
		return true;
	};

	const keys = new Set<string>();
	for (const epic of epics) {
		const matchingFeatures = (epic.features ?? []).filter(featureMatches);
		for (const feature of matchingFeatures) {
			keys.add(`feature:${feature.id}`);
		}

		// The epic row itself only stands alone when nothing but a text query
		// is in play — a status/assignee filter is about features.
		const epicMatchesQuery =
			Boolean(trimmed) && epic.title.toLowerCase().includes(trimmed);
		if (matchingFeatures.length > 0 || epicMatchesQuery) {
			keys.add(`epic:${epic.id}`);
		}
	}
	return keys;
}
