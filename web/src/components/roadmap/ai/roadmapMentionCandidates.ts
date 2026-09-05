import type { AiMentionCandidate } from "@/components/ai/aiMentions";
import { NO_PROJECT_ROUTE_ID } from "@/components/ai/scope";
import type { AiMentionPick } from "@/components/ai/types";
import type { Roadmap, RoadmapEpic, RoadmapMilestone } from "@/types/roadmap";

/** Chip label while the roadmap row has not loaded yet. */
export const ROADMAP_CONTEXT_FALLBACK_LABEL = "This roadmap";
/** Chip label while the project row has not loaded yet. */
export const PROJECT_CONTEXT_FALLBACK_LABEL = "This project";

/**
 * The refs the roadmap page attaches to every message automatically: the
 * focus roadmap and, when the route has a real project (`projectId !== "n"`),
 * its project. Pure so the wrapper can memoize it; labels fall back to
 * "This roadmap" / "This project" until the rows load.
 */
export function buildRoadmapContextRefs(
	roadmapId: string,
	projectId: string,
	roadmapName: string | null | undefined,
	projectTitle: string | null | undefined,
): AiMentionPick[] {
	const hasProject = Boolean(projectId) && projectId !== NO_PROJECT_ROUTE_ID;
	const refs: AiMentionPick[] = [
		{
			kind: "roadmap",
			id: roadmapId,
			label: roadmapName?.trim() || ROADMAP_CONTEXT_FALLBACK_LABEL,
			roadmapId,
			projectId: hasProject ? projectId : null,
		},
	];
	if (hasProject) {
		refs.push({
			kind: "project",
			id: projectId,
			label: projectTitle?.trim() || PROJECT_CONTEXT_FALLBACK_LABEL,
			projectId,
		});
	}
	return refs;
}

// =============================================================================
// The roadmap panel's "primary" @-mention candidates: the focus roadmap and
// its loaded tree (epics -> features -> tasks, then milestones), position
// sorted. Built from the roadmap store by the wrapper and handed to the kit,
// which never touches the store itself.
// =============================================================================

export interface RoadmapMentionTree {
	roadmap: Roadmap | null;
	epics: RoadmapEpic[];
	milestones: RoadmapMilestone[];
}

const byPosition = <T extends { position: number }>(items: readonly T[]) =>
	[...items].sort((a, b) => a.position - b.position);

export function buildRoadmapMentionCandidates(
	roadmapId: string,
	projectId: string,
	tree: RoadmapMentionTree,
): AiMentionCandidate[] {
	const { roadmap } = tree;
	// The store is a singleton that may hold another roadmap while a run for
	// this one is still settling; only describe the tree that is really ours.
	if (!roadmap || roadmap.id !== roadmapId) return [];
	const resolvedProjectId =
		roadmap.project_id ??
		(projectId && projectId !== NO_PROJECT_ROUTE_ID ? projectId : null);
	const base = { roadmapId, projectId: resolvedProjectId };
	const roadmapName = roadmap.name?.trim() || "This roadmap";

	const out: AiMentionCandidate[] = [
		{
			kind: "roadmap",
			id: roadmap.id,
			label: roadmapName,
			secondary: "This roadmap",
			...base,
		},
	];

	for (const epic of byPosition(tree.epics)) {
		out.push({
			kind: "epic",
			id: epic.id,
			label: epic.title,
			secondary: roadmapName,
			...base,
		});
		for (const feature of byPosition(epic.features ?? [])) {
			out.push({
				kind: "feature",
				id: feature.id,
				label: feature.title,
				secondary: epic.title,
				...base,
			});
			for (const task of byPosition(feature.tasks ?? [])) {
				out.push({
					kind: "task",
					id: task.id,
					label: task.title,
					secondary: feature.title,
					...base,
				});
			}
		}
	}

	for (const milestone of byPosition(tree.milestones)) {
		out.push({
			kind: "milestone",
			id: milestone.id,
			label: milestone.title,
			secondary: roadmapName,
			...base,
		});
	}

	return out;
}
