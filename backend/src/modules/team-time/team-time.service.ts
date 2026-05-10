import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import {
  CreateManualTimeLogDto,
  ListLogsQueryDto,
  ReviewTimeLogDto,
  ReviewTimeLogsBulkDto,
  StartTimeLogDto,
  StopTimeLogDto,
  TimeLogReviewDecision,
  UpdateTimeLogDto,
} from './dto/team-time.dto';

const TIME_LOG_SELECT = `
  id, project_id, task_id, member_user_id, team_id, started_at, ended_at,
  duration_seconds, status, reviewed_by, reviewed_at, review_note, source,
  rate_snapshot, currency_snapshot, created_at, updated_at,
  task:roadmap_tasks!task_time_logs_task_id_fkey(id, title),
  member:profiles!task_time_logs_member_user_id_fkey(id, display_name, avatar_url, first_name, last_name, email),
  reviewer:profiles!task_time_logs_reviewed_by_fkey(id, display_name, avatar_url),
  project:projects!task_time_logs_project_id_fkey(id, title)
`;

export interface TimeLogRow {
  id: string;
  project_id: string;
  task_id: string;
  member_user_id: string;
  team_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  source: 'timer' | 'manual';
  rate_snapshot: number;
  currency_snapshot: string;
  created_at: string;
  updated_at: string;
}

export interface ResolvedTeamRate {
  team_id: string;
  hourly_rate: number;
  currency: string;
}

@Injectable()
export class TeamTimeService {
  private readonly logger = new Logger(TeamTimeService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly projectAuth: ProjectAuthorizationService,
  ) {}

  // ─── log mutations ───────────────────────────────────────────────────

