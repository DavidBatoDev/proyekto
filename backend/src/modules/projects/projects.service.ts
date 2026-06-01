import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import {
  AppCacheStatus,
  RedisDataCacheService,
} from '../../common/cache/redis-data-cache.service';
import { REDIS_CACHE_KEYS } from '../../common/cache/redis-cache.keys';
import { RedisCacheInvalidationService } from '../../common/cache/redis-cache-invalidation.service';
import { ProjectTeamsService } from '../teams/project-teams.service';
export const PROJECTS_REPOSITORY = Symbol('PROJECTS_REPOSITORY');
import type { ProjectsRepository } from './repositories/projects.repository.interface';
import {
  ProjectAuthorizationService,
  type ProjectRole,
} from './authorization/project-authorization.service';
import { MissingPermissionException } from './authorization/missing-permission.exception';
import {
  AddProjectMemberDto,
  CreateProjectDto,
  CreateProjectResourceFolderDto,
  CreateProjectResourceLinkDto,
  InviteProjectByEmailDto,
  ProjectDashboardSummaryQueryDto,
  ProjectInviteQueryDto,
  ReassignProjectConsultantDto,
  UpdateRolePermissionsDto,
  ReorderProjectResourceFoldersDto,
  ReorderProjectResourceLinksDto,
  RespondProjectInviteDto,
  TransferProjectOwnerDto,
  UpdateProjectDto,
  UpdateProjectMemberDto,
  UpdateProjectMemberPermissionsDto,
  UpdateProjectResourceFolderDto,
  UpdateProjectResourceLinkDto,
} from './dto/project.dto';
import { Project } from '../../common/entities';
import { NotificationsService } from '../notifications/notifications.service';
import { ProjectAccessSyncService } from './access-sync/access-sync.service';
import {
  type PermissionPath,
  type ProjectPermissions,
  diffCapabilities,
  getPermission as getResolvedPermission,
  resolvePermissions,
  setPermission,
  validateDependencies,
} from './permissions/project-permissions';
import type { ProjectShareOrigin } from './authorization/project-authorization.service';
import type {
  ProjectResourceFolderWithLinks,
  ProjectResourcesPayload,
} from './repositories/projects.repository.interface';

