import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import type {
  ProjectTaskOption,
  ProjectMemberTimeRateRecord,
  ProjectTimeRepository,
  TaskTimeLogRecord,
  TimeLogsListResult,
  TimeLogsQueryFilters,
} from './project-time.repository.interface';

@Injectable()
export class ProjectTimeRepositorySupabase implements ProjectTimeRepository {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  // Slice 3b: dropped the JOIN to project_members. The legacy
  // `project_member` field on the response is no longer populated; the
  // frontend falls back to defaults ("member" role, "Project Member"
  // position) when it's absent. project_member_id is now an opaque per-user
  // identifier — equal to member_user_id since the FK was decoupled.
  private readonly rateSelectClause = `
    *,
    member:profiles!project_member_time_rates_member_user_id_fkey(id, display_name, email, avatar_url, banner_url)
  `;

  private readonly selectClause = `
    *,
    task:roadmap_tasks(id, title),
    member:profiles!task_time_logs_member_user_id_fkey(id, display_name, email, avatar_url),
    reviewer:profiles!task_time_logs_reviewed_by_fkey(id, display_name, email, avatar_url)
  `;

  private durationSeconds(startedAtIso: string, endedAtIso: string): number {
    const started = new Date(startedAtIso).getTime();
    const ended = new Date(endedAtIso).getTime();
    return Math.max(0, Math.floor((ended - started) / 1000));
  }

  async hasProjectMemberRate(
    projectId: string,
    memberUserId: string,
  ): Promise<boolean> {
    const { data, error } = await this.db
      .from('project_member_time_rates')
      .select('id')
      .eq('project_id', projectId)
      .eq('member_user_id', memberUserId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return Boolean(data?.id);
  }

  async findProjectMemberRateById(
    projectId: string,
    rateId: string,
  ): Promise<ProjectMemberTimeRateRecord | null> {
    const { data, error } = await this.db
      .from('project_member_time_rates')
      .select(this.rateSelectClause)
      .eq('project_id', projectId)
      .eq('id', rateId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as ProjectMemberTimeRateRecord | null) ?? null;
  }

  async findProjectMemberRateByUser(
    projectId: string,
    memberUserId: string,
  ): Promise<ProjectMemberTimeRateRecord | null> {
    const { data, error } = await this.db
      .from('project_member_time_rates')
      .select(this.rateSelectClause)
      .eq('project_id', projectId)
      .eq('member_user_id', memberUserId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as ProjectMemberTimeRateRecord | null) ?? null;
  }

  async listProjectTasks(projectId: string): Promise<ProjectTaskOption[]> {
    const { data: roadmaps, error: roadmapError } = await this.db
      .from('roadmaps')
      .select('id')
      .eq('project_id', projectId);
    if (roadmapError) throw new Error(roadmapError.message);
    const roadmapIds = (roadmaps ?? []).map((item) => item.id as string);
    if (roadmapIds.length === 0) return [];

    const { data: features, error: featureError } = await this.db
      .from('roadmap_features')
      .select('id, roadmap_id, title, epic_id, position')
      .in('roadmap_id', roadmapIds);
    if (featureError) throw new Error(featureError.message);
    const featureIds = (features ?? []).map((item) => item.id as string);
    if (featureIds.length === 0) return [];

    const featureTitleById = new Map<string, string>();
    const featurePositionById = new Map<string, number | undefined>();
    const featureEpicIdById = new Map<string, string | undefined>();
    const featureRoadmapIdById = new Map<string, string>();
    const epicIds = new Set<string>();
    for (const feature of features ?? []) {
      const featureId = feature.id as string;
      const roadmapId = feature.roadmap_id as string | null | undefined;
      const featureTitle =
        (feature.title as string | null | undefined) ?? 'Untitled feature';
      if (roadmapId) {
        featureRoadmapIdById.set(featureId, roadmapId);
      }
      featureTitleById.set(featureId, featureTitle);
      featurePositionById.set(
        featureId,
        (feature.position as number | null | undefined) ?? undefined,
      );
      const epicId = feature.epic_id as string | null | undefined;
      featureEpicIdById.set(featureId, epicId ?? undefined);
      if (epicId) epicIds.add(epicId);
    }

    const epicTitleById = new Map<string, string>();
    const epicPositionById = new Map<string, number | undefined>();
    if (epicIds.size > 0) {
      const { data: epics, error: epicError } = await this.db
        .from('roadmap_epics')
        .select('id, title, position')
        .in('id', Array.from(epicIds));
      if (epicError) throw new Error(epicError.message);
      for (const epic of epics ?? []) {
        const epicId = epic.id as string;
        epicTitleById.set(
          epicId,
          (epic.title as string | null | undefined) ?? 'Untitled epic',
        );
        epicPositionById.set(
          epicId,
          (epic.position as number | null | undefined) ?? undefined,
        );
      }
    }

    const { data: tasks, error: taskError } = await this.db
      .from('roadmap_tasks')
      .select('id, title, feature_id')
      .in('feature_id', featureIds)
      .order('created_at', { ascending: true });
    if (taskError) throw new Error(taskError.message);

    const taskOptions: ProjectTaskOption[] = [];
    for (const item of tasks ?? []) {
      const featureId = item.feature_id as string;
      const roadmapId = featureRoadmapIdById.get(featureId);
      if (!roadmapId) continue;

      const epicId = featureEpicIdById.get(featureId);
      taskOptions.push({
        id: item.id as string,
        title: (item.title as string | null | undefined) ?? 'Untitled task',
        feature_id: featureId,
        roadmap_id: roadmapId,
        feature_title: featureTitleById.get(featureId),
        feature_position: featurePositionById.get(featureId),
        epic_title: epicId ? epicTitleById.get(epicId) : undefined,
        epic_position: epicId ? epicPositionById.get(epicId) : undefined,
      });
    }

    return taskOptions;
  }

  async listProjectMemberRates(
    projectId: string,
  ): Promise<ProjectMemberTimeRateRecord[]> {
    const { data, error } = await this.db
      .from('project_member_time_rates')
      .select(this.rateSelectClause)
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data as ProjectMemberTimeRateRecord[] | null) ?? [];
  }

