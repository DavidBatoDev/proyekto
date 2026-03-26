import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service';
import { hasPermission } from '../projects/permissions/project-permissions';
import {
  BulkReviewTimeLogsDto,
  CreateProjectMemberTimeRateDto,
  ReviewTimeLogDto,
  StartTimeLogDto,
  StopTimeLogDto,
  TimeLogsQueryDto,
  UpdateProjectMemberTimeRateDto,
  UpdateTimeLogDto,
} from './dto/project-time.dto';
import type {
  ProjectTaskOption,
  ProjectMemberTimeRateRecord,
  ProjectTimeRepository,
  TaskTimeLogRecord,
  TimeLogsListResult,
} from './repositories/project-time.repository.interface';

export const PROJECT_TIME_REPOSITORY = Symbol('PROJECT_TIME_REPOSITORY');

@Injectable()
export class ProjectTimeService {
  private static readonly RATE_REQUIRED_MESSAGE =
    'You are not enabled for time tracking in this project. Ask a manager to add your time rate.';

  constructor(
    @Inject(PROJECT_TIME_REPOSITORY)
    private readonly repo: ProjectTimeRepository,
    private readonly projectsService: ProjectsService,
  ) {}

  private asIso(value: string | undefined): string {
    return value ? new Date(value).toISOString() : new Date().toISOString();
  }

  private computeDurationSeconds(
    startedAtIso: string,
    endedAtIso?: string | null,
  ): number | null {
    if (!endedAtIso) return null;
    const started = new Date(startedAtIso).getTime();
    const ended = new Date(endedAtIso).getTime();
    return Math.max(0, Math.floor((ended - started) / 1000));
  }

  private async assertTaskBelongsToProject(
    taskId: string,
    projectId: string,
  ): Promise<void> {
    const taskProjectId = await this.repo.getTaskProjectId(taskId);
    if (!taskProjectId) {
      throw new NotFoundException('Task not found');
    }
    if (taskProjectId !== projectId) {
      throw new BadRequestException(
        'Task does not belong to the specified project.',
      );
    }
  }

  private validateTimeWindow(startedAtIso: string, endedAtIso?: string | null) {
    if (!endedAtIso) return;
    if (new Date(endedAtIso).getTime() <= new Date(startedAtIso).getTime()) {
      throw new BadRequestException('End time must be later than start time.');
    }
  }

  private async getLogOrThrow(logId: string): Promise<TaskTimeLogRecord> {
    const existing = await this.repo.findById(logId);
    if (!existing) throw new NotFoundException('Time log not found');
    return existing;
  }

  private normalizePaging(query: TimeLogsQueryDto): {
    page: number;
    limit: number;
  } {
    return {
      page: query.page && query.page > 0 ? query.page : 1,
      limit: query.limit && query.limit > 0 ? query.limit : 20,
    };
  }

  private normalizeCurrency(value: string | undefined): string {
    const normalized = (value ?? '').trim().toUpperCase();
    if (!normalized) {
      throw new BadRequestException('Currency is required.');
    }
    return normalized;
  }

  private async assertTimeRateEnabled(
    projectId: string,
    userId: string,
  ): Promise<void> {
    const hasRate = await this.repo.hasProjectMemberRate(projectId, userId);
    if (!hasRate) {
      throw new ForbiddenException(ProjectTimeService.RATE_REQUIRED_MESSAGE);
    }
  }

  private async getProjectMemberTargetOrThrow(
    projectId: string,
    dto: CreateProjectMemberTimeRateDto,
  ): Promise<{ id: string; user_id: string | null }> {
    if (dto.project_member_id) {
      const member = await this.repo.getProjectMemberById(
        projectId,
        dto.project_member_id,
      );
      if (!member) {
        throw new NotFoundException('Project member not found.');
      }
      return member;
    }

    if (!dto.member_user_id) {
      throw new BadRequestException(
        'Either project_member_id or member_user_id is required.',
      );
    }

    const member = await this.repo.getProjectMemberForUser(
      projectId,
      dto.member_user_id,
    );
    if (!member) {
      throw new NotFoundException('Project member not found.');
    }
    return member;
  }

