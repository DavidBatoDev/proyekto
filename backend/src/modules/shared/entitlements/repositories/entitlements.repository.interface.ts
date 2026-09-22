/**
 * Read-only lookups behind EntitlementsService. Every SQL function named here
 * lives in 20260922120000_workspace_plan_limits.sql (ai_context_roadmap_counts
 * in 20260904090000) and is SECURITY INVOKER, service_role only, so this
 * repository runs on the admin client and callers authorize first.
 *
 * Rows are snake_case, as PostgREST returns them. Implementations throw on a
 * query error; the service decides whether that fails open.
 */

export const ENTITLEMENTS_REPOSITORY = Symbol('ENTITLEMENTS_REPOSITORY');

/** A row of public.plan_limit_keys. */
export interface PlanLimitKeyRow {
  key: string;
  kind: string;
  label: string;
  description: string | null;
  unit: string | null;
  group_key: string;
  sort_order: number;
}

/** A row of public.plan_limits. NULL int_value means unlimited. */
export interface PlanLimitRow {
  plan: string;
  limit_key: string;
  kind: string;
  int_value: number | null;
  bool_value: boolean | null;
  per_seat: boolean;
  display_label: string | null;
  updated_by: string | null;
  updated_at: string;
}

/** A row of workspace_plan_state(uuid[]): the single definition of the effective plan. */
export interface WorkspacePlanStateRow {
  workspace_id: string;
  workspace_name: string | null;
  workspace_slug: string | null;
  subscription_plan: string | null;
  subscription_status: string | null;
  has_provider_subscription: boolean | null;
  is_discounted_free: boolean | null;
  discounted_plan: string | null;
  discounted_at: string | null;
  discounted_until: string | null;
  comp_active: boolean | null;
  effective_plan: string | null;
  plan_source: string | null;
}

/** A row of workspace_usage_counts(uuid[]). */
export interface WorkspaceUsageCountsRow {
  workspace_id: string;
  members: number;
  pending_invites: number;
  projects: number;
  teams: number;
}

/** A row of workspace_largest_roadmaps(uuid, int). nodes = epics + features + tasks. */
export interface LargestRoadmapRow {
  roadmap_id: string;
  name: string;
  project_id: string | null;
  project_title: string | null;
  owner_id: string;
  nodes: number;
}

export type EntitlementSubjectKind = 'project' | 'team' | 'roadmap';

/** A row of entitlement_subject(text, uuid). Read-only: it never provisions a workspace. */
export interface EntitlementSubjectRow {
  found: boolean;
  workspace_id: string | null;
  exempt: boolean;
}

export interface EntitlementsRepository {
  listLimitKeys(): Promise<PlanLimitKeyRow[]>;

  listLimits(): Promise<PlanLimitRow[]>;

  /** One row per workspace id that exists; unknown ids are simply absent. */
  getPlanStates(workspaceIds: string[]): Promise<WorkspacePlanStateRow[]>;

  getUsageCounts(workspaceIds: string[]): Promise<WorkspaceUsageCountsRow[]>;

  getLargestRoadmaps(
    workspaceId: string,
    limit: number,
  ): Promise<LargestRoadmapRow[]>;

  /** Null when the function returned no row. */
  resolveSubject(
    kind: EntitlementSubjectKind,
    id: string,
  ): Promise<EntitlementSubjectRow | null>;

  /** epics + features + tasks per roadmap (milestones excluded); absent ids have no nodes. */
  countRoadmapNodes(roadmapIds: string[]): Promise<Map<string, number>>;

  /** Every workspace the user belongs to, in any role. */
  listMemberWorkspaceIds(userId: string): Promise<string[]>;
}
