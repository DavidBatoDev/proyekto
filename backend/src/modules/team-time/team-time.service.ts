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
  CreateTimeLogCommentDto,
  CreateManualTimeLogDto,
  ListLogsQueryDto,
  ReviewTimeLogDto,
  ReviewTimeLogsBulkDto,
  StartTimeLogDto,
  StopTimeLogDto,
  TimeLogReviewDecision,
  UpdateTimeLogDto,
} from './dto/team-time.dto';
import { NotificationsService } from '../notifications/notifications.service';

const TIME_LOG_SELECT = `
  id, project_id, task_id, member_user_id, team_id, started_at, ended_at,
  duration_seconds, status, reviewed_by, reviewed_at, review_note, source,
  rate_snapshot, currency_snapshot, work_type_snapshot, created_at, updated_at,
  task:roadmap_tasks!task_time_logs_task_id_fkey(id, title, work_type),
  member:profiles!task_time_logs_member_user_id_fkey(id, display_name, avatar_url, first_name, last_name, email),
  reviewer:profiles!task_time_logs_reviewed_by_fkey(id, display_name, avatar_url),
  project:projects!task_time_logs_project_id_fkey(id, title)
`;

type TaskWorkType = 'real_work' | 'training';

/** Per-currency fee totals for a set of logs, split by status. */
export interface SummaryBucket {
  pendingFees: number;
  approvedFees: number;
  paidFees: number;
  rejectedFees: number;
  totalFees: number;
}

/** Accurate log aggregates over a full filtered set (mirrors the web LogStats). */
export interface LogsSummary {
  buckets: Record<string, SummaryBucket>;
  currencies: string[];
  totalHours: number;
}

const TIME_LOG_COMMENT_SELECT = `
  id, log_id, author_user_id, body, created_at, updated_at,
  author:profiles!time_log_comments_author_user_id_fkey(
    id, display_name, avatar_url, first_name, last_name, email
  )
`;

export interface TimeLogRow {
  id: string;
  project_id: string;
  task_id: string | null;
  member_user_id: string;
  team_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  status: 'pending' | 'approved' | 'paid' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  source: 'timer' | 'manual';
  rate_snapshot: number;
  currency_snapshot: string;
  work_type_snapshot: TaskWorkType;
  created_at: string;
  updated_at: string;
  limit_context?: TimeLogLimitContext;
  day_review_summary?: TimeLogDaySummary;
  review_comments?: TimeLogCommentRow[];
}

export interface TimeLogCommentRow {
  id: string;
  log_id: string;
  author_user_id: string;
  body: string;
  created_at: string;
  updated_at: string;
  author?: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
}

export interface TimeLogDaySummary {
  day: string;
  total_logs: number;
  pending_logs: number;
  approved_logs: number;
  paid_logs: number;
  rejected_logs: number;
  total_seconds: number;
  limit_context?: TimeLogLimitContext;
}

export interface ReviewLogsBulkResult {
  reviewed: number;
  day_summaries: TimeLogDaySummary[];
}

export interface ResolvedTeamRate {
  team_id: string;
  hourly_rate: number;
  training_hourly_rate: number;
  currency: string;
  weekly_limit_hours: number | null;
  monthly_limit_hours: number | null;
  overtime_requires_approval: boolean;
}

export interface TimeLogLimitContext {
  over_limit: boolean;
  limit_window: 'weekly' | 'monthly' | null;
  limit_hours: number | null;
  logged_hours_in_window: number | null;
  overtime_requires_approval: boolean;
  window_start: string | null;
  window_end: string | null;
}

@Injectable()
export class TeamTimeService {
  private readonly logger = new Logger(TeamTimeService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly projectAuth: ProjectAuthorizationService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── log mutations ───────────────────────────────────────────────────

  async startLog(callerId: string, dto: StartTimeLogDto): Promise<TimeLogRow> {
    const taskId = dto.task_id?.trim() || null;
    await this.projectAuth.assertRole(callerId, dto.project_id, 'viewer');
    let workType: TaskWorkType = 'real_work';
    if (taskId) {
      workType = await this.assertTaskInProject(taskId, dto.project_id);
    }
    await this.assertProjectHasTimeTrackingTeam(dto.project_id);

    const { data: runningRows, error: runningError } = await this.supabase
      .from('task_time_logs')
      .select('id')
      .eq('member_user_id', callerId)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1);
    if (runningError) {
      throw new Error(runningError.message);
    }
    const running = (runningRows ?? []) as Array<{ id: string }>;
    if (running.length > 0) {
      throw new BadRequestException(
        'You already have a running timer. Stop it before starting a new one.',
      );
    }

    const rate = await this.resolveTeamRate(dto.project_id, callerId);
    const resolvedRate = this.pickRateForWorkType(rate, workType);

    const { data, error } = await this.supabase
      .from('task_time_logs')
      .insert({
        project_id: dto.project_id,
        task_id: taskId,
        member_user_id: callerId,
        team_id: rate?.team_id ?? null,
        started_at: new Date().toISOString(),
        status: 'pending',
        source: 'timer',
        rate_snapshot: resolvedRate,
        currency_snapshot: rate?.currency ?? 'USD',
        work_type_snapshot: workType,
      })
      .select(TIME_LOG_SELECT)
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to start timer');
    }
    return this.attachLimitContext(data as unknown as TimeLogRow);
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
      .select(TIME_LOG_SELECT);
    if (error) {
      throw new Error(error?.message ?? 'Failed to stop timer');
    }
    const row = ((data ?? []) as unknown as TimeLogRow[])[0] ?? null;
    if (!row) {
      throw new Error('Failed to stop timer');
    }
    try {
      await this.notifyApprovalRequested(row, callerId);
    } catch (notifyError) {
      this.logger.warn(
        `Failed to send time-log approval notification after stop for log ${row.id}: ${
          notifyError instanceof Error ? notifyError.message : String(notifyError)
        }`,
      );
    }
    return this.attachLimitContext(row);
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