  async listProjectMemberRates(
    userId: string,
    projectId: string,
  ): Promise<ProjectMemberTimeRateRecord[]> {
    const permissions = await this.projectsService.getMyPermissions(
      projectId,
      userId,
    );
    const canManageRates = hasPermission(permissions, 'time.manage_rates');
    const canViewTeamRates =
      hasPermission(permissions, 'time.edit_team') || canManageRates;

    if (!canViewTeamRates) {
      throw new ForbiddenException(
        'You do not have permission to view team time rates.',
      );
    }

    if (!canManageRates) {
      await this.assertTimeRateEnabled(projectId, userId);
    }

    return this.repo.listProjectMemberRates(projectId);
  }

  async getMyProjectMemberRate(
    userId: string,
    projectId: string,
  ): Promise<ProjectMemberTimeRateRecord> {
    await this.projectsService.assertProjectPermission(
      projectId,
      userId,
      'time.view',
    );
    const rate = await this.repo.findProjectMemberRateByUser(projectId, userId);
    if (!rate) {
      throw new ForbiddenException(ProjectTimeService.RATE_REQUIRED_MESSAGE);
    }
    return rate;
  }

  async listProjectTasks(
    userId: string,
    projectId: string,
  ): Promise<ProjectTaskOption[]> {
    await this.projectsService.assertProjectAnyPermission(projectId, userId, [
      'time.view',
      'time.edit_team',
      'time.approve',
      'time.manage_rates',
    ]);
    return this.repo.listProjectTasks(projectId);
  }

  async createProjectMemberRate(
    userId: string,
    projectId: string,
    dto: CreateProjectMemberTimeRateDto,
  ): Promise<ProjectMemberTimeRateRecord> {
    await this.projectsService.assertProjectPermission(
      projectId,
      userId,
      'time.manage_rates',
    );

    const targetMember = await this.getProjectMemberTargetOrThrow(
      projectId,
      dto,
    );
    if (!targetMember.user_id) {
      throw new BadRequestException(
        'Cannot configure rate for a member without a linked user.',
      );
    }

    const existing = await this.repo.findProjectMemberRateByUser(
      projectId,
      targetMember.user_id,
    );
    if (existing) {
      throw new BadRequestException(
        'Time rate already exists for this member.',
      );
    }

    return this.repo.createProjectMemberRate({
      project_id: projectId,
      project_member_id: targetMember.id,
      member_user_id: targetMember.user_id,
      hourly_rate: dto.hourly_rate,
      currency: this.normalizeCurrency(dto.currency),
      custom_id: dto.custom_id?.trim() || null,
      start_date: dto.start_date,
      end_date: dto.end_date ?? null,
    });
  }

  async updateProjectMemberRate(
    userId: string,
    projectId: string,
    rateId: string,
    dto: UpdateProjectMemberTimeRateDto,
  ): Promise<ProjectMemberTimeRateRecord> {
    await this.projectsService.assertProjectPermission(
      projectId,
      userId,
      'time.manage_rates',
    );

    const existing = await this.repo.findProjectMemberRateById(
      projectId,
      rateId,
    );
    if (!existing) {
      throw new NotFoundException('Project member time rate not found.');
    }

    const patch: {
      hourly_rate?: number;
      currency?: string;
      custom_id?: string | null;
      start_date?: string;
      end_date?: string | null;
    } = {};

    if (dto.hourly_rate !== undefined) {
      patch.hourly_rate = dto.hourly_rate;
    }
    if (dto.currency !== undefined) {
      patch.currency = this.normalizeCurrency(dto.currency);
    }
    if (dto.custom_id !== undefined) {
      patch.custom_id = dto.custom_id.trim() || null;
    }
    if (dto.start_date !== undefined) {
      patch.start_date = dto.start_date;
    }
    if (dto.end_date !== undefined) {
      patch.end_date = dto.end_date || null;
    }

    if (Object.keys(patch).length === 0) {
      return existing;
    }

    return this.repo.updateProjectMemberRateById(existing.id, patch);
  }

