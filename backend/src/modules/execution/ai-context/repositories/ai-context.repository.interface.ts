import type {
  AiContextNodeKind,
  AiContextRoadmapCountsDto,
} from '../dto/ai-context.dto';

export const AI_CONTEXT_REPOSITORY = Symbol('AI_CONTEXT_REPOSITORY');

/** One row of `ai_context_search_nodes`. */
export interface AiContextNodeSearchRow {
  id: string;
  kind: AiContextNodeKind;
  title: string;
  status: string | null;
  roadmap_id: string;
  epic_id: string | null;
  feature_id: string | null;
  parent_title: string | null;
  rank: number;
  updated_at: string | null;
}

/** One row of `ai_context_list_tasks`. */
export interface AiContextTaskRow {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  due_date: string | null;
  updated_at: string | null;
  feature_id: string;
  feature_title: string | null;
  epic_id: string | null;
  epic_title: string | null;
  roadmap_id: string;
  assignee_ids: string[];
}

export interface AiContextListTasksParams {
  roadmapIds: string[];
  assignee: string | null;
  /** null = every status. */
  statuses: string[] | null;
  dueFrom: string | null;
  dueTo: string | null;
  overdueAt: string | null;
  limit: number;
}

export interface AiContextSearchNodesParams {
  roadmapIds: string[];
  /** Already sanitized (see `AiContextService.sanitizeQuery`); never empty. */
  query: string;
  kinds: AiContextNodeKind[];
  limit: number;
}

export interface AiContextChangeHistoryRow {
  change_id: string;
  roadmap_id: string;
  project_id: string | null;
  status: string;
  operations_count: number;
  semantic_change_count: number;
  revision_token_after: string | null;
  committed_at: string;
  run_id: string | null;
  session_id: string | null;
}

export interface AiContextListChangesParams {
  actorId: string;
  runId?: string;
  sessionId?: string;
  limit: number;
}

// resolve-refs batch loads --------------------------------------------------

export interface AiContextRefTaskRow {
  id: string;
  title: string;
  status: string | null;
  feature: {
    id: string;
    title: string;
    roadmap_id: string;
    epic_id: string | null;
    epic: { id: string; title: string } | null;
  } | null;
}

export interface AiContextRefFeatureRow {
  id: string;
  title: string;
  status: string | null;
  roadmap_id: string;
  epic_id: string | null;
  epic: { id: string; title: string } | null;
}

export interface AiContextRefEpicRow {
  id: string;
  title: string;
  status: string | null;
  roadmap_id: string;
}

export interface AiContextRefMilestoneRow {
  id: string;
  title: string;
  status: string | null;
  roadmap_id: string;
}

export interface AiContextRefRoadmapRow {
  id: string;
  name: string;
  status: string | null;
  project_id: string | null;
  owner_id: string | null;
}

export interface AiContextRefProjectRow {
  id: string;
  title: string;
  status: string | null;
  workspace_id: string | null;
  owner_id: string | null;
}

export interface AiContextRefTeamRow {
  id: string;
  name: string;
  workspace_id: string | null;
  owner_id: string | null;
}

export interface AiContextChainProjectRow {
  id: string;
  title: string;
  workspace_id: string | null;
}

/**
 * Data access for the `/ai/context` family. Every method takes ids the
 * service has ALREADY authorized (or is about to authorize through
 * `RoadmapAuthorizationService` / `getAccessibleProjectIds`): the RPCs run
 * as the service role and the batch loads are plain `.in()` reads. Every
 * method throws a plain `Error` on a query error so the refs service can
 * fail a whole kind closed.
 */
export interface IAiContextRepository {
  readActorDisplayName(userId: string): Promise<string | null>;

  /** `ai_context_roadmap_counts`; roadmaps absent from the map have no rows. */
  roadmapCounts(
    roadmapIds: string[],
    now?: Date,
  ): Promise<Map<string, AiContextRoadmapCountsDto>>;

  /** `ai_context_search_nodes`. */
  searchNodes(
    params: AiContextSearchNodesParams,
  ): Promise<AiContextNodeSearchRow[]>;

  /** `ai_context_list_tasks`. */
  listTasks(params: AiContextListTasksParams): Promise<AiContextTaskRow[]>;

  /** `roadmap_change_history` for one actor, by run or session. */
  listChangeHistory(
    params: AiContextListChangesParams,
  ): Promise<AiContextChangeHistoryRow[]>;

  /** `projects.id` subset that lives in `workspaceId`. */
  filterProjectIdsByWorkspace(
    projectIds: string[],
    workspaceId: string,
  ): Promise<string[]>;

  loadRefTasks(ids: string[]): Promise<AiContextRefTaskRow[]>;
  loadRefFeatures(ids: string[]): Promise<AiContextRefFeatureRow[]>;
  loadRefEpics(ids: string[]): Promise<AiContextRefEpicRow[]>;
  loadRefMilestones(ids: string[]): Promise<AiContextRefMilestoneRow[]>;
  loadRefRoadmaps(ids: string[]): Promise<AiContextRefRoadmapRow[]>;
  loadRefProjects(ids: string[]): Promise<AiContextRefProjectRow[]>;
  loadRefTeams(ids: string[]): Promise<AiContextRefTeamRow[]>;
  /** Of `teamIds`, the ones `userId` is a member of. */
  loadTeamMembershipIds(
    userId: string,
    teamIds: string[],
  ): Promise<Set<string>>;
  loadChainProjects(
    ids: string[],
  ): Promise<Map<string, AiContextChainProjectRow>>;
  loadWorkspaceNames(ids: string[]): Promise<Map<string, string>>;
  /**
   * `roadmaps.id` keyed by `project_id` for the roadmap linked to each of
   * `projectIds` - at most one per project (`uq_roadmaps_project_id_linked`);
   * projects with no linked roadmap are absent from the map.
   */
  loadLinkedRoadmapIds(projectIds: string[]): Promise<Map<string, string>>;
}