    if (log.source === 'manual') {
      const startedAtForPolicy = dto.started_at ?? log.started_at;
      await this.assertWithinRetroactiveWindow(log.team_id, startedAtForPolicy);
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    const hasTaskIdPatch = Object.prototype.hasOwnProperty.call(dto, 'task_id');
    if (hasTaskIdPatch) {
      const requestedTaskId = dto.task_id?.trim() || null;
      if (requestedTaskId !== log.task_id) {
        patch.task_id = requestedTaskId;
        if (requestedTaskId) {
          const taskContext = await this.fetchTaskContextOrThrow(requestedTaskId);
          await this.projectAuth.assertRole(
            callerId,
            taskContext.project_id,
            'viewer',
          );
          const rate = await this.resolveTeamRate(taskContext.project_id, callerId);
          patch.project_id = taskContext.project_id;
          patch.team_id = rate?.team_id ?? null;
          patch.rate_snapshot = this.pickRateForWorkType(rate, taskContext.work_type);
          patch.currency_snapshot = rate?.currency ?? 'USD';
          patch.work_type_snapshot = taskContext.work_type;
        } else {
          const rate = await this.resolveTeamRate(log.project_id, callerId);
          patch.project_id = log.project_id;
          patch.team_id = rate?.team_id ?? null;
          patch.rate_snapshot = this.pickRateForWorkType(rate, 'real_work');
          patch.currency_snapshot = rate?.currency ?? 'USD';
          patch.work_type_snapshot = 'real_work';
        }
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
    return this.attachLimitContext(data as unknown as TimeLogRow);
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
    const taskId = dto.task_id?.trim() || null;
    await this.projectAuth.assertRole(callerId, dto.project_id, 'viewer');
    let workType: TaskWorkType = 'real_work';
    if (taskId) {
      workType = await this.assertTaskInProject(taskId, dto.project_id);
    }
    await this.assertProjectHasTimeTrackingTeam(dto.project_id);

    const start = new Date(dto.started_at).getTime();
    const end = new Date(dto.ended_at).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
      throw new BadRequestException(
        'ended_at must be a valid timestamp strictly after started_at.',
      );
    }

    const rate = await this.resolveTeamRate(dto.project_id, callerId);
    await this.assertWithinRetroactiveWindow(rate?.team_id ?? null, dto.started_at);
    const resolvedRate = this.pickRateForWorkType(rate, workType);

    const { data, error } = await this.supabase
      .from('task_time_logs')
      .insert({
        project_id: dto.project_id,
        task_id: taskId,
        member_user_id: callerId,
        team_id: rate?.team_id ?? null,
        started_at: dto.started_at,
        ended_at: dto.ended_at,
        duration_seconds: Math.floor((end - start) / 1000),
        status: 'pending',
        source: 'manual',
        rate_snapshot: resolvedRate,
        currency_snapshot: rate?.currency ?? 'USD',
        work_type_snapshot: workType,
      })
      .select(TIME_LOG_SELECT)
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to create log');
    }
    const row = await this.attachLimitContext(data as unknown as TimeLogRow);
    await this.notifyApprovalRequested(row, callerId);
    return row;
  }

  // ─── single-log read ──────────────────────────────────────────────────

  /**
   * Single-log detail. Visible to the log owner and to any owner/admin of
   * the log's team. Personal-workspace logs (team_id IS NULL) are visible
   * only to the owner.
   */
  async getLog(callerId: string, logId: string): Promise<TimeLogRow> {
    const log = await this.fetchLogOrThrow(logId);
    await this.assertCanViewFetchedLog(callerId, log);
    return this.attachLimitContext(log);
  }

