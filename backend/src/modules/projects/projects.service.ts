import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
export const PROJECTS_REPOSITORY = Symbol('PROJECTS_REPOSITORY');
import type { ProjectsRepository } from './repositories/projects.repository.interface';
import { ProjectAuthorizationService } from './authorization/project-authorization.service';
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
import {
  enforceDependencies,
  getTemplateByKey,
  hasPermission,
  isPermissionsEmpty,
  normalizePermissions,
  type PermissionPath,
  type ProjectMemberLike,
  type ProjectPermissions,
  resolvePermissionTemplateKey,
} from './permissions/project-permissions';
import type {
  ProjectResourceFolderWithLinks,
  ProjectResourcesPayload,
} from './repositories/projects.repository.interface';

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(PROJECTS_REPOSITORY)
    private readonly projectsRepo: ProjectsRepository,
    private readonly notificationsService: NotificationsService,
    private readonly authorization: ProjectAuthorizationService,
  ) {}

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

  private async hydrateDefaultPermissionsIfEmpty(
    project: Project,
    member: ProjectMemberLike,
  ): Promise<ProjectPermissions> {
    const templateKey = resolvePermissionTemplateKey(project, member);
    const defaults = getTemplateByKey(templateKey);
    const existing = member.permissions_json ?? null;
    const normalized = normalizePermissions(existing, defaults);
    if (
      templateKey === 'consultant' ||
      templateKey === 'consultant_incubation'
    ) {
      normalized.time = {
        view: true,
        view_financial: true,
        log: true,
        edit_own: true,
        edit_team: true,
        approve: true,
        manage_rates: true,
        delete_logs: true,
      };
    }

    if (!isPermissionsEmpty(existing)) {
      const shouldPersist =
        JSON.stringify(existing) !== JSON.stringify(normalized);
      if (shouldPersist) {
        await this.projectsRepo.updateMemberPermissions(
          project.id,
          member.id,
          normalized,
        );
      }
      return normalized;
    }

    await this.projectsRepo.updateMemberPermissions(
      project.id,
      member.id,
      normalized,
    );

    return normalized;
  }

  private async getCallerPermissions(
    project: Project,
    callerId: string,
  ): Promise<ProjectPermissions | null> {
    const callerMember = await this.projectsRepo.getMemberByProjectAndUserId(
      project.id,
      callerId,
    );

    if (!callerMember) return null;

    return this.hydrateDefaultPermissionsIfEmpty(project, callerMember);
  }

  private async assertCanManageMembers(
    project: Project,
    callerId: string,
  ): Promise<void> {
    const isPrivileged = await this.isProjectPrivileged(callerId, project.id);
    const callerPermissions = await this.getCallerPermissions(
      project,
      callerId,
    );

    if (!isPrivileged && !callerPermissions) {
      throw new ForbiddenException(
        'You do not have permission to manage the team.',
      );
    }

    if (
      !isPrivileged &&
      callerPermissions &&
      !hasPermission(callerPermissions, 'members.manage')
    ) {
      throw new ForbiddenException(
        'You do not have permission to manage members.',
      );
    }
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
      throw new ForbiddenException(
        'Only project participants can manage resources.',
      );
    }

    return project;
  }

  async assertProjectPermission(
    projectId: string,
    userId: string,
    permission: PermissionPath,
  ): Promise<void> {
    const project = await this.getProjectOrThrow(projectId);

    // Always resolve/hydrate member permissions first when a member row exists.
    const permissions = await this.getCallerPermissions(project, userId);

    if (await this.isProjectPrivileged(userId, projectId)) {
      return;
    }

    if (!permissions) {
      throw new ForbiddenException('You are not a member of this project.');
    }

    if (!hasPermission(permissions, permission)) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
  }

  async assertProjectAnyPermission(
    projectId: string,
    userId: string,
    permissionsToCheck: Array<PermissionPath>,
  ): Promise<void> {
    const project = await this.getProjectOrThrow(projectId);

    // Always resolve/hydrate member permissions first when a member row exists.
    const permissions = await this.getCallerPermissions(project, userId);

    if (await this.isProjectPrivileged(userId, projectId)) {
      return;
    }

    if (!permissions) {
      throw new ForbiddenException('You are not a member of this project.');
    }

    const hasAny = permissionsToCheck.some((permission) =>
      hasPermission(permissions, permission),
    );

    if (!hasAny) {
      throw new ForbiddenException(
        `Missing required permission: ${permissionsToCheck.join(' OR ')}`,
      );
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
    return project;
  }

  async updateProject(
    id: string,
    userId: string,
    dto: UpdateProjectDto,
  ): Promise<Project> {
    const isOwner = await this.projectsRepo.isOwner(id, userId);
    if (!isOwner)
      throw new ForbiddenException('Only the project owner can update it');
    return this.projectsRepo.update(id, dto);
  }

  async deleteProject(id: string, userId: string): Promise<void> {
    const project = await this.getProjectOrThrow(id);

    if (project.client_id !== userId) {
      throw new ForbiddenException(
        'Only the current project owner can delete this project.',
      );
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
      throw new ForbiddenException(
        'Only the current project owner can transfer ownership.',
      );
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
    return project;
  }

  async reassignProjectConsultant(
    projectId: string,
    callerId: string,
    dto: ReassignProjectConsultantDto,
  ): Promise<Project> {
    const project = await this.getProjectOrThrow(projectId);
    if (!(await this.isProjectPrivileged(callerId, projectId))) {
      throw new ForbiddenException(
        'Only the current project owner or admin can reassign the consultant.',
      );
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
    if (previousConsultantId && previousConsultantId !== newConsultantId) {
      try {
        await this.authorization.revoke(projectId, previousConsultantId);
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
    await this.assertProjectPermission(
      projectId,
      callerId,
      'members.edit_permissions',
    );

    const roleKey =
      dto.role === 'member' ? 'freelancer' : (dto.role as Parameters<typeof getTemplateByKey>[0]);
    const defaults = getTemplateByKey(roleKey);
    let normalized = normalizePermissions(
      dto.permissions as unknown as Record<string, unknown>,
      defaults,
    );
    normalized = enforceDependencies(normalized);

    if (dto.role === 'consultant' || dto.role === 'consultant_incubation') {
      normalized.time = {
        view: true,
        view_financial: true,
        log: true,
        edit_own: true,
        edit_team: true,
        approve: true,
        manage_rates: true,
        delete_logs: true,
      };
      normalized.chat = {
        view_channels: true,
        send_messages: true,
        create_channels: true,
        manage_channels: true,
        view_internal_channels: true,
        mention_members: true,
        share_files: true,
        start_dm: true,
        send_dm: true,
        message_clients: true,
        message_consultants: true,
        message_freelancers: true,
      };
      normalized.logs = { view: true, view_sensitive: true };
    }

    await this.projectsRepo.updateRoleMemberPermissions(
      projectId,
      dto.role,
      normalized,
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

    if (targetMember.user_id) {
      await this.projectsRepo.unassignTasksForMemberInProject(
        projectId,
        targetMember.user_id,
      );
    }

    await this.projectsRepo.removeMember(projectId, memberId);

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
      throw new ForbiddenException(
        'Project leads cannot leave the project. Transfer ownership or reassign consultant instead.',
      );
    }

    const member = await this.projectsRepo.getMemberByProjectAndUserId(
      projectId,
      callerId,
    );

    if (!member) {
      throw new ForbiddenException('You are not a member of this project.');
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
    const project = await this.getProjectOrThrow(projectId);

    const callerPermissions = await this.getCallerPermissions(
      project,
      callerId,
    );
    const isLead =
      callerId === project.client_id || callerId === project.consultant_id;

    if (!isLead && !callerPermissions) {
      throw new ForbiddenException(
        'Only project members can view permissions.',
      );
    }

    if (
      callerPermissions &&
      !hasPermission(callerPermissions, 'members.view') &&
      !hasPermission(callerPermissions, 'members.manage')
    ) {
      throw new ForbiddenException(
        'You do not have permission to view members.',
      );
    }

    const targetMember = await this.projectsRepo.getMemberById(
      projectId,
      memberId,
    );
    if (!targetMember) {
      throw new NotFoundException('Member not found');
    }

    return this.hydrateDefaultPermissionsIfEmpty(project, targetMember);
  }

  async getMyPermissions(
    projectId: string,
    userId: string,
  ): Promise<ProjectPermissions> {
    const project = await this.getProjectOrThrow(projectId);

    const member = await this.projectsRepo.getMemberByProjectAndUserId(
      projectId,
      userId,
    );

    if (member) {
      return this.hydrateDefaultPermissionsIfEmpty(project, member);
    }

    if (userId === project.consultant_id) {
      return getTemplateByKey('consultant');
    }

    if (userId === project.client_id) {
      return getTemplateByKey('client');
    }

    throw new ForbiddenException('You are not a member of this project.');
  }

  async updateMemberPermissions(
    projectId: string,
    memberId: string,
    callerId: string,
    dto: UpdateProjectMemberPermissionsDto,
  ): Promise<unknown> {
    const project = await this.getProjectOrThrow(projectId);
    await this.assertCanManageMembers(project, callerId);
    if (
      callerId === project.client_id &&
      callerId !== project.consultant_id
    ) {
      throw new ForbiddenException(
        'Project clients cannot modify member permissions.',
      );
    }

    const targetMember = await this.projectsRepo.getMemberById(
      projectId,
      memberId,
    );
    if (!targetMember) {
      throw new NotFoundException('Member not found');
    }

    if (
      targetMember.user_id === project.client_id ||
      targetMember.user_id === project.consultant_id
    ) {
      throw new ForbiddenException(
        'Cannot modify permissions of project leads.',
      );
    }

    return this.projectsRepo.updateMemberPermissions(projectId, memberId, dto);
  }
}
