import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import type { AiContextRoadmapCountsDto } from '../dto/ai-context.dto';
import type {
  AiContextChainProjectRow,
  AiContextChangeHistoryRow,
  AiContextListChangesParams,
  AiContextListTasksParams,
  AiContextNodeSearchRow,
  AiContextRefEpicRow,
  AiContextRefFeatureRow,
  AiContextRefMilestoneRow,
  AiContextRefProjectRow,
  AiContextRefRoadmapRow,
  AiContextRefTaskRow,
  AiContextRefTeamRow,
  AiContextSearchNodesParams,
  AiContextTaskRow,
  IAiContextRepository,
} from './ai-context.repository.interface';

/**
 * PostgREST `.in()` filters travel in the URL; keep each chunk well under the
 * length where a few hundred uuids start failing outright (the
 * `RoadmapAuthorizationService` constant, kept local so the module has no
 * private import).
 */
const IN_FILTER_CHUNK_SIZE = 50;

const CHANGE_HISTORY_COLUMNS = [
  'change_id',
  'roadmap_id',
  'project_id',
  'status',
  'operations_count',
  'semantic_change_count',
  'revision_token_after',
  'committed_at',
  'run_id',
  'session_id',
].join(', ');

type QueryError = { message: string } | null;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter((id) => typeof id === 'string' && id)));
}

/**
 * The Supabase client types an embedded to-one relation as an array; accept
 * both shapes rather than trusting either (the `listMyWorkspaces` precedent).
 */
function firstEmbedded<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  if (value && typeof value === 'object') return value as T;
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

@Injectable()
export class AiContextRepositorySupabase implements IAiContextRepository {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  async readActorDisplayName(userId: string): Promise<string | null> {
    const { data, error } = await this.db
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .maybeSingle();
    // Display name is decoration: a failed read degrades to null exactly as
    // the in-roadmap `getContextActor` does.
    if (error || !data) return null;
    const value = (data as { display_name?: unknown }).display_name;
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  async roadmapCounts(
    roadmapIds: string[],
    now: Date = new Date(),
  ): Promise<Map<string, AiContextRoadmapCountsDto>> {
    const counts = new Map<string, AiContextRoadmapCountsDto>();
    const ids = uniqueIds(roadmapIds);
    if (ids.length === 0) return counts;

    const { data, error } = (await this.db.rpc('ai_context_roadmap_counts', {
      p_roadmap_ids: ids,
      p_now: now.toISOString(),
    })) as { data: unknown; error: QueryError };
    if (error) throw new Error(error.message);

    for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
      const roadmapId = readString(raw.roadmap_id);
      if (!roadmapId) continue;
      counts.set(roadmapId, {
        epics: readNumber(raw.epics),
        features: readNumber(raw.features),
        tasks: readNumber(raw.tasks),
        open_tasks: readNumber(raw.open_tasks),
        overdue_tasks: readNumber(raw.overdue_tasks),
      });
    }
    return counts;
  }

  async searchNodes(
    params: AiContextSearchNodesParams,
  ): Promise<AiContextNodeSearchRow[]> {
    const ids = uniqueIds(params.roadmapIds);
    if (ids.length === 0 || params.kinds.length === 0 || !params.query) {
      return [];
    }

    const { data, error } = (await this.db.rpc('ai_context_search_nodes', {
      p_roadmap_ids: ids,
      p_query: params.query,
      p_kinds: params.kinds,
      p_limit: params.limit,
    })) as { data: unknown; error: QueryError };
    if (error) throw new Error(error.message);

    return ((data ?? []) as Array<Record<string, unknown>>).flatMap((raw) => {
      const id = readString(raw.id);
      const roadmapId = readString(raw.roadmap_id);
      const kind = raw.kind;
      if (
        !id ||
        !roadmapId ||
        (kind !== 'epic' && kind !== 'feature' && kind !== 'task')
      ) {
        return [];
      }
      return [
        {
          id,
          kind,
          title: readString(raw.title) ?? '',
          status: readString(raw.status),
          roadmap_id: roadmapId,
          epic_id: readString(raw.epic_id),
          feature_id: readString(raw.feature_id),
          parent_title: readString(raw.parent_title),
          rank: readNumber(raw.rank),
          updated_at: readString(raw.updated_at),
        },
      ];
    });
  }