  /**
   * Returns the caller's current running log across all teams/projects.
   * startLog enforces one active timer per member, so this is null or one row.
   */
  async getMyRunningLog(callerId: string): Promise<TimeLogRow | null> {
    const { data, error } = await this.supabase
      .from('task_time_logs')
      .select(TIME_LOG_SELECT)
      .eq('member_user_id', callerId)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as TimeLogRow[];
    if (!rows[0]) return null;
    return this.attachLimitContext(rows[0]);
  }

  async listLogComments(
    callerId: string,
    logId: string,
  ): Promise<TimeLogCommentRow[]> {
    await this.assertCanViewLog(callerId, logId);
    const { data, error } = await this.supabase
      .from('time_log_comments')
      .select(TIME_LOG_COMMENT_SELECT)
      .eq('log_id', logId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as TimeLogCommentRow[];
  }

  async createLogComment(
    callerId: string,
    logId: string,
    dto: CreateTimeLogCommentDto,
  ): Promise<TimeLogCommentRow> {
    const log = await this.fetchLogOrThrow(logId);
    await this.assertCanViewFetchedLog(callerId, log);

    const body = dto.body.trim();
    if (!body) {
      throw new BadRequestException('Comment body cannot be empty.');
    }

    const { data, error } = await this.supabase
      .from('time_log_comments')
      .insert({
        log_id: logId,
        author_user_id: callerId,
        body,
      })
      .select(TIME_LOG_COMMENT_SELECT)
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? 'Failed to create log comment');
    }

    const comment = data as unknown as TimeLogCommentRow;
    await this.notifyLogCommentAdded(log, comment, callerId);
    return comment;
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

