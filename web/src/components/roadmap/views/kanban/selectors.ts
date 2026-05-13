import type {
	RoadmapEpic,
	RoadmapMilestone,
} from "@/types/roadmap";
import type { KanbanBoardFilters } from "@/stores/roadmapStore";
import type { KanbanTaskContext } from "./types";

/**
 * Flatten epics → features → tasks into a list enriched with epic / feature /
 * milestone context. Derived purely from store state; no fetch.
 */
export function selectAllTasksWithContext(
	epics: RoadmapEpic[],
	milestones: RoadmapMilestone[],
): KanbanTaskContext[] {
	const milestoneByFeatureId = new Map<string, RoadmapMilestone>();
	for (const milestone of milestones) {
		for (const feature of milestone.linked_features ?? []) {
			milestoneByFeatureId.set(feature.id, milestone);
		}
	}

	const result: KanbanTaskContext[] = [];
	for (const epic of epics) {
		for (const feature of epic.features ?? []) {
			const milestone = milestoneByFeatureId.get(feature.id) ?? null;
			for (const task of feature.tasks ?? []) {
				result.push({ task, feature, epic, milestone });
			}
		}
	}
	return result;
}

export function applyBoardFilters(
	rows: KanbanTaskContext[],
	filters: KanbanBoardFilters,
): KanbanTaskContext[] {
	const { epicIds, milestoneIds, assigneeIds } = filters;
	if (!epicIds.length && !milestoneIds.length && !assigneeIds.length) {
		return rows;
	}
	return rows.filter((row) => {
		if (epicIds.length && !epicIds.includes(row.epic.id)) return false;
		if (milestoneIds.length) {
			const milestoneId = row.milestone?.id ?? null;
			if (!milestoneId || !milestoneIds.includes(milestoneId)) return false;
		}
		if (assigneeIds.length) {
			const assigneeId = row.task.assignee_id ?? null;
			if (!assigneeId || !assigneeIds.includes(assigneeId)) return false;
		}
		return true;
	});
}