  async startLog(callerId: string, dto: StartTimeLogDto): Promise<TimeLogRow> {
    await this.projectAuth.assertRole(callerId, dto.project_id, 'viewer');
    await this.assertTaskInProject(dto.task_id, dto.project_id);
    await this.assertProjectHasTimeTrackingTeam(dto.project_id);

    const { data: running } = await this.supabase
      .from('task_time_logs')
      .select('id')
      .eq('member_user_id', callerId)
      .is('ended_at', null)
      .maybeSingle();
    if (running) {
      throw new BadRequestException(
        'You already have a running timer. Stop it before starting a new one.',
      );
    }

    const rate = await this.resolveTeamRate(dto.project_id, callerId);

    const { data, error } = await this.supabase
      .from('task_time_logs')
      .insert({
        project_id: dto.project_id,
        task_id: dto.task_id,
        member_user_id: callerId,
        team_id: rate?.team_id ?? null,
        started_at: new Date().toISOString(),
        status: 'pending',
        source: 'timer',
        rate_snapshot: rate?.hourly_rate ?? 0,
        currency_snapshot: rate?.currency ?? 'USD',
      })
      .select(TIME_LOG_SELECT)
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to start timer');
    }
    return data as unknown as TimeLogRow;
  }

  async stopLog(
    callerId: string,
    logId: string,
    dto: StopTimeLogDto,
  ): Promise<TimeLogRow> {
    const log = await this.fetchOwnLogOrThrow(logId, callerId);
    if (log.ended_at) {
      throw new BadRequestException('This log is already stopped.');
    }
    const endedAt = dto.ended_at ?? new Date().toISOString();
    const duration = Math.max(
      0,
      Math.floor(
        (new Date(endedAt).getTime() - new Date(log.started_at).getTime()) /
          1000,
      ),
    );
    const { data, error } = await this.supabase
      .from('task_time_logs')
      .update({
        ended_at: endedAt,
        duration_seconds: duration,
        updated_at: new Date().toISOString(),
      })
      .eq('id', logId)
      .select(TIME_LOG_SELECT)
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to stop timer');
    }
    return data as unknown as TimeLogRow;
  }

  async updateLog(
    callerId: string,
    logId: string,
    dto: UpdateTimeLogDto,
  ): Promise<TimeLogRow> {
    const log = await this.fetchOwnLogOrThrow(logId, callerId);
    if (log.status !== 'pending') {
      throw new ForbiddenException(
        `Cannot edit a log that is ${log.status}. Reviewer must move it back to pending first.`,
      );
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (dto.task_id && dto.task_id !== log.task_id) {
      const newProjectId = await this.projectIdForTask(dto.task_id);
      patch.task_id = dto.task_id;
      if (newProjectId !== log.project_id) {
        await this.projectAuth.assertRole(callerId, newProjectId, 'viewer');
        const rate = await this.resolveTeamRate(newProjectId, callerId);
        patch.project_id = newProjectId;
        patch.team_id = rate?.team_id ?? null;
        patch.rate_snapshot = rate?.hourly_rate ?? 0;
        patch.currency_snapshot = rate?.currency ?? 'USD';
      }
    }

    const startedAt = dto.started_at ?? log.started_at;
    const endedAt =
      dto.ended_at !== undefined ? dto.ended_at : log.ended_at ?? null;
    if (dto.started_at !== undefined) patch.started_at = dto.started_at;
    if (dto.ended_at !== undefined) patch.ended_at = dto.ended_at;

    if (endedAt) {
      const start = new Date(startedAt).getTime();
      const end = new Date(endedAt).getTime();
      if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
        throw new BadRequestException(
          'ended_at must be a valid timestamp at or after started_at.',
        );
      }
      patch.duration_seconds = Math.floor((end - start) / 1000);
    } else if (dto.ended_at === null) {
      patch.duration_seconds = null;
    }

    const { data, error } = await this.supabase
      .from('task_time_logs')
      .update(patch)
      .eq('id', logId)
      .select(TIME_LOG_SELECT)
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to update log');
    }
    return data as unknown as TimeLogRow;
  }

  async deleteLog(callerId: string, logId: string): Promise<void> {
    const log = await this.fetchOwnLogOrThrow(logId, callerId);
    if (log.status !== 'pending') {
      throw new ForbiddenException(
        `Cannot delete a log that is ${log.status}.`,
      );
    }
    const { error } = await this.supabase
      .from('task_time_logs')
      .delete()
      .eq('id', logId);
    if (error) throw new Error(error.message);
  }

  async createManualLog(
    callerId: string,
    dto: CreateManualTimeLogDto,
  ): Promise<TimeLogRow> {
    await this.projectAuth.assertRole(callerId, dto.project_id, 'viewer');
    await this.assertTaskInProject(dto.task_id, dto.project_id);
    await this.assertProjectHasTimeTrackingTeam(dto.project_id);

    const start = new Date(dto.started_at).getTime();
    const end = new Date(dto.ended_at).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
      throw new BadRequestException(
        'ended_at must be a valid timestamp strictly after started_at.',
      );
    }

    const rate = await this.resolveTeamRate(dto.project_id, callerId);

    const { data, error } = await this.supabase
      .from('task_time_logs')
      .insert({
        project_id: dto.project_id,
        task_id: dto.task_id,
        member_user_id: callerId,
        team_id: rate?.team_id ?? null,
        started_at: dto.started_at,
        ended_at: dto.ended_at,
        duration_seconds: Math.floor((end - start) / 1000),
        status: 'pending',
        source: 'manual',
        rate_snapshot: rate?.hourly_rate ?? 0,
        currency_snapshot: rate?.currency ?? 'USD',
      })
      .select(TIME_LOG_SELECT)
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to create log');
    }
    return data as unknown as TimeLogRow;
  }

  // ─── single-log read ──────────────────────────────────────────────────

  /**
   * Single-log detail. Visible to the log owner and to any owner/admin of
   * the log's team. Personal-workspace logs (team_id IS NULL) are visible
   * only to the owner.
   */
  async getLog(callerId: string, logId: string): Promise<TimeLogRow> {
    const log = await this.fetchLogOrThrow(logId);
    if (log.team_id) {
      const team = await this.fetchTeamWithFlag(log.team_id);
      this.assertTimeTrackingEnabled(team);
    }
    if (log.member_user_id === callerId) return log;
    if (log.team_id) {
      await this.assertTeamApprover(callerId, log.team_id);
      return log;
    }
    throw new ForbiddenException('You cannot view this time log.');
  }

  // ─── lists ───────────────────────────────────────────────────────────

  /**
   * The caller's own logs scoped to one team. Caller must be a member of
   * the team (owner counts) — this gates random users from probing teams
   * they don't belong to.
   */
  async listMyTeamLogs(
    callerId: string,
    teamId: string,
    query: ListLogsQueryDto,
  ): Promise<{ items: TimeLogRow[]; total: number }> {
    await this.assertTeamMember(callerId, teamId);
    return this.listLogs({
      ...query,
      team_id: teamId,
      member_user_id: callerId,
    });
  }

  async getMyTeamProjectRate(
    callerId: string,
    teamId: string,
    projectId: string,
  ): Promise<ResolvedTeamRate | null> {
    await this.assertTeamMember(callerId, teamId);
    await this.assertTeamAttachedToProject(teamId, projectId);
    await this.projectAuth.assertRole(callerId, projectId, 'viewer');
    return this.resolveTeamRate(projectId, callerId);
  }

  async listTeamLogs(
    callerId: string,
    teamId: string,
    query: ListLogsQueryDto,
  ): Promise<{ items: TimeLogRow[]; total: number }> {
    await this.assertTeamApprover(callerId, teamId);
    return this.listLogs({ ...query, team_id: teamId });
  }

  async listTeamLogProjects(
    callerId: string,
    teamId: string,
  ): Promise<Array<{ id: string; title: string | null }>> {
    await this.assertTeamMember(callerId, teamId);
    const { data, error } = await this.supabase
      .from('project_teams')
      .select('project:projects!project_teams_project_id_fkey(id, title)')
      .eq('team_id', teamId);
    if (error) throw new Error(error.message);
    const seen = new Map<string, { id: string; title: string | null }>();
    for (const row of (data ?? []) as unknown as Array<{
      project: { id: string; title: string | null } | null;
    }>) {
      if (row.project) seen.set(row.project.id, row.project);
    }
    return Array.from(seen.values());
  }

  async listTeamLogMembers(
    callerId: string,
    teamId: string,
  ): Promise<
    Array<{
      id: string;
      display_name: string | null;
      avatar_url: string | null;
      email: string | null;
    }>
  > {
    await this.assertTeamApprover(callerId, teamId);
    const { data, error } = await this.supabase
      .from('team_members')
      .select(
        'user:profiles!team_members_user_id_fkey(id, display_name, avatar_url, email)',
      )
      .eq('team_id', teamId);
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as Array<{
      user: {
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        email: string | null;
      } | null;
    }>)
      .map((r) => r.user)
      .filter((u): u is NonNullable<typeof u> => u !== null);
  }

  // ─── review ──────────────────────────────────────────────────────────

  async reviewLog(
    callerId: string,
    logId: string,
    dto: ReviewTimeLogDto,
  ): Promise<TimeLogRow> {
    const log = await this.fetchLogOrThrow(logId);
    if (!log.team_id) {
      throw new ForbiddenException(
        'This log has no team assignment and cannot be reviewed.',
      );
    }
    await this.assertTeamApprover(callerId, log.team_id);
    if (log.member_user_id === callerId) {
      throw new ForbiddenException('You cannot review your own time logs.');
    }
    return this.applyReview([logId], callerId, dto.decision, dto.reason);
  }

  async reviewLogsBulk(
    callerId: string,
    dto: ReviewTimeLogsBulkDto,
  ): Promise<{ reviewed: number }> {
    const { data, error } = await this.supabase
      .from('task_time_logs')
      .select('id, team_id, member_user_id')
      .in('id', dto.log_ids);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{
      id: string;
      team_id: string | null;
      member_user_id: string;
    }>;
    if (rows.length !== dto.log_ids.length) {
      throw new NotFoundException('One or more logs were not found.');
    }
    const teamIds = new Set(rows.map((r) => r.team_id));
    if (teamIds.size !== 1 || teamIds.has(null)) {
      throw new BadRequestException(
        'Bulk review requires all logs to share one team_id (and none may be unassigned).',
      );
    }
    const teamId = rows[0].team_id as string;
    await this.assertTeamApprover(callerId, teamId);
    if (rows.some((r) => r.member_user_id === callerId)) {
      throw new ForbiddenException('You cannot review your own time logs.');
    }
    await this.applyReview(dto.log_ids, callerId, dto.decision, dto.reason);
    return { reviewed: dto.log_ids.length };
  }

  // ─── tasks ───────────────────────────────────────────────────────────

  async listTeamProjectTasks(
    callerId: string,
    teamId: string,
    projectId: string,
  ): Promise<
    Array<{
      id: string;
      title: string;
      feature_id: string;
      feature_title: string | null;
      epic_id: string | null;
      epic_title: string | null;
    }>
  > {
    await this.assertTeamMember(callerId, teamId);
    await this.assertTeamAttachedToProject(teamId, projectId);
    await this.projectAuth.assertRole(callerId, projectId, 'viewer');
    const { data, error } = await this.supabase
      .from('roadmap_tasks')
      .select(
        `id, title, feature_id,
         feature:roadmap_features!roadmap_tasks_feature_id_fkey(
           id, title, epic_id,
           epic:roadmap_epics!roadmap_features_epic_id_fkey(
             id, title,
             roadmap:roadmaps!roadmap_epics_roadmap_id_fkey(project_id)
           )
         )`,
      );
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as Array<{
      id: string;
      title: string;
      feature_id: string;
      feature: {
        id: string;
        title: string | null;
        epic_id: string | null;
        epic: {
          id: string;
          title: string | null;
          roadmap: { project_id: string | null } | null;
        } | null;
      } | null;
    }>;
    return rows
      .filter((r) => r.feature?.epic?.roadmap?.project_id === projectId)
      .map((r) => ({
        id: r.id,
        title: r.title,
        feature_id: r.feature_id,
        feature_title: r.feature?.title ?? null,
        epic_id: r.feature?.epic?.id ?? null,
        epic_title: r.feature?.epic?.title ?? null,
      }));
  }

  // ─── helpers ─────────────────────────────────────────────────────────

  private async listLogs(filters: {
    status?: string;
    project_id?: string;
    member_user_id?: string;
    team_id?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }): Promise<{ items: TimeLogRow[]; total: number }> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;
    const offset = (page - 1) * limit;

    let q = this.supabase
      .from('task_time_logs')
      .select(TIME_LOG_SELECT, { count: 'exact' })
      .order('started_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (filters.status) q = q.eq('status', filters.status);
    if (filters.project_id) q = q.eq('project_id', filters.project_id);
    if (filters.member_user_id)
      q = q.eq('member_user_id', filters.member_user_id);
    if (filters.team_id) q = q.eq('team_id', filters.team_id);
    if (filters.from) q = q.gte('started_at', filters.from);
    if (filters.to) q = q.lte('started_at', filters.to);

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);
    return {
      items: (data ?? []) as unknown as TimeLogRow[],
      total: count ?? 0,
    };
  }

  private async applyReview(
    logIds: string[],
    callerId: string,
    decision: TimeLogReviewDecision,
    reason: string | undefined,
  ): Promise<TimeLogRow> {
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      status: decision,
      reviewed_by: decision === 'pending' ? null : callerId,
      reviewed_at: decision === 'pending' ? null : now,
      review_note: reason ?? null,
      updated_at: now,
    };
    const { data, error } = await this.supabase
      .from('task_time_logs')
      .update(patch)
      .in('id', logIds)
      .select(TIME_LOG_SELECT);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as TimeLogRow[];
    return rows[0];
  }

  private async fetchLogOrThrow(logId: string): Promise<TimeLogRow> {
    const { data, error } = await this.supabase
      .from('task_time_logs')
      .select(TIME_LOG_SELECT)
      .eq('id', logId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Time log not found');
    return data as unknown as TimeLogRow;
  }

  private async fetchOwnLogOrThrow(
    logId: string,
    callerId: string,
  ): Promise<TimeLogRow> {
    const log = await this.fetchLogOrThrow(logId);
    if (log.member_user_id !== callerId) {
      throw new ForbiddenException('You can only modify your own time logs.');
    }
    return log;
  }

  private async assertTaskInProject(
    taskId: string,
    projectId: string,
  ): Promise<void> {
    const resolvedProject = await this.projectIdForTask(taskId);
    if (resolvedProject !== projectId) {
      throw new BadRequestException(
        'Task does not belong to the given project.',
      );
    }
  }

  private async projectIdForTask(taskId: string): Promise<string> {
    const { data, error } = await this.supabase
      .from('roadmap_tasks')
      .select(
        `feature:roadmap_features!roadmap_tasks_feature_id_fkey(
           epic:roadmap_epics!roadmap_features_epic_id_fkey(
             roadmap:roadmaps!roadmap_epics_roadmap_id_fkey(project_id)
           )
         )`,
      )
      .eq('id', taskId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const projectId = (
      data as unknown as {
        feature: {
          epic: { roadmap: { project_id: string | null } | null } | null;
        } | null;
      } | null
    )?.feature?.epic?.roadmap?.project_id;
    if (!projectId) throw new NotFoundException('Task not found');
    return projectId;
  }

  private async resolveTeamRate(
    projectId: string,
    userId: string,
  ): Promise<ResolvedTeamRate | null> {
    const { data, error } = await this.supabase
      .from('project_team_members')
      .select(
        `team_id,
         project_team:project_teams!project_team_members_project_id_team_id_fkey(is_primary, attached_at),
         team_member:team_members!project_team_members_team_id_user_id_fkey(hourly_rate, currency)`,
      )
      .eq('project_id', projectId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as Array<{
      team_id: string;
      project_team: { is_primary: boolean; attached_at: string } | null;
      team_member: { hourly_rate: number | null; currency: string | null } | null;
    }>;
    if (rows.length === 0) return null;
    rows.sort((a, b) => {
      const ap = a.project_team?.is_primary ? 1 : 0;
      const bp = b.project_team?.is_primary ? 1 : 0;
      if (ap !== bp) return bp - ap;
      const aAt = a.project_team?.attached_at ?? '';
      const bAt = b.project_team?.attached_at ?? '';
      return aAt.localeCompare(bAt);
    });
    const chosen = rows[0];
    return {
      team_id: chosen.team_id,
      hourly_rate: Number(chosen.team_member?.hourly_rate ?? 0),
      currency: chosen.team_member?.currency ?? 'USD',
    };
  }

  private async assertTeamApprover(
    callerId: string,
    teamId: string,
  ): Promise<void> {
    const team = await this.fetchTeamWithFlag(teamId);
    this.assertTimeTrackingEnabled(team);
    if (team.owner_id === callerId) return;

    const { data: member, error: memErr } = await this.supabase
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', callerId)
      .maybeSingle();
    if (memErr) throw new Error(memErr.message);
    if (!member || (member.role !== 'admin' && member.role !== 'owner')) {
      throw new ForbiddenException(
        'Only the team owner or team admins can review time logs.',
      );
    }
  }

  /**
   * Caller is owner of the team OR has any team_members row on it. Used
   * for member-side endpoints (logs, rate preview, task picker) where
   * approval rights aren't required but stranger access must be blocked.
   */
  private async assertTeamMember(
    callerId: string,
    teamId: string,
  ): Promise<void> {
    const team = await this.fetchTeamWithFlag(teamId);
    this.assertTimeTrackingEnabled(team);
    if (team.owner_id === callerId) return;

    const { count, error: memErr } = await this.supabase
      .from('team_members')
      .select('*', { count: 'exact', head: true })
      .eq('team_id', teamId)
      .eq('user_id', callerId);
    if (memErr) throw new Error(memErr.message);
    if (!count) {
      throw new ForbiddenException('You are not a member of this team.');
    }
  }

  /**
   * Refuse log mutations on projects whose primary/contributor teams do
   * not have time tracking enabled. Looked up by joining
   * project_teams → teams; passes if at least one attached team has the
   * flag on (the rate resolver will pick a flagged-on team if both exist).
   */
  private async assertProjectHasTimeTrackingTeam(
    projectId: string,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from('project_teams')
      .select('team:teams!project_teams_team_id_fkey(time_tracking_enabled)')
      .eq('project_id', projectId);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as Array<{
      team: { time_tracking_enabled: boolean } | null;
    }>;
    if (!rows.some((r) => r.team?.time_tracking_enabled)) {
      throw new ForbiddenException(
        'Time tracking is not enabled for any team attached to this project.',
      );
    }
  }

  private async fetchTeamWithFlag(teamId: string): Promise<{
    id: string;
    owner_id: string;
    time_tracking_enabled: boolean;
  }> {
    const { data, error } = await this.supabase
      .from('teams')
      .select('id, owner_id, time_tracking_enabled')
      .eq('id', teamId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Team not found');
    return data as {
      id: string;
      owner_id: string;
      time_tracking_enabled: boolean;
    };
  }

  private assertTimeTrackingEnabled(team: {
    time_tracking_enabled: boolean;
  }): void {
    if (!team.time_tracking_enabled) {
      throw new ForbiddenException(
        'Time tracking is not enabled for this team. The owner must enable it in team settings.',
      );
    }
  }

  private async assertTeamAttachedToProject(
    teamId: string,
    projectId: string,
  ): Promise<void> {
    const { count, error } = await this.supabase
      .from('project_teams')
      .select('*', { count: 'exact', head: true })
      .eq('team_id', teamId)
      .eq('project_id', projectId);
    if (error) throw new Error(error.message);
    if (!count) {
      throw new BadRequestException(
        'This team is not attached to the given project.',
      );
    }
  }
}
