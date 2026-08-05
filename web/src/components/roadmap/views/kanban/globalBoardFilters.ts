import type { FullRoadmapWithProject } from "@/services/roadmap.service";
import type { KanbanTaskContext } from "./types";

/**
 * Pure filter logic for the Command Center board. Kept free of component and
 * service imports so it stays directly testable.
 */

export interface GlobalBoardFilters {
	projectId: string | null;
	epicId: string | null;
	featureId: string | null;
	assigneeIds: string[];
}

export const EMPTY_FILTERS: GlobalBoardFilters = {
	projectId: null,
	epicId: null,
	featureId: null,
	assigneeIds: [],
};

export const GLOBAL_FILTERS_KEY = "wi_global_filters";

export function loadGlobalFilters(): GlobalBoardFilters {
	try {
		const raw = sessionStorage.getItem(GLOBAL_FILTERS_KEY);
		if (raw) {
			const stored = JSON.parse(raw) as Partial<GlobalBoardFilters>;
			return {
				...EMPTY_FILTERS,
				projectId: stored.projectId ?? null,
				epicId: stored.epicId ?? null,
				featureId: stored.featureId ?? null,
				assigneeIds: stored.assigneeIds ?? [],
			};
		}
	} catch {}
	return { ...EMPTY_FILTERS };
}

/**
 * The project the board opens on: the one owning the most recently updated
 * roadmap. Returns null only when no roadmap belongs to a project (guest or
 * unassigned roadmaps), in which case the board stays unscoped.
 */
export function pickDefaultProjectId(
	roadmaps: FullRoadmapWithProject[],
): string | null {
	let bestId: string | null = null;
	let bestAt = -1;
	for (const roadmap of roadmaps) {
		const projectId = roadmap.project?.id;
		if (!projectId) continue;
		const updatedAt = Date.parse(roadmap.updated_at ?? "") || 0;
		if (!bestId || updatedAt > bestAt) {
			bestId = projectId;
			bestAt = updatedAt;
		}
	}
	return bestId;
}

/**
 * The Projects row has no "All" option, so a persisted null — or a project the
 * user no longer has access to — resolves to the default project. Done during
 * render rather than in an effect, which would flash an unscoped board frame.
 */
export function resolveFilters(
	filters: GlobalBoardFilters,
	roadmaps: FullRoadmapWithProject[],
): GlobalBoardFilters {
	const isValid =
		!!filters.projectId &&
		roadmaps.some((r) => r.project?.id === filters.projectId);
	if (isValid) return filters;
	// A stored epic/feature belongs to the project that just got replaced.
	return {
		...filters,
		projectId: pickDefaultProjectId(roadmaps),
		epicId: null,
		featureId: null,
	};
}

export function applyFilters(
	rows: KanbanTaskContext[],
	filters: GlobalBoardFilters,
): KanbanTaskContext[] {
	return rows.filter((row) => {
		if (filters.projectId && row.project?.id !== filters.projectId)
			return false;
		if (filters.epicId && row.epic.id !== filters.epicId) return false;
		if (filters.featureId && row.feature.id !== filters.featureId) return false;
		if (filters.assigneeIds.length) {
			const aid = row.task.assignee_id ?? null;
			if (!aid || !filters.assigneeIds.includes(aid)) return false;
		}
		return true;
	});
}

// Free-text search over task cards: matches the task title and its parent
// feature title. (Epic searching lives on the left filter row instead.)
export function applySearch(
	rows: KanbanTaskContext[],
	query: string,
): KanbanTaskContext[] {
	const q = query.trim().toLowerCase();
	if (!q) return rows;
	return rows.filter(
		(row) =>
			row.task.title.toLowerCase().includes(q) ||
			row.feature.title.toLowerCase().includes(q),
	);
}