  async createProjectMemberRate(params: {
    project_id: string;
    project_member_id: string;
    member_user_id: string;
    hourly_rate: number;
    currency: string;
    custom_id?: string | null;
    start_date: string;
    end_date?: string | null;
  }): Promise<ProjectMemberTimeRateRecord> {
    // Slice 3b: project_member_id is now an opaque per-user identifier.
    // Always align it with member_user_id on insert so the column stays
    // semantically consistent. (Frontend treats it as the URL key for
    // /team-logs/$projectMemberId.)
    const insertPayload = {
      ...params,
      project_member_id: params.member_user_id,
    };
    const { data, error } = await this.db
      .from('project_member_time_rates')
      .insert(insertPayload)
      .select(this.rateSelectClause)
      .single();
    if (error) throw new Error(error.message);
    return data as ProjectMemberTimeRateRecord;
  }

  async updateProjectMemberRateById(
    id: string,
    patch: {
      hourly_rate?: number;
      currency?: string;
      custom_id?: string | null;
      start_date?: string;
      end_date?: string | null;
    },
  ): Promise<ProjectMemberTimeRateRecord> {
    const { data, error } = await this.db
      .from('project_member_time_rates')
      .update(patch)
      .eq('id', id)
      .select(this.rateSelectClause)
      .single();
    if (error) throw new Error(error.message);
    return data as ProjectMemberTimeRateRecord;
  }

  async deleteProjectMemberRateById(id: string): Promise<void> {
    const { error } = await this.db
      .from('project_member_time_rates')
      .delete()
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async getProjectMemberForUser(
    projectId: string,
    userId: string,
  ): Promise<{ id: string; user_id: string | null } | null> {
    // Slice 3b: project membership is now project_shares. The "id" we
    // expose is the user's id (matches the opaque project_member_id).
    const { data, error } = await this.db
      .from('project_shares')
      .select('user_id')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      id: data.user_id as string,
      user_id: data.user_id as string,
    };
  }

  async getProjectMemberById(
    projectId: string,
    projectMemberId: string,
  ): Promise<{ id: string; user_id: string | null } | null> {
    // Slice 3b: projectMemberId is now opaque == user_id. Look up via
    // project_shares to confirm membership.
    const { data, error } = await this.db
      .from('project_shares')
      .select('user_id')
      .eq('project_id', projectId)
      .eq('user_id', projectMemberId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      id: data.user_id as string,
      user_id: data.user_id as string,
    };
  }

  async getTaskProjectId(taskId: string): Promise<string | null> {
    const { data: task, error: taskError } = await this.db
      .from('roadmap_tasks')
      .select('feature_id')
      .eq('id', taskId)
      .maybeSingle();
    if (taskError) throw new Error(taskError.message);
    if (!task?.feature_id) return null;

    const { data: feature, error: featureError } = await this.db
      .from('roadmap_features')
      .select('roadmap_id')
      .eq('id', task.feature_id as string)
      .maybeSingle();
    if (featureError) throw new Error(featureError.message);
    if (!feature?.roadmap_id) return null;

    const { data: roadmap, error: roadmapError } = await this.db
      .from('roadmaps')
      .select('project_id')
      .eq('id', feature.roadmap_id as string)
      .maybeSingle();
    if (roadmapError) throw new Error(roadmapError.message);
    return (roadmap?.project_id as string | null | undefined) ?? null;
  }