  async listTasks(
    params: AiContextListTasksParams,
  ): Promise<AiContextTaskRow[]> {
    const ids = uniqueIds(params.roadmapIds);
    if (ids.length === 0) return [];

    const { data, error } = (await this.db.rpc('ai_context_list_tasks', {
      p_roadmap_ids: ids,
      p_assignee: params.assignee,
      p_statuses: params.statuses,
      p_due_from: params.dueFrom,
      p_due_to: params.dueTo,
      p_overdue_at: params.overdueAt,
      p_limit: params.limit,
    })) as { data: unknown; error: QueryError };
    if (error) throw new Error(error.message);

    return ((data ?? []) as Array<Record<string, unknown>>).flatMap((raw) => {
      const id = readString(raw.id);
      const roadmapId = readString(raw.roadmap_id);
      const featureId = readString(raw.feature_id);
      if (!id || !roadmapId || !featureId) return [];
      return [
        {
          id,
          title: readString(raw.title) ?? '',
          status: readString(raw.status) ?? 'todo',
          priority: readString(raw.priority),
          due_date: readString(raw.due_date),
          updated_at: readString(raw.updated_at),
          feature_id: featureId,
          feature_title: readString(raw.feature_title),
          epic_id: readString(raw.epic_id),
          epic_title: readString(raw.epic_title),
          roadmap_id: roadmapId,
          assignee_ids: Array.isArray(raw.assignee_ids)
            ? raw.assignee_ids.filter(
                (value): value is string => typeof value === 'string',
              )
            : [],
        },
      ];
    });
  }

  async listChangeHistory(
    params: AiContextListChangesParams,
  ): Promise<AiContextChangeHistoryRow[]> {
    let query = this.db
      .from('roadmap_change_history')
      .select(CHANGE_HISTORY_COLUMNS)
      .eq('actor_id', params.actorId);
    if (params.runId) query = query.eq('run_id', params.runId);
    if (params.sessionId) query = query.eq('session_id', params.sessionId);

    const { data, error } = await query
      .order('committed_at', { ascending: true })
      .limit(params.limit);
    if (error) throw new Error(error.message);

    return ((data ?? []) as unknown as Array<Record<string, unknown>>).flatMap(
      (raw) => {
        const changeId = readString(raw.change_id);
        const roadmapId = readString(raw.roadmap_id);
        if (!changeId || !roadmapId) return [];
        return [
          {
            change_id: changeId,
            roadmap_id: roadmapId,
            project_id: readString(raw.project_id),
            status: readString(raw.status) ?? 'applied',
            operations_count: readNumber(raw.operations_count),
            semantic_change_count: readNumber(raw.semantic_change_count),
            revision_token_after: readString(raw.revision_token_after),
            committed_at: readString(raw.committed_at) ?? '',
            run_id: readString(raw.run_id),
            session_id: readString(raw.session_id),
          },
        ];
      },
    );
  }

