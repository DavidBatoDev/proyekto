import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import type {
  EntitlementsRepository,
  EntitlementSubjectKind,
  EntitlementSubjectRow,
  LargestRoadmapRow,
  PlanLimitKeyRow,
  PlanLimitRow,
  WorkspacePlanStateRow,
  WorkspaceUsageCountsRow,
} from './entitlements.repository.interface';

type QueryError = { message: string } | null;

const KEY_COLUMNS =
  'key, kind, label, description, unit, group_key, sort_order';
const LIMIT_COLUMNS =
  'plan, limit_key, kind, int_value, bool_value, per_seat, display_label, updated_by, updated_at';

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => typeof id === 'string' && id))];
}

function toInt(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

@Injectable()
export class SupabaseEntitlementsRepository implements EntitlementsRepository {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  async listLimitKeys(): Promise<PlanLimitKeyRow[]> {
    const { data, error } = await this.db
      .from('plan_limit_keys')
      .select(KEY_COLUMNS)
      .order('sort_order', { ascending: true })
      .order('key', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as PlanLimitKeyRow[];
  }

  async listLimits(): Promise<PlanLimitRow[]> {
    // 18 keys x 4 plans: far under PostgREST's row cap, so one page.
    const { data, error } = await this.db
      .from('plan_limits')
      .select(LIMIT_COLUMNS)
      .order('limit_key', { ascending: true })
      .order('plan', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as PlanLimitRow[];
  }

  async getPlanStates(
    workspaceIds: string[],
  ): Promise<WorkspacePlanStateRow[]> {
    const ids = uniqueIds(workspaceIds);
    if (ids.length === 0) return [];
    const { data, error } = (await this.db.rpc('workspace_plan_state', {
      p_workspace_ids: ids,
    })) as { data: unknown; error: QueryError };
    if (error) throw new Error(error.message);
    return (data ?? []) as WorkspacePlanStateRow[];
  }

  async getUsageCounts(
    workspaceIds: string[],
  ): Promise<WorkspaceUsageCountsRow[]> {
    const ids = uniqueIds(workspaceIds);
    if (ids.length === 0) return [];
    const { data, error } = (await this.db.rpc('workspace_usage_counts', {
      p_workspace_ids: ids,
    })) as { data: unknown; error: QueryError };
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      workspace_id: String(row.workspace_id),
      members: toInt(row.members),
      pending_invites: toInt(row.pending_invites),
      projects: toInt(row.projects),
      teams: toInt(row.teams),
    }));
  }

  async getLargestRoadmaps(
    workspaceId: string,
    limit: number,
  ): Promise<LargestRoadmapRow[]> {
    const { data, error } = (await this.db.rpc('workspace_largest_roadmaps', {
      p_workspace_id: workspaceId,
      p_limit: limit,
    })) as { data: unknown; error: QueryError };
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      roadmap_id: String(row.roadmap_id),
      name: typeof row.name === 'string' ? row.name : '',
      project_id: typeof row.project_id === 'string' ? row.project_id : null,
      project_title:
        typeof row.project_title === 'string' ? row.project_title : null,
      owner_id: String(row.owner_id),
      nodes: toInt(row.nodes),
    }));
  }

  async resolveSubject(
    kind: EntitlementSubjectKind,
    id: string,
  ): Promise<EntitlementSubjectRow | null> {
    const { data, error } = (await this.db.rpc('entitlement_subject', {
      p_kind: kind,
      p_id: id,
    })) as { data: unknown; error: QueryError };
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as
      | Record<string, unknown>
      | null
      | undefined;
    if (!row) return null;
    return {
      found: row.found === true,
      workspace_id:
        typeof row.workspace_id === 'string' ? row.workspace_id : null,
      exempt: row.exempt === true,
    };
  }

  async countRoadmapNodes(roadmapIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    const ids = uniqueIds(roadmapIds);
    if (ids.length === 0) return counts;
    const { data, error } = (await this.db.rpc('ai_context_roadmap_counts', {
      p_roadmap_ids: ids,
    })) as { data: unknown; error: QueryError };
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      if (typeof row.roadmap_id !== 'string') continue;
      // Milestones are deliberately not nodes for the per-roadmap limit.
      counts.set(
        row.roadmap_id,
        toInt(row.epics) + toInt(row.features) + toInt(row.tasks),
      );
    }
    return counts;
  }

  async listMemberWorkspaceIds(userId: string): Promise<string[]> {
    const { data, error } = await this.db
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
    return uniqueIds(
      ((data ?? []) as Array<{ workspace_id: string }>).map(
        (row) => row.workspace_id,
      ),
    );
  }
}