  async findById(id: string): Promise<TaskTimeLogRecord | null> {
    const { data, error } = await this.db
      .from('task_time_logs')
      .select(this.selectClause)
      .eq('id', id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return (data as TaskTimeLogRecord | null) ?? null;
  }

  async findByIds(ids: string[]): Promise<TaskTimeLogRecord[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.db
      .from('task_time_logs')
      .select(this.selectClause)
      .in('id', ids);
    if (error) throw new Error(error.message);
    return (data as TaskTimeLogRecord[] | null) ?? [];
  }

  async stopActiveForMember(
    projectId: string,
    memberUserId: string,
    endedAtIso: string,
  ): Promise<void> {
    const { data, error } = await this.db
      .from('task_time_logs')
      .select('id, started_at')
      .eq('project_id', projectId)
      .eq('member_user_id', memberUserId)
      .is('ended_at', null);

    if (error) throw new Error(error.message);
    if (!data?.length) return;

    await Promise.all(
      data.map(async (row) => {
        const startedAt = row.started_at as string;
        const duration = this.durationSeconds(startedAt, endedAtIso);
        const { error: updateError } = await this.db
          .from('task_time_logs')
          .update({
            ended_at: endedAtIso,
            duration_seconds: duration,
          })
          .eq('id', row.id as string);
        if (updateError) throw new Error(updateError.message);
      }),
    );
  }

  async createStartedLog(params: {
    project_id: string;
    task_id: string;
    member_user_id: string;
    started_at: string;
    source: 'timer' | 'manual';
  }): Promise<TaskTimeLogRecord> {
    const { data, error } = await this.db
      .from('task_time_logs')
      .insert({
        ...params,
        status: 'pending',
        ended_at: null,
        duration_seconds: null,
      })
      .select(this.selectClause)
      .single();

    if (error) throw new Error(error.message);
    return data as TaskTimeLogRecord;
  }

  async stopLogById(params: {
    id: string;
    ended_at: string;
  }): Promise<TaskTimeLogRecord> {
    const existing = await this.findById(params.id);
    if (!existing) throw new Error('Time log not found');
    const duration = this.durationSeconds(existing.started_at, params.ended_at);

    const { data, error } = await this.db
      .from('task_time_logs')
      .update({
        ended_at: params.ended_at,
        duration_seconds: duration,
      })
      .eq('id', params.id)
      .select(this.selectClause)
      .single();

    if (error) throw new Error(error.message);
    return data as TaskTimeLogRecord;
  }

  async deleteLogById(id: string): Promise<void> {
    const { error } = await this.db
      .from('task_time_logs')
      .delete()
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async updateLogById(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<TaskTimeLogRecord> {
    const { data, error } = await this.db
      .from('task_time_logs')
      .update(patch)
      .eq('id', id)
      .select(this.selectClause)
      .single();

    if (error) throw new Error(error.message);
    return data as TaskTimeLogRecord;
  }

  async updateLogReviewByIds(
    ids: string[],
    patch: {
      status: 'pending' | 'approved' | 'rejected';
      reviewed_by: string | null;
      reviewed_at: string | null;
      review_note: string | null;
    },
  ): Promise<TaskTimeLogRecord[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.db
      .from('task_time_logs')
      .update(patch)
      .in('id', ids)
      .select(this.selectClause);
    if (error) throw new Error(error.message);
    return (data as TaskTimeLogRecord[] | null) ?? [];
  }

  async listProjectLogs(
    projectId: string,
    filters: TimeLogsQueryFilters,
  ): Promise<TimeLogsListResult> {
    const from = (filters.page - 1) * filters.limit;
    const to = from + filters.limit - 1;

    let base = this.db
      .from('task_time_logs')
      .select('*', { count: 'exact', head: true });
    base = base.eq('project_id', projectId);
    if (filters.status) base = base.eq('status', filters.status);
    if (filters.member_user_id)
      base = base.eq('member_user_id', filters.member_user_id);
    if (filters.task_id) base = base.eq('task_id', filters.task_id);
    if (filters.from) base = base.gte('started_at', filters.from);
    if (filters.to) base = base.lte('started_at', filters.to);

    const { count, error: countError } = await base;
    if (countError) throw new Error(countError.message);

    let itemsQuery = this.db
      .from('task_time_logs')
      .select(this.selectClause)
      .eq('project_id', projectId)
      .order('started_at', { ascending: false })
      .range(from, to);
    if (filters.status) itemsQuery = itemsQuery.eq('status', filters.status);
    if (filters.member_user_id)
      itemsQuery = itemsQuery.eq('member_user_id', filters.member_user_id);
    if (filters.task_id) itemsQuery = itemsQuery.eq('task_id', filters.task_id);
    if (filters.from) itemsQuery = itemsQuery.gte('started_at', filters.from);
    if (filters.to) itemsQuery = itemsQuery.lte('started_at', filters.to);

    const { data, error } = await itemsQuery;
    if (error) throw new Error(error.message);

    return {
      items: (data ?? []) as TaskTimeLogRecord[],
      total: count ?? 0,
      page: filters.page,
      limit: filters.limit,
    };
  }

  async listTaskLogsForMember(params: {
    projectId: string;
    taskId: string;
    memberUserId: string;
    page: number;
    limit: number;
  }): Promise<TimeLogsListResult> {
    return this.listProjectLogs(params.projectId, {
      page: params.page,
      limit: params.limit,
      task_id: params.taskId,
      member_user_id: params.memberUserId,
    });
  }
}