  async filterProjectIdsByWorkspace(
    projectIds: string[],
    workspaceId: string,
  ): Promise<string[]> {
    const ids = uniqueIds(projectIds);
    if (ids.length === 0) return [];
    const kept: string[] = [];
    for (const batch of chunk(ids, IN_FILTER_CHUNK_SIZE)) {
      const { data, error } = await this.db
        .from('projects')
        .select('id')
        .eq('workspace_id', workspaceId)
        .in('id', batch);
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as Array<{ id?: unknown }>) {
        const id = readString(row.id);
        if (id) kept.push(id);
      }
    }
    return kept;
  }

  // resolve-refs batch loads ------------------------------------------------

  async loadRefTasks(ids: string[]): Promise<AiContextRefTaskRow[]> {
    // The task -> feature -> epic chain in one query: the embed proven by
    // `TasksRepositorySupabase.findByRoadmap`. A task carries no roadmap id
    // of its own; `feature.roadmap_id` is the attribution.
    const rows = await this.loadByIds(
      'roadmap_tasks',
      'id, title, status, feature:roadmap_features(id, title, roadmap_id, epic_id, epic:roadmap_epics(id, title))',
      ids,
    );
    return rows.flatMap((raw) => {
      const id = readString(raw.id);
      if (!id) return [];
      const feature = firstEmbedded<Record<string, unknown>>(raw.feature);
      const featureId = readString(feature?.id);
      const featureRoadmapId = readString(feature?.roadmap_id);
      return [
        {
          id,
          title: readString(raw.title) ?? '',
          status: readString(raw.status),
          feature:
            feature && featureId && featureRoadmapId
              ? {
                  id: featureId,
                  title: readString(feature.title) ?? '',
                  roadmap_id: featureRoadmapId,
                  epic_id: readString(feature.epic_id),
                  epic: this.readEpicEmbed(feature.epic),
                }
              : null,
        },
      ];
    });
  }

  async loadRefFeatures(ids: string[]): Promise<AiContextRefFeatureRow[]> {
    const rows = await this.loadByIds(
      'roadmap_features',
      'id, title, status, roadmap_id, epic_id, epic:roadmap_epics(id, title)',
      ids,
    );
    return rows.flatMap((raw) => {
      const id = readString(raw.id);
      const roadmapId = readString(raw.roadmap_id);
      if (!id || !roadmapId) return [];
      return [
        {
          id,
          title: readString(raw.title) ?? '',
          status: readString(raw.status),
          roadmap_id: roadmapId,
          epic_id: readString(raw.epic_id),
          epic: this.readEpicEmbed(raw.epic),
        },
      ];
    });
  }

  async loadRefEpics(ids: string[]): Promise<AiContextRefEpicRow[]> {
    const rows = await this.loadByIds(
      'roadmap_epics',
      'id, title, status, roadmap_id',
      ids,
    );
    return this.toRoadmapChildRows(rows);
  }

  async loadRefMilestones(ids: string[]): Promise<AiContextRefMilestoneRow[]> {
    const rows = await this.loadByIds(
      'roadmap_milestones',
      'id, title, status, roadmap_id',
      ids,
    );
    return this.toRoadmapChildRows(rows);
  }

  async loadRefRoadmaps(ids: string[]): Promise<AiContextRefRoadmapRow[]> {
    const rows = await this.loadByIds(
      'roadmaps',
      'id, name, status, project_id, owner_id',
      ids,
    );
    return rows.flatMap((raw) => {
      const id = readString(raw.id);
      if (!id) return [];
      return [
        {
          id,
          name: readString(raw.name) ?? '',
          status: readString(raw.status),
          project_id: readString(raw.project_id),
          owner_id: readString(raw.owner_id),
        },
      ];
    });
  }

  async loadRefProjects(ids: string[]): Promise<AiContextRefProjectRow[]> {
    const rows = await this.loadByIds(
      'projects',
      'id, title, status, workspace_id, owner_id',
      ids,
    );
    return rows.flatMap((raw) => {
      const id = readString(raw.id);
      if (!id) return [];
      return [
        {
          id,
          title: readString(raw.title) ?? '',
          status: readString(raw.status),
          workspace_id: readString(raw.workspace_id),
          owner_id: readString(raw.owner_id),
        },
      ];
    });
  }

  async loadRefTeams(ids: string[]): Promise<AiContextRefTeamRow[]> {
    const rows = await this.loadByIds(
      'teams',
      'id, name, workspace_id, owner_id',
      ids,
    );
    return rows.flatMap((raw) => {
      const id = readString(raw.id);
      if (!id) return [];
      return [
        {
          id,
          name: readString(raw.name) ?? '',
          workspace_id: readString(raw.workspace_id),
          owner_id: readString(raw.owner_id),
        },
      ];
    });
  }

  async loadTeamMembershipIds(
    userId: string,
    teamIds: string[],
  ): Promise<Set<string>> {
    const member = new Set<string>();
    const ids = uniqueIds(teamIds);
    if (ids.length === 0) return member;
    for (const batch of chunk(ids, IN_FILTER_CHUNK_SIZE)) {
      const { data, error } = await this.db
        .from('team_members')
        .select('team_id')
        .eq('user_id', userId)
        .in('team_id', batch);
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as Array<{ team_id?: unknown }>) {
        const id = readString(row.team_id);
        if (id) member.add(id);
      }
    }
    return member;
  }

  async loadChainProjects(
    ids: string[],
  ): Promise<Map<string, AiContextChainProjectRow>> {
    const projects = new Map<string, AiContextChainProjectRow>();
    const rows = await this.loadByIds(
      'projects',
      'id, title, workspace_id',
      ids,
    );
    for (const raw of rows) {
      const id = readString(raw.id);
      if (!id) continue;
      projects.set(id, {
        id,
        title: readString(raw.title) ?? '',
        workspace_id: readString(raw.workspace_id),
      });
    }
    return projects;
  }

  async loadWorkspaceNames(ids: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const rows = await this.loadByIds('workspaces', 'id, name', ids);
    for (const raw of rows) {
      const id = readString(raw.id);
      if (!id) continue;
      names.set(id, readString(raw.name) ?? '');
    }
    return names;
  }

  async loadLinkedRoadmapIds(
    projectIds: string[],
  ): Promise<Map<string, string>> {
    const byProject = new Map<string, string>();
    const ids = uniqueIds(projectIds);
    if (ids.length === 0) return byProject;
    for (const batch of chunk(ids, IN_FILTER_CHUNK_SIZE)) {
      const { data, error } = await this.db
        .from('roadmaps')
        .select('id, project_id')
        .in('project_id', batch);
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as Array<{
        id?: unknown;
        project_id?: unknown;
      }>) {
        const id = readString(row.id);
        const projectId = readString(row.project_id);
        // The partial unique index makes a second row impossible; keep the
        // first defensively rather than letting a later one win.
        if (id && projectId && !byProject.has(projectId)) {
          byProject.set(projectId, id);
        }
      }
    }
    return byProject;
  }

  // helpers ------------------------------------------------------------------

  private async loadByIds(
    table: string,
    select: string,
    ids: string[],
  ): Promise<Array<Record<string, unknown>>> {
    const unique = uniqueIds(ids);
    if (unique.length === 0) return [];
    const rows: Array<Record<string, unknown>> = [];
    for (const batch of chunk(unique, IN_FILTER_CHUNK_SIZE)) {
      const { data, error } = await this.db
        .from(table)
        .select(select)
        .in('id', batch);
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as unknown as Array<Record<string, unknown>>));
    }
    return rows;
  }

  private readEpicEmbed(value: unknown): { id: string; title: string } | null {
    const epic = firstEmbedded<Record<string, unknown>>(value);
    const id = readString(epic?.id);
    if (!epic || !id) return null;
    return { id, title: readString(epic.title) ?? '' };
  }

  private toRoadmapChildRows(rows: Array<Record<string, unknown>>): Array<{
    id: string;
    title: string;
    status: string | null;
    roadmap_id: string;
  }> {
    return rows.flatMap((raw) => {
      const id = readString(raw.id);
      const roadmapId = readString(raw.roadmap_id);
      if (!id || !roadmapId) return [];
      return [
        {
          id,
          title: readString(raw.title) ?? '',
          status: readString(raw.status),
          roadmap_id: roadmapId,
        },
      ];
    });
  }
}