  async deleteProjectMemberRate(
    userId: string,
    projectId: string,
    rateId: string,
  ): Promise<void> {
    await this.projectsService.assertProjectPermission(
      projectId,
      userId,
      'time.manage_rates',
    );

    const existing = await this.repo.findProjectMemberRateById(
      projectId,
      rateId,
    );
    if (!existing) {
      throw new NotFoundException('Project member time rate not found.');
    }

    await this.repo.deleteProjectMemberRateById(existing.id);
  }

  async start(
    userId: string,
    dto: StartTimeLogDto,
  ): Promise<TaskTimeLogRecord> {
    await this.projectsService.assertProjectPermission(
      dto.project_id,
      userId,
      'time.log',
    );
    await this.assertTimeRateEnabled(dto.project_id, userId);
    await this.assertTaskBelongsToProject(dto.task_id, dto.project_id);

    const nowIso = new Date().toISOString();
    await this.repo.stopActiveForMember(dto.project_id, userId, nowIso);

    return this.repo.createStartedLog({
      project_id: dto.project_id,
      task_id: dto.task_id,
      member_user_id: userId,
      started_at: nowIso,
      source: 'timer',
    });
  }

  async stop(
    userId: string,
    logId: string,
    dto: StopTimeLogDto,
  ): Promise<TaskTimeLogRecord> {
    const existing = await this.getLogOrThrow(logId);

    if (existing.member_user_id === userId) {
      await this.projectsService.assertProjectAnyPermission(
        existing.project_id,
        userId,
        ['time.edit_own', 'time.log'],
      );
    } else {
      await this.projectsService.assertProjectPermission(
        existing.project_id,
        userId,
        'time.edit_team',
      );
    }
    await this.assertTimeRateEnabled(existing.project_id, userId);

    const endedAtIso = this.asIso(dto.ended_at);
    this.validateTimeWindow(existing.started_at, endedAtIso);
    return this.repo.stopLogById({ id: logId, ended_at: endedAtIso });
  }

  async update(
    userId: string,
    logId: string,
    dto: UpdateTimeLogDto,
  ): Promise<TaskTimeLogRecord> {
    const existing = await this.getLogOrThrow(logId);
    const isOwn = existing.member_user_id === userId;

    if (isOwn) {
      await this.projectsService.assertProjectPermission(
        existing.project_id,
        userId,
        'time.edit_own',
      );
    } else {
      await this.projectsService.assertProjectPermission(
        existing.project_id,
        userId,
        'time.edit_team',
      );
    }
    await this.assertTimeRateEnabled(existing.project_id, userId);

    if (dto.task_id !== undefined) {
      await this.assertTaskBelongsToProject(dto.task_id, existing.project_id);
    }

    const nextTaskId = dto.task_id ?? existing.task_id;
    const nextStartedAt = dto.started_at
      ? this.asIso(dto.started_at)
      : existing.started_at;
    const nextEndedAt =
      dto.ended_at === undefined ? existing.ended_at : this.asIso(dto.ended_at);
    this.validateTimeWindow(nextStartedAt, nextEndedAt);

    const startedChanged = nextStartedAt !== existing.started_at;
    const endedChanged = (nextEndedAt ?? null) !== (existing.ended_at ?? null);
    const taskChanged = nextTaskId !== existing.task_id;
    const hasTimeChanged = startedChanged || endedChanged;

    const patch: Record<string, unknown> = {
      task_id: nextTaskId,
      started_at: nextStartedAt,
      ended_at: nextEndedAt,
      duration_seconds: this.computeDurationSeconds(nextStartedAt, nextEndedAt),
    };

    if (dto.review_note !== undefined) {
      patch.review_note = dto.review_note.trim() || null;
    }

    if (existing.status === 'approved' && (hasTimeChanged || taskChanged)) {
      patch.status = 'pending';
      patch.reviewed_by = null;
      patch.reviewed_at = null;
    }

    if (dto.started_at !== undefined || dto.ended_at !== undefined) {
      patch.source = 'manual';
    }

    return this.repo.updateLogById(logId, patch);
  }

  async delete(userId: string, logId: string): Promise<void> {
    const existing = await this.getLogOrThrow(logId);
    const isOwn = existing.member_user_id === userId;

    if (isOwn) {
      await this.projectsService.assertProjectPermission(
        existing.project_id,
        userId,
        'time.edit_own',
      );
    } else {
      await this.projectsService.assertProjectPermission(
        existing.project_id,
        userId,
        'time.edit_team',
      );
    }
    await this.assertTimeRateEnabled(existing.project_id, userId);
    await this.repo.deleteLogById(logId);
  }