  /** Accurate totals for the caller's own logs (not capped by the list limit). */
  async myTeamLogsSummary(
    callerId: string,
    teamId: string,
    query: ListLogsQueryDto,
  ): Promise<LogsSummary> {
    await this.assertTeamMember(callerId, teamId);
    return this.logsSummary({
      project_id: query.project_id,
      from: query.from,
      to: query.to,
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

  /** Accurate team totals (respecting project/member filters, not the list cap). */
  async teamLogsSummary(
    callerId: string,
    teamId: string,
    query: ListLogsQueryDto,
  ): Promise<LogsSummary> {
    await this.assertTeamApprover(callerId, teamId);
    return this.logsSummary({
      project_id: query.project_id,
      member_user_id: query.member_user_id,
      from: query.from,
      to: query.to,
      team_id: teamId,
    });
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
    await this.assertTeamMember(callerId, teamId);
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
    this.assertNotPaidDecision(dto.decision);
    const rows = await this.applyReview([logId], callerId, dto.decision, dto.reason);
    const reviewed = rows[0];
    if (!reviewed) throw new NotFoundException('Time log not found');
    await this.notifyReviewOutcome(rows, callerId, dto.decision, dto.reason);
    return this.attachReviewContext(reviewed);
  }

  async reviewLogsBulk(
    callerId: string,
    dto: ReviewTimeLogsBulkDto,
  ): Promise<ReviewLogsBulkResult> {
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
    this.assertNotPaidDecision(dto.decision);
    const reviewedRows = await this.applyReview(
      dto.log_ids,
      callerId,
      dto.decision,
      dto.reason,
    );
    await this.notifyReviewOutcome(
      reviewedRows,
      callerId,
      dto.decision,
      dto.reason,
    );

    const summaryMap = new Map<string, TimeLogDaySummary>();
    for (const row of reviewedRows) {
      const summary = await this.computeDaySummaryForLog(row);
      if (!summary) continue;
      summaryMap.set(`${row.member_user_id}:${summary.day}`, summary);
    }

    return {
      reviewed: dto.log_ids.length,
      day_summaries: Array.from(summaryMap.values()),
    };
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
      work_type: TaskWorkType;
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
        `id, title, work_type, feature_id,
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
      work_type: TaskWorkType | null;
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
        work_type: r.work_type ?? 'real_work',
        feature_id: r.feature_id,
        feature_title: r.feature?.title ?? null,
        epic_id: r.feature?.epic?.id ?? null,
        epic_title: r.feature?.epic?.title ?? null,
      }));
  }

  private async attachReviewContext(log: TimeLogRow): Promise<TimeLogRow> {
    const [daySummary, limitContext] = await Promise.all([
      this.computeDaySummaryForLog(log),
      this.resolveLimitContextForLog(log),
    ]);
    const { data, error } = await this.supabase
      .from('time_log_comments')
      .select(TIME_LOG_COMMENT_SELECT)
      .eq('log_id', log.id)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) throw new Error(error.message);
    const comments = ((data ?? []) as unknown as TimeLogCommentRow[]).reverse();
    return {
      ...log,
      limit_context: limitContext,
      day_review_summary:
        daySummary ? { ...daySummary, limit_context: limitContext } : undefined,
      review_comments: comments,
    };
  }

  private async computeDaySummaryForLog(
    log: TimeLogRow,
  ): Promise<TimeLogDaySummary | null> {
    const day = this.toUtcDay(log.started_at);
    if (!day) return null;
    const [summary, limitContext] = await Promise.all([
      this.computeDaySummary(log.team_id, log.member_user_id, day),
      this.resolveLimitContextForLog(log),
    ]);
    if (!summary) return null;
    return {
      ...summary,
      limit_context: limitContext,
    };
  }

  private async computeDaySummary(
    teamId: string | null,
    memberUserId: string,
    day: string,
  ): Promise<TimeLogDaySummary | null> {
    const from = `${day}T00:00:00.000Z`;
    const to = `${day}T23:59:59.999Z`;

    let query = this.supabase
      .from('task_time_logs')
      .select('status, duration_seconds')
      .eq('member_user_id', memberUserId)
      .gte('started_at', from)
      .lte('started_at', to);

    if (teamId) query = query.eq('team_id', teamId);
    else query = query.is('team_id', null);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{
      status: TimeLogReviewDecision;
      duration_seconds: number | null;
    }>;
    if (rows.length === 0) return null;

    let pending = 0;
    let approved = 0;
    let paid = 0;
    let rejected = 0;
    let totalSeconds = 0;

    for (const row of rows) {
      if (row.status === 'pending') pending += 1;
      else if (row.status === 'approved') approved += 1;
      else if (row.status === 'paid') paid += 1;
      else if (row.status === 'rejected') rejected += 1;
      totalSeconds += Math.max(0, Number(row.duration_seconds ?? 0));
    }

    return {
      day,
      total_logs: rows.length,
      pending_logs: pending,
      approved_logs: approved,
      paid_logs: paid,
      rejected_logs: rejected,
      total_seconds: totalSeconds,
    };
  }

  private toUtcDay(iso: string): string | null {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
  }

  private async attachLimitContext(log: TimeLogRow): Promise<TimeLogRow> {
    const limitContext = await this.resolveLimitContextForLog(log);
    return {
      ...log,
      limit_context: limitContext,
      day_review_summary: log.day_review_summary
        ? { ...log.day_review_summary, limit_context: limitContext }
        : log.day_review_summary,
    };
  }

  private async attachLimitContextBatch(logs: TimeLogRow[]): Promise<TimeLogRow[]> {
    // Pre-fetch all unique (project, member) rates in parallel to eliminate N+1 on resolveTeamRate.
    const rateCache = new Map<string, ResolvedTeamRate | null>();
    const uniquePairs = [
      ...new Set(logs.map((l) => `${l.project_id}|${l.member_user_id}`)),
    ];
    await Promise.all(
      uniquePairs.map(async (key) => {
        const sep = key.indexOf('|');
        const rate = await this.resolveTeamRate(
          key.slice(0, sep),
          key.slice(sep + 1),
        );
        rateCache.set(key, rate);
      }),
    );

    // Promise-based window-sum cache: stores the in-flight Promise so parallel
    // calls for the same window share the same DB round-trip instead of each
    // firing their own.
    const windowSumPromises = new Map<string, Promise<number>>();

    return Promise.all(
      logs.map(async (log) => {
        const context = await this.resolveLimitContextForLog(
          log,
          undefined,
          rateCache,
          windowSumPromises,
        );
        return {
          ...log,
          limit_context: context,
          day_review_summary: log.day_review_summary
            ? { ...log.day_review_summary, limit_context: context }
            : log.day_review_summary,
        };
      }),
    );
  }

  private getWeekWindowUtc(iso: string): { start: string; end: string } | null {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    const day = date.getUTCDay();
    const diffToMonday = (day + 6) % 7;
    const start = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
    start.setUTCDate(start.getUTCDate() - diffToMonday);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    end.setUTCHours(23, 59, 59, 999);
    return {
      start: start.toISOString(),
      end: end.toISOString(),
    };
  }

  private getMonthWindowUtc(iso: string): { start: string; end: string } | null {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    const start = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0),
    );
    const end = new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      ),
    );
    return {
      start: start.toISOString(),
      end: end.toISOString(),
    };
  }

  private buildLimitCacheKey(
    log: TimeLogRow,
    window: 'weekly' | 'monthly',
    start: string,
    end: string,
  ): string {
    return [
      log.member_user_id,
      log.project_id,
      log.team_id ?? 'none',
      window,
      start,
      end,
    ].join('|');
  }

  private async sumLoggedHoursInWindow(
    log: TimeLogRow,
    windowStartIso: string,
    windowEndIso: string,
  ): Promise<number> {
    if (!log.team_id) return 0;

    const { data, error } = await this.supabase
      .from('task_time_logs')
      .select('duration_seconds')
      .eq('team_id', log.team_id)
      .eq('project_id', log.project_id)
      .eq('member_user_id', log.member_user_id)
      .neq('status', 'rejected')
      .gte('started_at', windowStartIso)
      .lte('started_at', windowEndIso);

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as Array<{ duration_seconds: number | null }>;
    const totalSeconds = rows.reduce(
      (acc, row) => acc + Math.max(0, Number(row.duration_seconds ?? 0)),
      0,
    );
    return totalSeconds / 3600;
  }

  private async resolveLimitContextForLog(
    log: TimeLogRow,
    _legacyCache?: Map<string, TimeLogLimitContext>,
    rateCache?: Map<string, ResolvedTeamRate | null>,
    windowSumPromises?: Map<string, Promise<number>>,
  ): Promise<TimeLogLimitContext> {
    if (!log.team_id) {
      return {
        over_limit: false,
        limit_window: null,
        limit_hours: null,
        logged_hours_in_window: null,
        overtime_requires_approval: false,
        window_start: null,
        window_end: null,
      };
    }

    const rateCacheKey = `${log.project_id}|${log.member_user_id}`;
    const rate = rateCache?.has(rateCacheKey)
      ? (rateCache.get(rateCacheKey) ?? null)
      : await this.resolveTeamRate(log.project_id, log.member_user_id);
    if (!rate) {
      return {
        over_limit: false,
        limit_window: null,
        limit_hours: null,
        logged_hours_in_window: null,
        overtime_requires_approval: false,
        window_start: null,
        window_end: null,
      };
    }

    const windows: Array<{
      key: 'weekly' | 'monthly';
      limit: number | null;
      start: string;
      end: string;
    }> = [];

    if (rate.weekly_limit_hours !== null && rate.weekly_limit_hours !== undefined) {
      const week = this.getWeekWindowUtc(log.started_at);
      if (week) {
        windows.push({
          key: 'weekly',
          limit: Number(rate.weekly_limit_hours),
          start: week.start,
          end: week.end,
        });
      }
    }

    if (rate.monthly_limit_hours !== null && rate.monthly_limit_hours !== undefined) {
      const month = this.getMonthWindowUtc(log.started_at);
      if (month) {
        windows.push({
          key: 'monthly',
          limit: Number(rate.monthly_limit_hours),
          start: month.start,
          end: month.end,
        });
      }
    }

    if (windows.length === 0) {
      return {
        over_limit: false,
        limit_window: null,
        limit_hours: null,
        logged_hours_in_window: null,
        overtime_requires_approval: Boolean(rate.overtime_requires_approval),
        window_start: null,
        window_end: null,
      };
    }

    let selected:
      | {
          key: 'weekly' | 'monthly';
          limit: number;
          start: string;
          end: string;
          hours: number;
          over: boolean;
        }
      | null = null;

    for (const window of windows) {
      const cacheKey = this.buildLimitCacheKey(log, window.key, window.start, window.end);
      // Use the promise cache so parallel calls for the same window share one DB round-trip.
      if (windowSumPromises && !windowSumPromises.has(cacheKey)) {
        windowSumPromises.set(
          cacheKey,
          this.sumLoggedHoursInWindow(log, window.start, window.end),
        );
      }
      const hours = windowSumPromises
        ? await windowSumPromises.get(cacheKey)!
        : await this.sumLoggedHoursInWindow(log, window.start, window.end);

      const candidate = {
        key: window.key,
        limit: Number(window.limit ?? 0),
        start: window.start,
        end: window.end,
        hours,
        over: hours > Number(window.limit ?? 0),
      };

      if (!selected) {
        selected = candidate;
        continue;
      }

      if (candidate.over && !selected.over) {
        selected = candidate;
        continue;
      }

      if (candidate.over === selected.over && candidate.key === 'weekly') {
        selected = candidate;
      }
    }

    if (!selected) {
      return {
        over_limit: false,
        limit_window: null,
        limit_hours: null,
        logged_hours_in_window: null,
        overtime_requires_approval: Boolean(rate.overtime_requires_approval),
        window_start: null,
        window_end: null,
      };
    }

    return {
      over_limit: selected.over,
      limit_window: selected.key,
      limit_hours: selected.limit,
      logged_hours_in_window: selected.hours,
      overtime_requires_approval: Boolean(rate.overtime_requires_approval),
      window_start: selected.start,
      window_end: selected.end,
    };
  }

  private async assertWithinRetroactiveWindow(
    teamId: string | null,
    startedAtIso: string,
  ): Promise<void> {
    if (!teamId) return;
    const team = await this.fetchTeamWithFlag(teamId);
    const policyDays = Number(team.retroactive_log_days ?? 0);
    if (!policyDays || policyDays <= 0) return;

    const startedAt = new Date(startedAtIso);
    if (Number.isNaN(startedAt.getTime())) {
      throw new BadRequestException('Invalid started_at value.');
    }

    const now = new Date();
    const threshold = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    threshold.setUTCDate(threshold.getUTCDate() - policyDays);

    if (startedAt.getTime() < threshold.getTime()) {
      throw new BadRequestException(
        `Manual logs older than ${policyDays} day(s) are locked by team policy.`,
      );
    }
  }

  private async notifyApprovalRequested(
    log: TimeLogRow,
    actorId: string,
  ): Promise<void> {
    if (!log.team_id || !log.ended_at) return;
    const recipients = await this.listTeamApproverRecipientIds(log.team_id);
    const day = this.toUtcDay(log.started_at);
    const dayText = day ?? 'this day';

    await Promise.all(
      recipients
        .filter((userId) => userId !== actorId)
        .map((userId) =>
          this.notifications.createNotification({
            user_id: userId,
            project_id: log.project_id,
            actor_id: actorId,
            type_name: 'time_log_approval_requested',
            content: {
              log_id: log.id,
              member_user_id: log.member_user_id,
              status: log.status,
              day,
              message: `A time log is ready for approval for ${dayText}.`,
            },
            link_url: `/teams/${log.team_id}/time/team-logs`,
          }),
        ),
    );
  }

  private async notifyReviewOutcome(
    reviewedRows: TimeLogRow[],
    actorId: string,
    decision: TimeLogReviewDecision,
    reason?: string,
  ): Promise<void> {
    if (reviewedRows.length === 0) return;

    const decisionType =
      decision === 'approved' || decision === 'paid'
        ? 'time_log_approved'
        : decision === 'rejected'
          ? 'time_log_rejected'
          : 'time_log_pending';

    const sentDayRejection = new Set<string>();

    for (const row of reviewedRows) {
      const day = this.toUtcDay(row.started_at);
      const decisionLabel =
        decision === 'paid' ? 'marked as paid' : `marked as ${decision}`;

      if (row.member_user_id !== actorId) {
        await this.notifications.createNotification({
          user_id: row.member_user_id,
          project_id: row.project_id,
          actor_id: actorId,
          type_name: decisionType,
          content: {
            log_id: row.id,
            status: decision,
            day,
            reason: reason ?? row.review_note ?? null,
            message: `Your time log was ${decisionLabel}.`,
          },
          link_url: row.team_id
            ? `/teams/${row.team_id}/time/my-logs`
            : undefined,
        });
      }

      if (decision === 'rejected' && row.team_id) {
        const summary = await this.computeDaySummaryForLog(row);
        if (!summary || summary.rejected_logs <= 0) continue;
        const key = `${row.member_user_id}:${summary.day}`;
        if (sentDayRejection.has(key)) continue;
        sentDayRejection.add(key);

        if (row.member_user_id !== actorId) {
          await this.notifications.createNotification({
            user_id: row.member_user_id,
            project_id: row.project_id,
            actor_id: actorId,
            type_name: 'time_log_day_rejected',
            content: {
              day: summary.day,
              rejected_logs: summary.rejected_logs,
              message: `One or more logs were rejected for ${summary.day}.`,
            },
            link_url: `/teams/${row.team_id}/time/my-logs`,
          });
        }
      }
    }
  }

  private async notifyLogCommentAdded(
    log: TimeLogRow,
    comment: TimeLogCommentRow,
    actorId: string,
  ): Promise<void> {
    const recipients = new Set<string>();

    if (actorId === log.member_user_id) {
      if (log.team_id) {
        const approvers = await this.listTeamApproverRecipientIds(log.team_id);
        approvers.forEach((id) => recipients.add(id));
      }
      if (log.reviewed_by) recipients.add(log.reviewed_by);
    } else {
      recipients.add(log.member_user_id);
    }

    recipients.delete(actorId);
    if (recipients.size === 0) return;

    const snippet =
      comment.body.length > 140
        ? `${comment.body.slice(0, 137)}...`
        : comment.body;

    await Promise.all(
      Array.from(recipients).map((userId) =>
        this.notifications.createNotification({
          user_id: userId,
          project_id: log.project_id,
          actor_id: actorId,
          type_name: 'time_log_comment_added',
          content: {
            log_id: log.id,
            comment_id: comment.id,
            message: `New comment on a time log: "${snippet}"`,
          },
          link_url:
            log.team_id && userId === log.member_user_id
              ? `/teams/${log.team_id}/time/my-logs`
              : log.team_id
                ? `/teams/${log.team_id}/time/team-logs`
                : undefined,
        }),
      ),
    );
  }

  private async listTeamApproverRecipientIds(teamId: string): Promise<string[]> {
    const team = await this.fetchTeamWithFlag(teamId);
    const ids = new Set<string>([team.owner_id]);
    const { data, error } = await this.supabase
      .from('team_members')
      .select('user_id, role')
      .eq('team_id', teamId)
      .in('role', ['owner', 'admin']);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<{ user_id: string }>) {
      ids.add(row.user_id);
    }
    return Array.from(ids.values());
  }

  // ─── helpers ─────────────────────────────────────────────────────────

  /**
   * Accurate per-status / per-currency totals over the ENTIRE filtered set,
   * independent of the paginated list cap. Fetches only the four columns
   * needed for the sums and pages through in blocks so a team with thousands
   * of logs still reports correct hours/fees (the list view is capped at 200,
   * so its client-side totals under-count — this endpoint does not).
   */
  private async logsSummary(filters: {
    status?: string;
    project_id?: string;
    member_user_id?: string;
    team_id?: string;
    from?: string;
    to?: string;
  }): Promise<LogsSummary> {
    const PAGE = 1000;
    const buckets: Record<string, SummaryBucket> = {};
    let totalSeconds = 0;
    const ensureBucket = (cur: string): SummaryBucket => {
      if (!buckets[cur]) {
        buckets[cur] = {
          pendingFees: 0,
          approvedFees: 0,
          paidFees: 0,
          rejectedFees: 0,
          totalFees: 0,
        };
      }
      return buckets[cur];
    };

    for (let offset = 0; ; offset += PAGE) {
      let q = this.supabase
        .from('task_time_logs')
        .select('status, currency_snapshot, duration_seconds, rate_snapshot')
        .order('started_at', { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (filters.status) q = q.eq('status', filters.status);
      if (filters.project_id) q = q.eq('project_id', filters.project_id);
      if (filters.member_user_id)
        q = q.eq('member_user_id', filters.member_user_id);
      if (filters.team_id) q = q.eq('team_id', filters.team_id);
      if (filters.from) q = q.gte('started_at', filters.from);
      if (filters.to) q = q.lte('started_at', filters.to);

      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<{
        status: string;
        currency_snapshot: string | null;
        duration_seconds: number | null;
        rate_snapshot: number | string | null;
      }>;
      for (const row of rows) {
        const seconds = row.duration_seconds ?? 0;
        if (seconds > 0) totalSeconds += seconds;
        const rate = Number(row.rate_snapshot ?? 0);
        if (!Number.isFinite(rate) || rate <= 0 || seconds <= 0) continue;
        const fees = (seconds / 3600) * rate;
        const bucket = ensureBucket(row.currency_snapshot || 'USD');
        bucket.totalFees += fees;
        if (row.status === 'pending') bucket.pendingFees += fees;
        else if (row.status === 'approved') bucket.approvedFees += fees;
        else if (row.status === 'paid') bucket.paidFees += fees;
        else if (row.status === 'rejected') bucket.rejectedFees += fees;
      }
      if (rows.length < PAGE) break;
    }

    return {
      buckets,
      currencies: Object.keys(buckets).sort(),
      totalHours: totalSeconds / 3600,
    };
  }

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
    const items = await this.attachLimitContextBatch(
      (data ?? []) as unknown as TimeLogRow[],
    );
    return {
      items,
      total: count ?? 0,
    };
  }

  /**
   * The 'paid' transition is owned by the payouts module — marking logs paid
   * must create a payout record (POST /api/payouts). Reject 'paid' here so
   * there is exactly one path to a paid log: paid ⟺ a payout row exists.
   */
  private assertNotPaidDecision(decision: TimeLogReviewDecision): void {
    if (decision === 'paid') {
      throw new BadRequestException(
        'Record a payout to mark logs as paid (POST /api/payouts).',
      );
    }
  }

  private async applyReview(
    logIds: string[],
    callerId: string,
    decision: TimeLogReviewDecision,
    reason: string | undefined,
  ): Promise<TimeLogRow[]> {
    const { data: currentRows, error: currentErr } = await this.supabase
      .from('task_time_logs')
      .select('id, status')
      .in('id', logIds);
    if (currentErr) throw new Error(currentErr.message);
    const current = (currentRows ?? []) as Array<{
      id: string;
      status: TimeLogReviewDecision;
    }>;
    if (current.length !== logIds.length) {
      throw new NotFoundException('One or more logs were not found.');
    }

    const isAllowedTransition = (
      from: TimeLogReviewDecision,
      to: TimeLogReviewDecision,
    ) => {
      if (to === 'pending') return true;
      if (to === 'approved' || to === 'rejected') return from === 'pending';
      if (to === 'paid') return from === 'approved';
      return false;
    };

    const invalid = current.filter((row) =>
      !isAllowedTransition(row.status, decision),
    );
    if (invalid.length > 0) {
      const fromStatuses = Array.from(
        new Set(invalid.map((row) => row.status)),
      ).join(', ');
      throw new BadRequestException(
        `Cannot set status to ${decision} from ${fromStatuses}.`,
      );
    }

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
    return (data ?? []) as unknown as TimeLogRow[];
  }

  private async fetchLogOrThrow(logId: string): Promise<TimeLogRow> {
    const { data, error } = await this.supabase
      .from('task_time_logs')
      .select(TIME_LOG_SELECT)
      .eq('id', logId)
      .limit(1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as TimeLogRow[];
    if (rows.length === 0) throw new NotFoundException('Time log not found');
    return rows[0];
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

  private async assertCanViewLog(callerId: string, logId: string): Promise<void> {
    const log = await this.fetchLogOrThrow(logId);
    await this.assertCanViewFetchedLog(callerId, log);
  }

  private async assertCanViewFetchedLog(
    callerId: string,
    log: TimeLogRow,
  ): Promise<void> {
    if (log.member_user_id === callerId) return;
    if (!log.team_id) {
      throw new ForbiddenException('You cannot view this time log.');
    }

    const team = await this.fetchTeamWithFlag(log.team_id);
    this.assertTimeTrackingEnabled(team);
    if (team.owner_id === callerId) return;

    const { data, error } = await this.supabase
      .from('team_members')
      .select('role')
      .eq('team_id', log.team_id)
      .eq('user_id', callerId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data && (data.role === 'owner' || data.role === 'admin')) return;

    throw new ForbiddenException('You cannot view this time log.');
  }

  private async assertTaskInProject(
    taskId: string,
    projectId: string,
  ): Promise<TaskWorkType> {
    const taskContext = await this.fetchTaskContextOrThrow(taskId);
    if (taskContext.project_id !== projectId) {
      throw new BadRequestException(
        'Task does not belong to the given project.',
      );
    }
    return taskContext.work_type;
  }

  private async fetchTaskContextOrThrow(taskId: string): Promise<{
    project_id: string;
    work_type: TaskWorkType;
  }> {
    const { data, error } = await this.supabase
      .from('roadmap_tasks')
      .select(
        `work_type,
         feature:roadmap_features!roadmap_tasks_feature_id_fkey(
           epic:roadmap_epics!roadmap_features_epic_id_fkey(
             roadmap:roadmaps!roadmap_epics_roadmap_id_fkey(project_id)
           )
         )`,
      )
      .eq('id', taskId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = (
      data as unknown as {
        work_type: TaskWorkType | null;
        feature: {
          epic: { roadmap: { project_id: string | null } | null } | null;
        } | null;
      } | null
    ) ?? null;
    const projectId = row?.feature?.epic?.roadmap?.project_id;
    if (!projectId) throw new NotFoundException('Task not found');
    return {
      project_id: projectId,
      work_type: row?.work_type ?? 'real_work',
    };
  }

  /**
   * Pick the team whose rate snapshots onto a new log for `userId` on
   * `projectId`. Primary team wins; otherwise any contributor team
   * (deterministic by attached_at). The chosen team's *active* rate
   * (the team_member_rates row with end_date IS NULL) supplies both
   * real-work and training rates plus currency. Returns null when there
   * is no curation row OR no active rate — caller treats that as a
   * 0-rate log.
   */
  private async resolveTeamRate(
    projectId: string,
    userId: string,
  ): Promise<ResolvedTeamRate | null> {
    const { data, error } = await this.supabase
      .from('project_team_members')
      .select(
        `team_id,
         project_team:project_teams!project_team_members_project_id_team_id_fkey(is_primary, attached_at)`,
      )
      .eq('project_id', projectId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as Array<{
      team_id: string;
      project_team: { is_primary: boolean; attached_at: string } | null;
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

    const { data: rateRow, error: rateErr } = await this.supabase
      .from('team_member_rates')
      .select(
        'hourly_rate, training_hourly_rate, currency, weekly_limit_hours, monthly_limit_hours, overtime_requires_approval',
      )
      .eq('team_id', chosen.team_id)
      .eq('user_id', userId)
      .eq('project_id', projectId)
      .is('end_date', null)
      .maybeSingle();
    if (rateErr) throw new Error(rateErr.message);

    return {
      team_id: chosen.team_id,
      hourly_rate: Number(rateRow?.hourly_rate ?? 0),
      training_hourly_rate: Number(rateRow?.training_hourly_rate ?? 0),
      currency: rateRow?.currency ?? 'USD',
      weekly_limit_hours:
        rateRow?.weekly_limit_hours === null || rateRow?.weekly_limit_hours === undefined
          ? null
          : Number(rateRow.weekly_limit_hours),
      monthly_limit_hours:
        rateRow?.monthly_limit_hours === null ||
        rateRow?.monthly_limit_hours === undefined
          ? null
          : Number(rateRow.monthly_limit_hours),
      overtime_requires_approval: Boolean(rateRow?.overtime_requires_approval),
    };
  }

  private pickRateForWorkType(
    rate: ResolvedTeamRate | null,
    workType: TaskWorkType,
  ): number {
    if (!rate) return 0;
    if (workType === 'training') return Number(rate.training_hourly_rate ?? 0);
    return Number(rate.hourly_rate ?? 0);
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
    retroactive_log_days: number | null;
  }> {
    const { data, error } = await this.supabase
      .from('teams')
      .select('id, owner_id, time_tracking_enabled, retroactive_log_days')
      .eq('id', teamId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Team not found');
    return data as {
      id: string;
      owner_id: string;
      time_tracking_enabled: boolean;
      retroactive_log_days: number | null;
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