interface CacheReadOptions {
  onCacheStatus?: (status: AppCacheStatus) => void;
}

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    @Inject(PROJECTS_REPOSITORY)
    private readonly projectsRepo: ProjectsRepository,
    private readonly notificationsService: NotificationsService,
    private readonly authorization: ProjectAuthorizationService,
    @Inject(forwardRef(() => ProjectTeamsService))
    private readonly projectTeams: ProjectTeamsService,
    private readonly accessSync: ProjectAccessSyncService,
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly cache: RedisDataCacheService,
    private readonly cacheInvalidation: RedisCacheInvalidationService,
    private readonly config: ConfigService,
  ) {}

  private async invalidateDashboardCache(): Promise<void> {
    await this.cacheInvalidation.invalidateAllDashboardCache();
  }

  private async createDefaultRoadmap(
    projectId: string,
    userId: string,
    projectTitle: string | null | undefined,
  ): Promise<{ id: string; name: string }> {
    const name =
      projectTitle && projectTitle.trim().length > 0
        ? projectTitle.trim().slice(0, 200)
        : 'Untitled roadmap';
    const { data, error } = await this.supabase
      .from('roadmaps')
      .insert({
        name,
        project_id: projectId,
        owner_id: userId,
        status: 'draft',
      })
      .select('id, name')
      .single();
    if (error || !data) {
      throw new Error(
        `Failed to create default roadmap for project ${projectId}: ${
          error?.message ?? 'unknown error'
        }`,
      );
    }
    return data as { id: string; name: string };
  }

  /** Best-effort sync — never blocks the calling write. The yoke rule
   * is recoverable on the next mutation that calls syncUser. */
  private async safeSync(projectId: string, userId: string): Promise<void> {
    try {
      await this.accessSync.syncUser(projectId, userId);
    } catch (err) {
      this.logger.warn(
        `safeSync(${projectId}, ${userId}) failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Returns true when the caller has `owner` or `admin` role on the project.
   * Replaces the legacy `callerId === client_id || callerId === consultant_id`
   * "isLead" short-circuit. The legacy check assumed there were exactly two
   * privileged users (the persona-based lead pair); the new check works for
   * any user with the right role grant in project_shares.
   */
  private async isProjectPrivileged(
    callerId: string,
    projectId: string,
  ): Promise<boolean> {
    const role = await this.authorization.getUserProjectRole(
      callerId,
      projectId,
    );
    return role === 'owner' || role === 'admin';
  }

  private async emitNotification(
    payload: Parameters<NotificationsService['createNotification']>[0],
  ): Promise<void> {
    try {
      await this.notificationsService.createNotification(payload);
    } catch {
      return;
    }
  }

  private buildInviteReceivedMessage(params: {
    inviterName: string;
    projectTitle: string;
    invitedPosition?: string | null;
    note?: string | null;
  }): string {
    const positionText =
      params.invitedPosition && params.invitedPosition.trim().length > 0
        ? ` as ${params.invitedPosition.trim()}`
        : '';
    const noteText =
      params.note && params.note.trim().length > 0
        ? ` Note: ${params.note.trim()}`
        : '';

    return `${params.inviterName} invited you to join ${params.projectTitle}${positionText}.${noteText}`;
  }

  private async getProjectOrThrow(projectId: string): Promise<Project> {
    const project = await this.projectsRepo.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');
    return project as Project;
  }

  /**
   * Synthesizes a "permissions" object from the caller's project_shares role
   * for legacy controller endpoints (getMemberPermissions, getMyPermissions)
   * that the frontend still expects to return a fine-grained permissions
   * shape. Maps owner/admin → all-true, editor → edit-rights, commenter →
   * comment-rights, viewer → read-only.
   *
   * The legacy permissions_json system is gone; this is a backwards-compat
   * synthesizer so the frontend permission UI keeps showing sensible
   * checkboxes derived from role.
   */
  private synthesizePermissionsFromRole(
    role: ProjectRole,
  ): ProjectPermissions {
    const isOwnerOrAdmin = role === 'owner' || role === 'admin';
    const canEdit = isOwnerOrAdmin || role === 'editor';
    const canComment = canEdit || role === 'commenter';
    return {
      access: { view: true, edit: isOwnerOrAdmin, manage: isOwnerOrAdmin },
      roadmap: { view: true, comment: canComment, edit: canEdit },
      members: {
        view: true,
        manage: isOwnerOrAdmin,
        edit_permissions: isOwnerOrAdmin,
      },
      project: { view: true, edit: isOwnerOrAdmin, archive: isOwnerOrAdmin },
      time: {
        view: true,
        view_financial: isOwnerOrAdmin,
        log: canEdit,
        edit_own: canEdit,
        edit_team: isOwnerOrAdmin,
        approve: isOwnerOrAdmin,
        manage_rates: isOwnerOrAdmin,
        delete_logs: isOwnerOrAdmin,
      },
      chat: {
        view_channels: true,
        send_messages: canComment,
        create_channels: isOwnerOrAdmin,
        manage_channels: isOwnerOrAdmin,
        view_internal_channels: isOwnerOrAdmin,
        mention_members: canComment,
        share_files: canEdit,
        start_dm: canComment,
        send_dm: canComment,
        message_clients: true,
        message_consultants: true,
        message_freelancers: true,
      },
      resources: { view: true, upload: canEdit, delete: isOwnerOrAdmin },
      logs: { view: true, view_sensitive: isOwnerOrAdmin },
    } as unknown as ProjectPermissions;
  }

  private async assertCanManageMembers(
    project: Project,
    callerId: string,
  ): Promise<void> {
    // Tech-debt cleanup: legacy permissions_json fallback removed. Member
    // management requires admin+ role on project_shares.
    await this.authorization.assertRole(callerId, project.id, 'admin');
  }

  private async assertCanAccessProjectResources(
    projectId: string,
    callerId: string,
  ): Promise<Project> {
    const project = await this.getProjectOrThrow(projectId);
    const isPrivileged = await this.isProjectPrivileged(callerId, projectId);

    if (isPrivileged) {
      return project;
    }

    const member = await this.projectsRepo.getMemberByProjectAndUserId(
      projectId,
      callerId,
    );

    if (!member) {
      throw new MissingPermissionException({
        path: 'resources.view',
        label: 'manage project resources',
      });
    }

    return project;
  }

  /**
   * Map a legacy permission path to a minimum project_shares role.
   *
   * The old fine-grained permissions_json system is gone; each path now
   * corresponds to the role that should be allowed to perform the action.
   * Conservative defaults: read-style perms allow viewer+, write/manage
   * perms require admin+.
   *
   * Unknown permission paths default to 'admin' as a fail-safe.
   */
  private permissionToMinRole(permission: PermissionPath): ProjectRole {
    const map: Record<string, ProjectRole> = {
      // Members
      'members.view': 'viewer',
      'members.manage': 'admin',
      'members.edit_permissions': 'admin',
      // Teams (structural attach/detach gate)
      'teams.view': 'viewer',
      'teams.manage': 'admin',
      // Roadmap
      'roadmap.comment': 'commenter',
      'roadmap.edit': 'editor',
    };
    return map[permission as string] ?? 'admin';
  }

  /**
   * Permission-path enforcement. Routes through the resolver
   * (`role baseline ⊕ origin delta ⊕ capabilities`) so per-row capability
   * overrides actually gate access. The legacy `permissionToMinRole` map
   * is kept as a fail-safe for paths the resolver doesn't recognise but
   * is no longer the primary check.
   */
  async assertProjectPermission(
    projectId: string,
    userId: string,
    permission: PermissionPath,
  ): Promise<void> {
    await this.getProjectOrThrow(projectId); // 404 surface stays the same
    await this.authorization.assertPermission(userId, projectId, permission);
  }

  async assertProjectAnyPermission(
    projectId: string,
    userId: string,
    permissionsToCheck: Array<PermissionPath>,
  ): Promise<void> {
    await this.getProjectOrThrow(projectId);
    const perms = await this.authorization.resolvePermissions(
      userId,
      projectId,
    );
    if (!perms) {
      throw new MissingPermissionException({
        path: null,
        message: 'You are not a member of this project.',
      });
    }
    const passes = permissionsToCheck.some((p) =>
      getResolvedPermission(perms, p),
    );
    if (!passes) {
      // Surface the first listed path so the FE can render a canonical
      // label; the message lists the full OR chain for context.
      throw new MissingPermissionException({
        path: permissionsToCheck[0],
        message: `Missing required permission: ${permissionsToCheck.join(' OR ')}.`,
      });
    }
  }

  async listUserProjects(userId: string): Promise<Project[]> {
    return this.projectsRepo.findByUser(userId);
  }

  async listDashboardProjects(
    userId: string,
    options?: CacheReadOptions,
  ): Promise<Project[]> {
    return this.cache.rememberJson(
      REDIS_CACHE_KEYS.projectsDashboardByUser(userId),
      this.cache.getDashboardTtlSeconds(),
      async () => this.projectsRepo.findDashboardByUser(userId),
      {
        onStatus: options?.onCacheStatus,
        indexKey: REDIS_CACHE_KEYS.projectsDashboardIndex,
      },
    );
  }

  async getDashboardSummary(
    userId: string,
    query: ProjectDashboardSummaryQueryDto,
  ): Promise<{
    filters: {
      from: string | null;
      to: string | null;
      project_id: string | null;
      team_id: string | null;
      member_user_id: string | null;
    };
    time: {
      total_logs: number;
      total_seconds: number;
      total_hours: number;
      status_counts: Record<string, number>;
      total_fees: number;
    };
    overtime: {
      over_limit_windows: number;
      overage_hours_total: number;
    };
    invoices: {
      total_count: number;
      total_amount: number;
      status_counts: Record<string, number>;
    };
  }> {
    if (query.project_id) {
      await this.authorization.assertRole(userId, query.project_id, 'viewer');
    }
    if (query.team_id) {
      const { data: team, error: teamErr } = await this.supabase
        .from('teams')
        .select('id, owner_id')
        .eq('id', query.team_id)
        .maybeSingle();
      if (teamErr) throw new Error(teamErr.message);
      if (!team) throw new NotFoundException('Team not found');
      if (team.owner_id !== userId) {
        const { count, error: memberErr } = await this.supabase
          .from('team_members')
          .select('*', { count: 'exact', head: true })
          .eq('team_id', query.team_id)
          .eq('user_id', userId);
        if (memberErr) throw new Error(memberErr.message);
        if (!count) {
          throw new MissingPermissionException({
            path: null,
            message: 'You do not have access to this team.',
          });
        }
      }
    }

    let projectIds: string[] = [];
    if (query.project_id) {
      projectIds = [query.project_id];
    } else {
      const { data: accessRows, error: accessErr } = await this.supabase
        .from('project_access')
        .select('project_id')
        .eq('user_id', userId);
      if (accessErr) throw new Error(accessErr.message);
      projectIds = Array.from(
        new Set(
          (accessRows ?? []).map((row: { project_id: string }) => row.project_id),
        ),
      );
    }

    if (projectIds.length === 0) {
      return {
        filters: {
          from: query.from ?? null,
          to: query.to ?? null,
          project_id: query.project_id ?? null,
          team_id: query.team_id ?? null,
          member_user_id: query.member_user_id ?? null,
        },
        time: {
          total_logs: 0,
          total_seconds: 0,
          total_hours: 0,
          status_counts: {
            pending: 0,
            approved: 0,
            paid: 0,
            rejected: 0,
          },
          total_fees: 0,
        },
        overtime: {
          over_limit_windows: 0,
          overage_hours_total: 0,
        },
        invoices: {
          total_count: 0,
          total_amount: 0,
          status_counts: {
            draft: 0,
            issued: 0,
            sent: 0,
            paid: 0,
            void: 0,
          },
        },
      };
    }

    let logsQuery = this.supabase
      .from('task_time_logs')
      .select(
        'id, project_id, team_id, member_user_id, started_at, duration_seconds, status, rate_snapshot',
      )
      .in('project_id', projectIds);
    if (query.from) logsQuery = logsQuery.gte('started_at', query.from);
    if (query.to) logsQuery = logsQuery.lte('started_at', query.to);
    if (query.team_id) logsQuery = logsQuery.eq('team_id', query.team_id);
    if (query.member_user_id) {
      logsQuery = logsQuery.eq('member_user_id', query.member_user_id);
    }

    const { data: logRows, error: logsErr } = await logsQuery;
    if (logsErr) throw new Error(logsErr.message);
    const logs = (logRows ?? []) as Array<{
      id: string;
      project_id: string;
      team_id: string | null;
      member_user_id: string;
      started_at: string;
      duration_seconds: number | null;
      status: 'pending' | 'approved' | 'paid' | 'rejected';
      rate_snapshot: number | null;
    }>;

    const statusCounts: Record<string, number> = {
      pending: 0,
      approved: 0,
      paid: 0,
      rejected: 0,
    };
    let totalSeconds = 0;
    let totalFees = 0;
    for (const row of logs) {
      statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
      const seconds = Math.max(0, Number(row.duration_seconds ?? 0));
      totalSeconds += seconds;
      totalFees += (seconds / 3600) * Number(row.rate_snapshot ?? 0);
    }

    const rateKeys = Array.from(
      new Set(
        logs
          .filter((row) => row.team_id)
          .map((row) => `${row.team_id}|${row.project_id}|${row.member_user_id}`),
      ),
    );
    const rateMap = new Map<
      string,
      { weekly: number | null; monthly: number | null }
    >();
    if (rateKeys.length > 0) {
      const teamIds = Array.from(
        new Set(rateKeys.map((key) => key.split('|')[0]).filter(Boolean)),
      );
      const memberIds = Array.from(new Set(rateKeys.map((key) => key.split('|')[2])));
      let rateQuery = this.supabase
        .from('team_member_rates')
        .select(
          'team_id, project_id, user_id, weekly_limit_hours, monthly_limit_hours',
        )
        .is('end_date', null)
        .in('team_id', teamIds)
        .in('user_id', memberIds);
      if (query.project_id) rateQuery = rateQuery.eq('project_id', query.project_id);
      const { data: rateRows, error: ratesErr } = await rateQuery;
      if (ratesErr) throw new Error(ratesErr.message);
      for (const row of (rateRows ?? []) as Array<{
        team_id: string;
        project_id: string;
        user_id: string;
        weekly_limit_hours: number | null;
        monthly_limit_hours: number | null;
      }>) {
        rateMap.set(`${row.team_id}|${row.project_id}|${row.user_id}`, {
          weekly:
            row.weekly_limit_hours === null || row.weekly_limit_hours === undefined
              ? null
              : Number(row.weekly_limit_hours),
          monthly:
            row.monthly_limit_hours === null ||
            row.monthly_limit_hours === undefined
              ? null
              : Number(row.monthly_limit_hours),
        });
      }
    }

    const weeklyTotals = new Map<string, number>();
    const monthlyTotals = new Map<string, number>();
    for (const row of logs) {
      if (!row.team_id || row.status === 'rejected') continue;
      const rateKey = `${row.team_id}|${row.project_id}|${row.member_user_id}`;
      if (!rateMap.has(rateKey)) continue;
      const startedAt = new Date(row.started_at);
      if (Number.isNaN(startedAt.getTime())) continue;
      const seconds = Math.max(0, Number(row.duration_seconds ?? 0));
      const hours = seconds / 3600;

      const day = startedAt.getUTCDay();
      const diffToMonday = (day + 6) % 7;
      const weekStart = new Date(
        Date.UTC(
          startedAt.getUTCFullYear(),
          startedAt.getUTCMonth(),
          startedAt.getUTCDate(),
        ),
      );
      weekStart.setUTCDate(weekStart.getUTCDate() - diffToMonday);
      const weekKey = `${rateKey}|w|${weekStart.toISOString().slice(0, 10)}`;
      weeklyTotals.set(weekKey, (weeklyTotals.get(weekKey) ?? 0) + hours);

      const monthKey = `${rateKey}|m|${startedAt.getUTCFullYear()}-${String(
        startedAt.getUTCMonth() + 1,
      ).padStart(2, '0')}`;
      monthlyTotals.set(monthKey, (monthlyTotals.get(monthKey) ?? 0) + hours);
    }

    let overLimitWindows = 0;
    let overageHoursTotal = 0;
    for (const [key, hours] of weeklyTotals.entries()) {
      const rateKey = key.split('|w|')[0];
      const rate = rateMap.get(rateKey);
      const limit = rate?.weekly ?? null;
      if (limit !== null && hours > limit) {
        overLimitWindows += 1;
        overageHoursTotal += hours - limit;
      }
    }
    for (const [key, hours] of monthlyTotals.entries()) {
      const rateKey = key.split('|m|')[0];
      const rate = rateMap.get(rateKey);
      const limit = rate?.monthly ?? null;
      if (limit !== null && hours > limit) {
        overLimitWindows += 1;
        overageHoursTotal += hours - limit;
      }
    }

    let invoicesQuery = this.supabase
      .from('invoices')
      .select('status, total, project_id, created_at')
      .in('project_id', projectIds);
    if (query.from) invoicesQuery = invoicesQuery.gte('created_at', query.from);
    if (query.to) invoicesQuery = invoicesQuery.lte('created_at', query.to);
    const { data: invoiceRows, error: invErr } = await invoicesQuery;
    if (invErr) throw new Error(invErr.message);
    const invoices = (invoiceRows ?? []) as Array<{
      status: string;
      total: string | number;
    }>;
    const invoiceStatusCounts: Record<string, number> = {
      draft: 0,
      issued: 0,
      sent: 0,
      paid: 0,
      void: 0,
    };
    let invoiceTotalAmount = 0;
    for (const row of invoices) {
      invoiceStatusCounts[row.status] = (invoiceStatusCounts[row.status] ?? 0) + 1;
      invoiceTotalAmount += Number(row.total ?? 0);
    }

    return {
      filters: {
        from: query.from ?? null,
        to: query.to ?? null,
        project_id: query.project_id ?? null,
        team_id: query.team_id ?? null,
        member_user_id: query.member_user_id ?? null,
      },
      time: {
        total_logs: logs.length,
        total_seconds: totalSeconds,
        total_hours: totalSeconds / 3600,
        status_counts: statusCounts,
        total_fees: invoiceRound(totalFees),
      },
      overtime: {
        over_limit_windows: overLimitWindows,
        overage_hours_total: invoiceRound(overageHoursTotal),
      },
      invoices: {
        total_count: invoices.length,
        total_amount: invoiceRound(invoiceTotalAmount),
        status_counts: invoiceStatusCounts,
      },
    };
  }

  async getProject(id: string) {
    const project = await this.projectsRepo.findById(id);
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async createProject(
    userId: string,
    dto: CreateProjectDto,
  ): Promise<{ project: Project; roadmap: { id: string; name: string } }> {
    const profile =
      await this.projectsRepo.getCreatorProfileForProjectCreation(userId);

    if (!profile) {
      throw new ForbiddenException('Profile not found');
    }

    const creationMode = dto.creation_mode ?? 'client';

    if (creationMode === 'client') {
      if (profile.active_persona !== 'client') {
        throw new ForbiddenException(
          'Client mode requires the client active persona.',
        );
      }
      const project = await this.projectsRepo.create(userId, {
        ...dto,
        creation_mode: 'client',
      });
      // Marketplace project created by a client: client gets admin role.
      // No owner exists until a consultant joins (per design.md).
      await this.authorization.grant({
        projectId: project.id,
        userId,
        role: 'admin',
        origin: 'client',
        grantedBy: userId,
      });
      await this.safeSync(project.id, userId);
      const roadmap = await this.attachDefaultRoadmapOrRollback(
        project.id,
        userId,
        project.title,
      );
      await this.invalidateDashboardCache();
      return { project, roadmap };
    }

    if (!profile.is_consultant_verified) {
      throw new ForbiddenException(
        'Consultant mode requires a verified consultant account.',
      );
    }

    if (dto.status && dto.status !== 'draft') {
      throw new BadRequestException(
        'Consultant mode only supports draft status at creation time.',
      );
    }

    const project = await this.projectsRepo.create(userId, {
      ...dto,
      creation_mode: 'consultant',
      status: 'draft',
    });
    // Project created in consultant mode: the creator IS the consultant
    // and gets owner role from the start.
    await this.authorization.grant({
      projectId: project.id,
      userId,
      role: 'owner',
      origin: 'consultant',
      grantedBy: userId,
    });
    await this.safeSync(project.id, userId);

    // If the picker passed a team, attach it as primary with the
    // consultant curated as the only initial member. Failures here are
    // non-fatal: the project itself was already created and the
    // consultant can attach a team later from project settings.
    if (dto.primary_team_id) {
      try {
        await this.projectTeams.attach(project.id, userId, {
          team_id: dto.primary_team_id,
          is_primary: true,
          members: [{ user_id: userId, role: 'editor' }],
        });
      } catch (err) {
        this.logger.error(
          `Failed to attach primary_team_id=${dto.primary_team_id} on project ${project.id} create (user ${userId}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const roadmap = await this.attachDefaultRoadmapOrRollback(
      project.id,
      userId,
      project.title,
    );
    await this.invalidateDashboardCache();
    return { project, roadmap };
  }

  private async attachDefaultRoadmapOrRollback(
    projectId: string,
    userId: string,
    projectTitle: string | null | undefined,
  ): Promise<{ id: string; name: string }> {
    try {
      return await this.createDefaultRoadmap(projectId, userId, projectTitle);
    } catch (err) {
      this.logger.error(
        `Default roadmap creation failed for project ${projectId}; rolling back project. Cause: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      try {
        await this.projectsRepo.deleteProject(projectId);
      } catch (rollbackErr) {
        this.logger.error(
          `Rollback delete failed for project ${projectId}: ${
            rollbackErr instanceof Error
              ? rollbackErr.message
              : String(rollbackErr)
          }`,
        );
      }
      throw new BadRequestException(
        'Project created but default roadmap could not be initialized. Please retry.',
      );
    }
  }

  async updateProject(
    id: string,
    userId: string,
    dto: UpdateProjectDto,
  ): Promise<Project> {
    const isOwner = await this.projectsRepo.isOwner(id, userId);
    if (!isOwner)
      throw new MissingPermissionException({
        path: null,
        requiredRole: 'owner',
        label: 'update this project',
      });
    const updated = await this.projectsRepo.update(id, dto);
    await this.invalidateDashboardCache();
    return updated;
  }

  async deleteProject(id: string, userId: string): Promise<void> {
    const project = await this.getProjectOrThrow(id);

    if (project.client_id !== userId) {
      throw new MissingPermissionException({
        path: null,
        requiredRole: 'owner',
        label: 'delete this project',
      });
    }

    await this.projectsRepo.deleteProject(id);
    await this.invalidateDashboardCache();
  }

  async transferProjectOwner(
    projectId: string,
    callerId: string,
    dto: TransferProjectOwnerDto,
  ): Promise<Project> {
    const project = await this.getProjectOrThrow(projectId);

    if (project.client_id !== callerId) {
      throw new MissingPermissionException({
        path: null,
        requiredRole: 'owner',
        label: 'transfer project ownership',
      });
    }

    const newOwnerId = dto.new_owner_id;

    if (newOwnerId === project.client_id) {
      throw new BadRequestException(
        'Selected user is already the project owner.',
      );
    }

    const targetMembership =
      await this.projectsRepo.getMemberByProjectAndUserId(
        projectId,
        newOwnerId,
      );

    if (!targetMembership) {
      throw new BadRequestException(
        'New owner must already be a member of this project.',
      );
    }

    const updatedProject = await this.projectsRepo.transferOwner(
      projectId,
      project.client_id,
      newOwnerId,
    );

    await this.emitNotification({
      user_id: newOwnerId,
      project_id: projectId,
      type_name: 'project_updated',
      actor_id: callerId,
      content: {
        message: `You are now the project owner for ${project.title}.`,
        previous_owner_id: project.client_id,
      },
      link_url: `/project/${projectId}/team`,
    });

    await this.invalidateDashboardCache();
    return updatedProject;
  }

  async assignConsultant(
    projectId: string,
    consultantId: string,
  ): Promise<Project> {
    const project = await this.projectsRepo.assignConsultant(
      projectId,
      consultantId,
    );
    // Auto-grant: assigned consultant becomes project owner.
    // The pre-existing client (admin role) is unchanged — owner > admin so
    // the consultant naturally outranks the client. Multi-owner projects
    // are supported per design.
    await this.authorization.grant({
      projectId,
      userId: consultantId,
      role: 'owner',
      origin: 'consultant',
      grantedBy: consultantId,
    });
    await this.safeSync(projectId, consultantId);
    await this.invalidateDashboardCache();
    return project;
  }

  async reassignProjectConsultant(
    projectId: string,
    callerId: string,
    dto: ReassignProjectConsultantDto,
  ): Promise<Project> {
    const project = await this.getProjectOrThrow(projectId);
    if (!(await this.isProjectPrivileged(callerId, projectId))) {
      throw new MissingPermissionException({
        path: null,
        requiredRole: 'admin',
        label: 'reassign the consultant',
      });
    }

    const newConsultantId = dto.new_consultant_id;
    const previousConsultantId = project.consultant_id ?? null;

    if (newConsultantId === previousConsultantId) {
      throw new BadRequestException(
        'Selected user is already the current consultant.',
      );
    }

    const targetMembership =
      await this.projectsRepo.getMemberByProjectAndUserId(
        projectId,
        newConsultantId,
      );

    if (!targetMembership) {
      throw new BadRequestException(
        'New consultant must already be a member of this project.',
      );
    }

    const isVerified =
      await this.projectsRepo.isConsultantVerified(newConsultantId);
    if (!isVerified) {
      throw new BadRequestException(
        'Selected member is not a verified consultant.',
      );
    }

    const updatedProject = await this.projectsRepo.reassignConsultant(
      projectId,
      project.client_id,
      previousConsultantId,
      newConsultantId,
    );

    // Sync project_shares with the consultant change:
    // - new consultant gets owner role with origin='consultant'
    // - previous consultant (if any) is revoked. Last-owner protection in
    //   ProjectAuthorizationService.revoke ensures we never orphan the
    //   project — if removing the previous consultant would leave 0 owners,
    //   the revoke throws and we keep them as a co-owner.
    await this.authorization.grant({
      projectId,
      userId: newConsultantId,
      role: 'owner',
      origin: 'consultant',
      grantedBy: callerId,
    });
    await this.safeSync(projectId, newConsultantId);
    if (previousConsultantId && previousConsultantId !== newConsultantId) {
      try {
        await this.authorization.revoke(projectId, previousConsultantId);
        await this.safeSync(projectId, previousConsultantId);
      } catch (err) {
        // Last-owner protection — leave the previous consultant in place
        // rather than orphaning. They remain a co-owner alongside the new
        // consultant; admin can demote them later from team settings.
        // eslint-disable-next-line no-console
        console.warn(
          `Could not revoke previous consultant ${previousConsultantId} on ${projectId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    await this.emitNotification({
      user_id: newConsultantId,
      project_id: projectId,
      type_name: 'project_updated',
      actor_id: callerId,
      content: {
        message: `You are now the consultant for ${project.title}.`,
        previous_consultant_id: previousConsultantId,
      },
      link_url: `/project/${projectId}/team`,
    });

    await this.invalidateDashboardCache();
    return updatedProject;
  }

  async addMember(
    projectId: string,
    callerId: string,
    dto: AddProjectMemberDto,
  ): Promise<unknown> {
    const project = await this.getProjectOrThrow(projectId);
    await this.assertCanManageMembers(project, callerId);
    const member = await this.projectsRepo.addMember(projectId, dto);
    await this.invalidateDashboardCache();
    return member;
  }

  private async getGmailAccessToken(
    clientId: string,
    clientSecret: string,
    refreshToken: string,
  ): Promise<string> {
    const body = new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    });
    if (!res.ok) throw new Error(`Gmail token refresh failed: ${await res.text()}`);
    const { access_token } = await res.json() as { access_token: string };
    return access_token;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private sanitizeHeaderValue(value: string): string {
    return value.replace(/[\r\n]+/g, ' ').trim();
  }

  private buildInviteEmailRaw(
    to: string,
    fromEmail: string | null | undefined,
    inviterName: string,
    projectName: string,
    inviteLink: string,
    invitedPosition?: string | null,
    inviteMessage?: string | null,
  ): string {
    const normalizedFromEmail = (fromEmail ?? '').trim();
    const fromHeader =
      normalizedFromEmail.length > 0
        ? `From: ${this.sanitizeHeaderValue(`Proyekto <${normalizedFromEmail}>`)}`
        : null;
    const safeInviterName = this.escapeHtml(inviterName.trim());
    const safeProjectName = this.escapeHtml(projectName.trim());
    const safeInviteLink = this.escapeHtml(inviteLink.trim());
    const normalizedPosition = invitedPosition?.trim() ?? '';
    const normalizedNote = inviteMessage?.trim() ?? '';
    const safePosition =
      normalizedPosition.length > 0
        ? this.escapeHtml(normalizedPosition)
        : null;
    const safeNote =
      normalizedNote.length > 0 ? this.escapeHtml(normalizedNote) : null;

    const subject = `${inviterName} invited you to collaborate on ${projectName}`;
    const previewText = `${inviterName} invited you to join ${projectName} on Proyekto.`;
    const safePreviewText = this.escapeHtml(previewText);
    const positionBlock = safePosition
      ? `
                      <p style="margin:14px 0 4px;color:#64748b;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Role</p>
                      <p style="margin:0;color:#0f172a;font-size:15px;line-height:1.4;font-weight:600;">${safePosition}</p>
      `
      : '';
    const noteBlock = safeNote
      ? `
                <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 22px;background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;">
                  <tr>
                    <td style="padding:14px 16px;">
                      <p style="margin:0 0 6px;color:#1e3a8a;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Personal note</p>
                      <p style="margin:0;color:#1e293b;font-size:14px;line-height:1.6;">${safeNote}</p>
                    </td>
                  </tr>
                </table>
      `
      : '';

    const textLines: string[] = [
      `${inviterName} invited you to collaborate on ${projectName} in Proyekto.`,
      '',
      'Open your invitation:',
      inviteLink,
      '',
      'Project:',
      projectName,
    ];
    if (normalizedPosition.length > 0) {
      textLines.push(`Role: ${normalizedPosition}`);
    }
    if (normalizedNote.length > 0) {
      textLines.push('', `Personal note: ${normalizedNote}`);
    }
    textLines.push(
      '',
      'If you do not have an account yet, sign up first with this email address and your invitation will be waiting for you.',
      'If the button does not work, copy and paste the link above into your browser.',
      '',
      'You received this email because someone invited you to a project on Proyekto.',
    );
    const textBody = textLines.join('\n');

    const html = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Project invitation</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safePreviewText}</div>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f1f5f9;padding:28px 12px;">
      <tr>
        <td align="center">
          <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:26px 32px;background-color:#0f172a;">
                <p style="margin:0 0 10px;color:#93c5fd;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">Proyekto</p>
                <h1 style="margin:0 0 10px;color:#ffffff;font-size:28px;line-height:1.2;font-weight:700;">You are invited to collaborate</h1>
                <p style="margin:0;color:#cbd5e1;font-size:15px;line-height:1.6;">
                  <strong style="color:#ffffff;">${safeInviterName}</strong> invited you to join
                  <strong style="color:#ffffff;">${safeProjectName}</strong>.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 32px;">
                <p style="margin:0 0 18px;color:#334155;font-size:15px;line-height:1.6;">
                  Open your invitation to review the project and start collaborating.
                </p>
                <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 22px;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
                  <tr>
                    <td style="padding:16px 18px;">
                      <p style="margin:0 0 4px;color:#64748b;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Project</p>
                      <p style="margin:0;color:#0f172a;font-size:16px;line-height:1.5;font-weight:700;">${safeProjectName}</p>
                      ${positionBlock}
                    </td>
                  </tr>
                </table>
                ${noteBlock}
                <div style="margin:30px 0;text-align:center;">
                  <a href="${safeInviteLink}" style="display:inline-block;padding:14px 28px;background-color:#2563eb;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;">Open Invitation</a>
                </div>
                <p style="margin:0 0 12px;color:#475569;font-size:13px;line-height:1.6;">
                  If you do not have an account yet, sign up first with this email address and your invitation will be waiting for you.
                </p>
                <p style="margin:0 0 8px;color:#64748b;font-size:12px;line-height:1.5;">Button not working? Copy and paste this link:</p>
                <p style="margin:0;line-height:1.6;">
                  <a href="${safeInviteLink}" style="color:#1d4ed8;font-size:12px;text-decoration:underline;word-break:break-all;">${safeInviteLink}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 24px;background-color:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
                <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;">
                  You received this email because someone invited you to a project on Proyekto.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();

    const boundary = `invite_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const rawLines = [
      fromHeader,
      `To: ${this.sanitizeHeaderValue(to)}`,
      `Subject: ${this.sanitizeHeaderValue(subject)}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      textBody,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      html,
      '',
      `--${boundary}--`,
      '',
    ].filter((line): line is string => line !== null);
    const raw = rawLines.join('\r\n');

    return Buffer.from(raw).toString('base64url');
  }

  private async sendInviteEmail(payload: {
    to: string;
    inviterName: string;
    projectName: string;
    invitedPosition?: string | null;
    inviteMessage?: string | null;
  }): Promise<{ sent: boolean; reason?: string; messageId?: string }> {
    const clientId =
      this.config.get<string>('GMAIL_CLIENT_ID') ??
      this.config.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret =
      this.config.get<string>('GMAIL_CLIENT_SECRET') ??
      this.config.get<string>('GOOGLE_CLIENT_SECRET');
    const refreshToken =
      this.config.get<string>('GMAIL_REFRESH_TOKEN') ??
      this.config.get<string>('GOOGLE_REFRESH_TOKEN');
    const fromEmail =
      this.config.get<string>('INVITE_FROM_EMAIL') ??
      this.config.get<string>('GMAIL_FROM_EMAIL') ??
      '';
    if (!clientId || !clientSecret || !refreshToken) {
      this.logger.warn(
        'sendInviteEmail: Gmail credentials not configured (set GMAIL_* or GOOGLE_* env vars)',
      );
      return {
        sent: false,
        reason:
          'Email service is not configured on the server (missing Gmail OAuth credentials).',
      };
    }

    const appUrl = this.config.get<string>('APP_URL', 'http://localhost:3000');
    const inviteLink = `${appUrl}/freelancer/invites`;

    try {
      const accessToken = await this.getGmailAccessToken(
        clientId,
        clientSecret,
        refreshToken,
      );
      const raw = this.buildInviteEmailRaw(
        payload.to,
        fromEmail,
        payload.inviterName,
        payload.projectName,
        inviteLink,
        payload.invitedPosition,
        payload.inviteMessage,
      );

      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      });

      if (!res.ok) {
        const err = await res.text();
        this.logger.warn(`sendInviteEmail: Gmail API error for ${payload.to}: ${err}`);
        return {
          sent: false,
          reason: `Gmail API rejected the message (${res.status}).`,
        };
      }

      const { id } = (await res.json()) as { id: string };
      this.logger.log(`sendInviteEmail: sent to ${payload.to} (messageId=${id})`);
      return { sent: true, messageId: id };
    } catch (err) {
      // Non-fatal - invite row is already created; log and continue.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `sendInviteEmail: failed for ${payload.to}: ${message}`,
      );
      return {
        sent: false,
        reason: `Email send failed: ${message}`,
      };
    }
  }

  async inviteByEmail(
    projectId: string,
    callerId: string,
    dto: InviteProjectByEmailDto,
  ): Promise<unknown> {
    const project = await this.getProjectOrThrow(projectId);
    await this.assertCanManageMembers(project, callerId);

    const invite = (await this.projectsRepo.inviteByEmail(
      projectId,
      callerId,
      dto,
    )) as Record<string, unknown>;

    const inviterName =
      (await this.projectsRepo.getProfileDisplayName(callerId)) ||
      'A team lead';

    // Send invite email and include delivery status in the API response.
    const inviteNote =
      typeof invite.message === 'string' && invite.message.trim().length > 0
        ? invite.message.trim()
        : null;
    const invitedPosition =
      typeof invite.invited_position === 'string' &&
      invite.invited_position.trim().length > 0
        ? invite.invited_position.trim()
        : null;
    const emailDelivery = await this.sendInviteEmail({
      to: dto.email.trim(),
      inviterName,
      projectName: typeof project.title === 'string' && project.title.trim()
        ? project.title.trim()
        : 'a project',
      invitedPosition,
      inviteMessage: inviteNote,
    });
    const projectTitle =
      typeof project.title === 'string' && project.title.trim().length > 0
        ? project.title.trim()
        : 'this project';
    const inviteMessage = this.buildInviteReceivedMessage({
      inviterName,
      projectTitle,
      invitedPosition,
      note: inviteNote,
    });

    if (typeof invite.invitee_id === 'string') {
      await this.emitNotification({
        user_id: invite.invitee_id,
        project_id: projectId,
        type_name: 'project_invite_received',
        actor_id: callerId,
        content: {
          invite_id: invite.id,
          message: inviteMessage,
          invited_position: invitedPosition,
          inviter_name: inviterName,
          project_title: projectTitle,
          note: inviteNote,
        },
        link_url: '/freelancer/invites',
      });
    }

    if (
      callerId === project.client_id &&
      project.consultant_id &&
      project.consultant_id !== callerId
    ) {
      await this.emitNotification({
        user_id: project.consultant_id,
        project_id: projectId,
        type_name: 'project_updated',
        actor_id: callerId,
        content: {
          message: `Client ${inviterName} has invited ${dto.email.trim()} to the project.`,
          invite_id: invite.id,
          invitee_email: dto.email.trim(),
          invited_position: invitedPosition,
        },
        link_url: `/project/${projectId}/team`,
      });
    }

    await this.invalidateDashboardCache();
    return {
      ...invite,
      email_delivery: emailDelivery,
    };
  }

  async listInvitesForUser(
    userId: string,
    query?: ProjectInviteQueryDto,
  ): Promise<unknown[]> {
    return this.projectsRepo.listInvitesForUser(userId, query);
  }

  async respondInvite(
    userId: string,
    inviteId: string,
    dto: RespondProjectInviteDto,
  ): Promise<unknown> {
    const result = (await this.projectsRepo.respondInvite(
      userId,
      inviteId,
      dto,
    )) as Record<string, unknown>;

    // On accept: grant the invitee a project_shares row using the invite's
    // default_role (set at invite time on /welcome slide 4 or in the team
    // settings invite UI). Editor is the fallback when no default_role was
    // recorded — matches the slice 1 invite UX default.
    if (
      result.status === 'accepted' &&
      typeof result.project_id === 'string'
    ) {
      const defaultRole =
        result.default_role === 'viewer' ? 'viewer' : 'editor';
      const grantedBy =
        typeof result.invited_by === 'string' ? result.invited_by : null;
      try {
        await this.authorization.grant({
          projectId: result.project_id,
          userId,
          role: defaultRole,
          origin: 'invited',
          grantedBy,
        });
        await this.safeSync(result.project_id, userId);
      } catch (err) {
        // Surface but don't block — the invite respond already persisted.
        // Operator can retry the grant from the team settings UI.
        // eslint-disable-next-line no-console
        console.error(
          `Failed to grant project_share for invite ${inviteId}:`,
          err,
        );
      }
    }

    if (typeof result.invited_by === 'string') {
      await this.emitNotification({
        user_id: result.invited_by,
        project_id:
          typeof result.project_id === 'string' ? result.project_id : undefined,
        type_name: 'project_invite_responded',
        actor_id: userId,
        content: {
          invite_id: inviteId,
          status: result.status,
        },
        link_url: '/project/' + String(result.project_id) + '/team',
      });
    }

    await this.invalidateDashboardCache();
    return result;
  }

  async listProjectInvites(
    callerId: string,
    projectId: string,
  ): Promise<unknown[]> {
    await this.assertProjectPermission(projectId, callerId, 'members.view');
    return this.projectsRepo.listProjectInvites(projectId);
  }

  async cancelInvite(
    callerId: string,
    projectId: string,
    inviteId: string,
  ): Promise<void> {
    await this.assertProjectPermission(projectId, callerId, 'members.manage');
    await this.projectsRepo.cancelInvite(projectId, inviteId);
    await this.invalidateDashboardCache();
  }

  async getRolePermissions(
    callerId: string,
    projectId: string,
    role: string,
  ): Promise<unknown> {
    await this.assertProjectPermission(projectId, callerId, 'members.edit_permissions');
    return this.projectsRepo.getRolePermissions(projectId, role);
  }

  async updateRolePermissions(
    callerId: string,
    projectId: string,
    dto: UpdateRolePermissionsDto,
  ): Promise<void> {
    // Tech-debt cleanup: legacy role-template editing is a no-op now since
    // permissions are derived from project_shares.role. We still gate the
    // endpoint behind admin+ to keep the API contract stable for the
    // frontend, but the persisted role_permissions_json (if any) is just
    // metadata — not used for authz.
    await this.assertProjectPermission(
      projectId,
      callerId,
      'members.edit_permissions',
    );
    await this.projectsRepo.updateRoleMemberPermissions(
      projectId,
      dto.role,
      dto.permissions as unknown as ProjectPermissions,
    );
  }

  async listProjectResources(
    projectId: string,
    callerId: string,
  ): Promise<ProjectResourcesPayload> {
    await this.assertCanAccessProjectResources(projectId, callerId);
    return this.projectsRepo.listProjectResources(projectId);
  }

  async createProjectResourceFolder(
    projectId: string,
    callerId: string,
    dto: CreateProjectResourceFolderDto,
  ): Promise<ProjectResourceFolderWithLinks> {
    await this.assertCanAccessProjectResources(projectId, callerId);
    const folder = await this.projectsRepo.createProjectResourceFolder(
      projectId,
      dto,
    );
    return { ...folder, links: [] };
  }

  async updateProjectResourceFolder(
    projectId: string,
    folderId: string,
    callerId: string,
    dto: UpdateProjectResourceFolderDto,
  ): Promise<ProjectResourceFolderWithLinks> {
    await this.assertCanAccessProjectResources(projectId, callerId);
    const folder = await this.projectsRepo.updateProjectResourceFolder(
      projectId,
      folderId,
      dto,
    );
    return { ...folder, links: [] };
  }

  async deleteProjectResourceFolder(
    projectId: string,
    folderId: string,
    callerId: string,
  ): Promise<void> {
    await this.assertCanAccessProjectResources(projectId, callerId);
    await this.projectsRepo.deleteProjectResourceFolder(projectId, folderId);
  }

  async reorderProjectResourceFolders(
    projectId: string,
    callerId: string,
    dto: ReorderProjectResourceFoldersDto,
  ) {
    await this.assertCanAccessProjectResources(projectId, callerId);
    return this.projectsRepo.reorderProjectResourceFolders(projectId, dto);
  }

  async createProjectResourceLink(
    projectId: string,
    callerId: string,
    dto: CreateProjectResourceLinkDto,
  ) {
    await this.assertCanAccessProjectResources(projectId, callerId);
    return this.projectsRepo.createProjectResourceLink(projectId, dto);
  }

  async updateProjectResourceLink(
    projectId: string,
    linkId: string,
    callerId: string,
    dto: UpdateProjectResourceLinkDto,
  ) {
    await this.assertCanAccessProjectResources(projectId, callerId);
    return this.projectsRepo.updateProjectResourceLink(projectId, linkId, dto);
  }

  async deleteProjectResourceLink(
    projectId: string,
    linkId: string,
    callerId: string,
  ): Promise<void> {
    await this.assertCanAccessProjectResources(projectId, callerId);
    await this.projectsRepo.deleteProjectResourceLink(projectId, linkId);
  }

  async reorderProjectResourceLinks(
    projectId: string,
    callerId: string,
    dto: ReorderProjectResourceLinksDto,
  ) {
    await this.assertCanAccessProjectResources(projectId, callerId);
    return this.projectsRepo.reorderProjectResourceLinks(projectId, dto);
  }

  async updateMember(
    projectId: string,
    memberId: string,
    callerId: string,
    dto: UpdateProjectMemberDto,
  ): Promise<unknown> {
    const project = await this.getProjectOrThrow(projectId);
    await this.assertCanManageMembers(project, callerId);
    const updatedMember = await this.projectsRepo.updateMember(
      projectId,
      memberId,
      dto,
    );
    await this.invalidateDashboardCache();
    return updatedMember;
  }

  async removeMember(
    projectId: string,
    memberId: string,
    callerId: string,
  ): Promise<void> {
    const project = await this.getProjectOrThrow(projectId);
    await this.assertCanManageMembers(project, callerId);
    const targetMember = await this.projectsRepo.getMemberById(
      projectId,
      memberId,
    );
    if (!targetMember) {
      throw new NotFoundException('Member not found');
    }
    if (targetMember.user_id && targetMember.user_id === callerId) {
      throw new ForbiddenException(
        'You cannot remove yourself from a project.',
      );
    }
    if (targetMember.user_id) {
      await this.authorization.assertActionOutranks(
        callerId,
        targetMember.user_id,
        projectId,
        'members.manage',
      );
      await this.projectsRepo.unassignTasksForMemberInProject(
        projectId,
        targetMember.user_id,
      );
    }

    await this.projectsRepo.removeMember(projectId, memberId);

    // Yoke: surviving rows for this user (other origins) recompute
    // their synced role to whatever's left. No-op if no rows survive.
    if (targetMember.user_id) {
      await this.safeSync(projectId, targetMember.user_id);
    }

    if (
      callerId === project.client_id &&
      project.consultant_id &&
      project.consultant_id !== callerId
    ) {
      const removedMemberName = targetMember.user_id
        ? await this.projectsRepo.getProfileDisplayName(targetMember.user_id)
        : null;

      await this.emitNotification({
        user_id: project.consultant_id,
        project_id: projectId,
        type_name: 'project_updated',
        actor_id: callerId,
        content: {
          message: `A member has been removed by the client.`,
          removed_member_id: targetMember.id,
          removed_user_id: targetMember.user_id,
          removed_member_role: targetMember.role,
          removed_member_name: removedMemberName,
        },
        link_url: `/project/${projectId}/team`,
      });
    }
    await this.invalidateDashboardCache();
  }

  async leaveProject(
    projectId: string,
    callerId: string,
  ): Promise<{ unassigned_task_count: number }> {
    const project = await this.getProjectOrThrow(projectId);

    if (callerId === project.client_id || callerId === project.consultant_id) {
      throw new MissingPermissionException({
        path: null,
        message:
          'Project leads cannot leave the project. Transfer ownership or reassign consultant instead.',
      });
    }

    const member = await this.projectsRepo.getMemberByProjectAndUserId(
      projectId,
      callerId,
    );

    if (!member) {
      throw new MissingPermissionException({
        path: 'members.view',
        message: 'You are not a member of this project.',
      });
    }

    const unassignedTaskCount =
      await this.projectsRepo.unassignTasksForMemberInProject(
        projectId,
        callerId,
      );

    await this.projectsRepo.removeMember(projectId, member.id);

    await this.invalidateDashboardCache();
    return { unassigned_task_count: unassignedTaskCount };
  }

  async getMemberPermissions(
    projectId: string,
    memberId: string,
    callerId: string,
  ): Promise<ProjectPermissions> {
    await this.getProjectOrThrow(projectId);
    // Caller must have at least viewer access on the project to inspect
    // member permissions.
    await this.authorization.assertRole(callerId, projectId, 'viewer');
    const target = await this.projectsRepo.getMemberById(projectId, memberId);
    if (!target) {
      throw new NotFoundException('Member not found');
    }
    return resolvePermissions(
      (target.role as ProjectRole) ?? 'viewer',
      (target.origin as ProjectShareOrigin | null) ?? null,
      target.capabilities ?? null,
    );
  }

  async getMyPermissions(
    projectId: string,
    userId: string,
  ): Promise<ProjectPermissions> {
    await this.getProjectOrThrow(projectId);
    const target = await this.projectsRepo.getMemberByProjectAndUserId(
      projectId,
      userId,
    );
    if (!target) {
      throw new MissingPermissionException({
        path: 'members.view',
        message: 'You are not a member of this project.',
      });
    }
    return resolvePermissions(
      (target.role as ProjectRole) ?? 'viewer',
      (target.origin as ProjectShareOrigin | null) ?? null,
      target.capabilities ?? null,
    );
  }

  async updateMemberPermissions(
    projectId: string,
    memberId: string,
    callerId: string,
    dto: UpdateProjectMemberPermissionsDto,
  ): Promise<unknown> {
    await this.getProjectOrThrow(projectId);
    // Editing permissions requires the fine-grained capability, which lives
    // at admin+ by default. assertPermission walks the resolver, so a
    // non-admin who's been explicitly granted `members.edit_permissions`
    // also passes.
    await this.authorization.assertPermission(
      callerId,
      projectId,
      'members.edit_permissions',
    );

    const target = await this.projectsRepo.getMemberById(projectId, memberId);
    if (!target) {
      throw new NotFoundException('Member not found');
    }
    if (target.user_id && target.user_id === callerId) {
      throw new ForbiddenException(
        'You cannot edit your own permissions on a project.',
      );
    }
    if (target.user_id) {
      await this.authorization.assertActionOutranks(
        callerId,
        target.user_id,
        projectId,
        'members.edit_permissions',
      );
    }

    const role = (target.role as ProjectRole) ?? 'viewer';
    const origin = (target.origin as ProjectShareOrigin | null) ?? null;

    // Cannot demote a project owner via this endpoint — owner permissions
    // are always at the maximum and protected by last-owner rules.
    if (role === 'owner') {
      throw new MissingPermissionException({
        path: null,
        message: "Cannot modify an owner's permissions.",
        label: "modify an owner's permissions",
      });
    }

    // Compute the desired permissions: start from current resolved (baseline
    // + existing capabilities), then layer in any sections present in the
    // request. The request shape is `Partial<ProjectPermissions>` per
    // section, so we merge field-by-field for each section it includes.
    const desired = resolvePermissions(role, origin, target.capabilities);
    const sections: (keyof ProjectPermissions)[] = [
      'access', 'roadmap', 'members', 'teams', 'project',
      'chat', 'resources', 'logs',
    ];
    for (const section of sections) {
      const incoming = (dto as unknown as Record<string, Record<string, boolean> | undefined>)[section];
      if (!incoming) continue;
      for (const [field, value] of Object.entries(incoming)) {
        if (typeof value !== 'boolean') continue;
        const path = `${section}.${field}` as PermissionPath;
        try {
          setPermission(desired, path, value);
        } catch {
          // Unknown path — ignore silently; class-validator already
          // accepted any boolean record so we're defensive here.
        }
      }
    }

    // Dependency validation runs against the *post-merge* permission set
    // (deps may be satisfied by role/origin or by the same patch).
    const validation = validateDependencies(desired);
    if (!validation.ok) {
      throw new BadRequestException({
        code: 'permission_dependency_unmet',
        message: 'One or more permissions require prerequisites that are not granted.',
        missing: validation.missing,
      });
    }

    // Diff desired against the (role, origin) baseline → new flat delta
    // stored on the share row. Empty delta means "use defaults" (we still
    // write {} to clear any prior overrides).
    const newCapabilities = diffCapabilities(role, origin, desired);

    // Yoke: capabilities are a per-user concept now, not per-origin.
    // Fan out the same map to every project_access row this user holds
    // on the project. The legacy memberId stays in the API surface for
    // backwards compatibility — we just resolve user_id from it.
    const syncedUserId = await this.accessSync.setUserCapabilitiesByMemberId(
      projectId,
      memberId,
      newCapabilities as Record<string, unknown>,
    );
    if (!syncedUserId) {
      // Fallback: shouldn't happen in practice (the row exists; we
      // verified above), but keep the per-row write as a safety net.
      const fallbackResult = await this.projectsRepo.updateMemberCapabilities(
        projectId,
        memberId,
        newCapabilities,
      );
      await this.invalidateDashboardCache();
      return fallbackResult;
    }
    const member = await this.projectsRepo.getMemberById(projectId, memberId);
    await this.invalidateDashboardCache();
    return member;
  }

  /**
   * Update only the `position` label on a member's share row. Allowed if:
   *   - caller is editing their own row (self-edit)
   *   - caller has `members.edit_position` (admin+ by default)
   */
  async updateMemberPosition(
    projectId: string,
    memberId: string,
    callerId: string,
    position: string,
  ): Promise<unknown> {
    await this.getProjectOrThrow(projectId);
    const target = await this.projectsRepo.getMemberById(projectId, memberId);
    if (!target) {
      throw new NotFoundException('Member not found');
    }
    const isSelf = target.user_id === callerId;
    if (!isSelf) {
      await this.authorization.assertPermission(
        callerId,
        projectId,
        'members.edit_position',
      );
    } else {
      // Self-edit still requires the caller to be a member of the project.
      await this.authorization.assertRole(callerId, projectId, 'viewer');
    }
    const trimmed = position.trim();
    if (trimmed.length > 80) {
      throw new BadRequestException('Position must be 80 characters or fewer.');
    }
    const updatedMember = await this.projectsRepo.updateMemberPosition(
      projectId,
      memberId,
      trimmed.length === 0 ? null : trimmed,
    );
    await this.invalidateDashboardCache();
    return updatedMember;
  }
}

function invoiceRound(value: number): number {
  return Math.round(value * 100) / 100;
}

