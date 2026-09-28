/**
 * The node counts of a full roadmap tree, as the per-roadmap plan limit and
 * the commit logs measure them.
 *
 * Structural rather than FullRoadmapState so it also takes the raw `findFull`
 * payload the JSON-patch path reads before normalizing. Milestones are not
 * nodes: they match `ai_context_roadmap_counts` (epics + features + tasks),
 * which is what the live count behind the same limit uses.
 */
export interface RoadmapNodeTree {
  roadmap_epics?: Array<{
    roadmap_features?: Array<{
      roadmap_tasks?: readonly unknown[] | null;
    }> | null;
  }> | null;
}

export interface RoadmapNodeCounts {
  epics: number;
  features: number;
  tasks: number;
}

export function countRoadmapNodes(state: RoadmapNodeTree): RoadmapNodeCounts {
  const epics = state.roadmap_epics?.length ?? 0;
  const features = (state.roadmap_epics ?? []).reduce(
    (count, epic) => count + (epic.roadmap_features?.length ?? 0),
    0,
  );
  const tasks = (state.roadmap_epics ?? []).reduce(
    (count, epic) =>
      count +
      (epic.roadmap_features ?? []).reduce(
        (featureCount, feature) =>
          featureCount + (feature.roadmap_tasks?.length ?? 0),
        0,
      ),
    0,
  );
  return { epics, features, tasks };
}

/** epics + features + tasks: the number the per-roadmap node limit compares. */
export function totalRoadmapNodes(state: RoadmapNodeTree): number {
  const { epics, features, tasks } = countRoadmapNodes(state);
  return epics + features + tasks;
}