  async review(
    userId: string,
    logId: string,
    dto: ReviewTimeLogDto,
  ): Promise<TaskTimeLogRecord> {
    const existing = await this.getLogOrThrow(logId);
    await this.projectsService.assertProjectPermission(
      existing.project_id,
      userId,
      'time.approve',
    );

    const isPending = dto.decision === 'pending';
    const nowIso = new Date().toISOString();
    return this.repo.updateLogById(logId, {
      status: dto.decision,
      reviewed_by: isPending ? null : userId,
      reviewed_at: isPending ? null : nowIso,
      review_note: isPending ? null : dto.reason?.trim() || null,
    });
  }

  async reviewBulk(
    userId: string,
    dto: BulkReviewTimeLogsDto,
  ): Promise<TaskTimeLogRecord[]> {
    const uniqueLogIds = Array.from(new Set(dto.log_ids));
    if (uniqueLogIds.length === 0) {
      throw new BadRequestException('At least one time log is required.');
    }

    const logs = await this.repo.findByIds(uniqueLogIds);
    if (logs.length !== uniqueLogIds.length) {
      throw new NotFoundException('One or more time logs were not found.');
    }

    const projectIds = Array.from(new Set(logs.map((log) => log.project_id)));
    for (const projectId of projectIds) {
      await this.projectsService.assertProjectPermission(
        projectId,
        userId,
        'time.approve',
      );
    }

    const isPending = dto.decision === 'pending';
    const nowIso = new Date().toISOString();
    return this.repo.updateLogReviewByIds(uniqueLogIds, {
      status: dto.decision,
      reviewed_by: isPending ? null : userId,
      reviewed_at: isPending ? null : nowIso,
      review_note: isPending ? null : dto.reason?.trim() || null,
    });
  }

  async listMyLogs(
    userId: string,
    projectId: string,
    query: TimeLogsQueryDto,
  ): Promise<TimeLogsListResult> {
    await this.projectsService.assertProjectPermission(
      projectId,
      userId,
      'time.view',
    );
    await this.assertTimeRateEnabled(projectId, userId);
    const { page, limit } = this.normalizePaging(query);
    return this.repo.listProjectLogs(projectId, {
      page,
      limit,
      from: query.from,
      to: query.to,
      status: query.status,
      member_user_id: userId,
      task_id: query.task_id,
    });
  }

  async listApprovals(
    userId: string,
    projectId: string,
    query: TimeLogsQueryDto,
  ): Promise<TimeLogsListResult> {
    await this.projectsService.assertProjectPermission(
      projectId,
      userId,
      'time.approve',
    );
    const { page, limit } = this.normalizePaging(query);
    return this.repo.listProjectLogs(projectId, {
      page,
      limit,
      from: query.from,
      to: query.to,
      status: query.status,
      member_user_id: query.member_user_id,
      task_id: query.task_id,
    });
  }

  async listTeamLogs(
    userId: string,
    projectId: string,
    query: TimeLogsQueryDto,
  ): Promise<TimeLogsListResult> {
    await this.projectsService.assertProjectPermission(
      projectId,
      userId,
      'time.edit_team',
    );
    const { page, limit } = this.normalizePaging(query);
    return this.repo.listProjectLogs(projectId, {
      page,
      limit,
      from: query.from,
      to: query.to,
      status: query.status,
      member_user_id: query.member_user_id,
      task_id: query.task_id,
    });
  }

  async listMyTaskLogs(
    userId: string,
    projectId: string,
    taskId: string,
    query: TimeLogsQueryDto,
  ): Promise<TimeLogsListResult> {
    await this.projectsService.assertProjectPermission(
      projectId,
      userId,
      'time.view',
    );
    await this.assertTimeRateEnabled(projectId, userId);
    await this.assertTaskBelongsToProject(taskId, projectId);
    const { page, limit } = this.normalizePaging(query);
    return this.repo.listTaskLogsForMember({
      projectId,
      taskId,
      memberUserId: userId,
      page,
      limit,
    });
  }
}
