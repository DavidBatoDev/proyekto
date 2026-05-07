import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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
  ) {}

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

  async listDashboardProjects(userId: string): Promise<Project[]> {
    return this.projectsRepo.findDashboardByUser(userId);
  }

  async getProject(id: string) {
    const project = await this.projectsRepo.findById(id);
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async createProject(userId: string, dto: CreateProjectDto): Promise<Project> {
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
      return project;
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

    return project;
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
    return this.projectsRepo.update(id, dto);
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

    return updatedProject;
  }

  async addMember(
    projectId: string,
    callerId: string,
    dto: AddProjectMemberDto,
  ): Promise<unknown> {
    const project = await this.getProjectOrThrow(projectId);
    await this.assertCanManageMembers(project, callerId);
    return this.projectsRepo.addMember(projectId, dto);
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
    const projectTitle =
      typeof project.title === 'string' && project.title.trim().length > 0
        ? project.title.trim()
        : 'this project';
    const inviteNote =
      typeof invite.message === 'string' && invite.message.trim().length > 0
        ? invite.message.trim()
        : null;
    const invitedPosition =
      typeof invite.invited_position === 'string' &&
      invite.invited_position.trim().length > 0
        ? invite.invited_position.trim()
        : null;
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

    return invite;
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
    return this.projectsRepo.updateMember(projectId, memberId, dto);
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
      return this.projectsRepo.updateMemberCapabilities(
        projectId,
        memberId,
        newCapabilities,
      );
    }
    return this.projectsRepo.getMemberById(projectId, memberId);
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
    return this.projectsRepo.updateMemberPosition(
      projectId,
      memberId,
      trimmed.length === 0 ? null : trimmed,
    );
  }
}
