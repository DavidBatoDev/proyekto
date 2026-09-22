/**
 * The one read the usage page needs beyond EntitlementsService: which of a
 * handful of roadmaps the viewer may open. Workspace membership is not project
 * access, so the usage payload names a roadmap only when this says yes.
 */

export const WORKSPACE_USAGE_REPOSITORY = Symbol('WORKSPACE_USAGE_REPOSITORY');

export interface WorkspaceUsageRepository {
  /**
   * The subset of `roadmapIds` the user can view, by public.can_view_roadmap
   * (owner, project access, or a roadmap share). Fails closed: an id whose
   * check errors is left out, never assumed visible.
   */
  filterViewableRoadmapIds(
    userId: string,
    roadmapIds: string[],
  ): Promise<Set<string>>;
}
