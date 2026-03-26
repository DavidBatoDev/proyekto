import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
export const PROJECTS_REPOSITORY = Symbol('PROJECTS_REPOSITORY');
import type { ProjectsRepository } from './repositories/projects.repository.interface';
import {
  AddProjectMemberDto,
  CreateProjectDto,
  CreateProjectResourceFolderDto,
  CreateProjectResourceLinkDto,
  InviteProjectByEmailDto,
  ProjectInviteQueryDto,
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
  getTemplateByKey,
  hasPermission,
  isPermissionsEmpty,
  normalizePermissions,
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
  ) {}

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
        log: true,
        edit_own: true,
        edit_team: true,
        approve: true,
        manage_rates: true,
        view: true,
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
    const isLead =
      callerId === project.client_id || callerId === project.consultant_id;
    const callerPermissions = await this.getCallerPermissions(
      project,
      callerId,
    );

    if (!isLead && !callerPermissions) {
      throw new ForbiddenException(
        'Only the project consultant or client can manage the team.',
      );
    }

    if (
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
    const isLead =
      callerId === project.client_id || callerId === project.consultant_id;

    if (isLead) {
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
    permission:
      | 'members.manage'
      | 'members.view'
      | 'project.settings'
      | 'roadmap.edit'
      | 'roadmap.view_internal'
      | 'roadmap.comment'
      | 'roadmap.promote'
      | 'time.log'
      | 'time.edit_own'
      | 'time.edit_team'
      | 'time.approve'
      | 'time.manage_rates'
      | 'time.view',
  ): Promise<void> {
    const project = await this.getProjectOrThrow(projectId);

    // Always resolve/hydrate member permissions first when a member row exists.
    const permissions = await this.getCallerPermissions(project, userId);

    const isLead =
      userId === project.client_id || userId === project.consultant_id;

    if (isLead) {
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
    permissionsToCheck: Array<
      | 'members.manage'
      | 'members.view'
      | 'project.settings'
      | 'roadmap.edit'
      | 'roadmap.view_internal'
      | 'roadmap.comment'
      | 'roadmap.promote'
      | 'time.log'
      | 'time.edit_own'
      | 'time.edit_team'
      | 'time.approve'
      | 'time.manage_rates'
      | 'time.view'
    >,
  ): Promise<void> {
    const project = await this.getProjectOrThrow(projectId);

    // Always resolve/hydrate member permissions first when a member row exists.
    const permissions = await this.getCallerPermissions(project, userId);

    const isLead =
      userId === project.client_id || userId === project.consultant_id;

    if (isLead) {
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
      return this.projectsRepo.create(userId, {
        ...dto,
        creation_mode: 'client',
      });
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

    return this.projectsRepo.create(userId, {
      ...dto,
      creation_mode: 'consultant',
      status: 'draft',
    });
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
    return this.projectsRepo.assignConsultant(projectId, consultantId);
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
    return this.projectsRepo.removeMember(projectId, memberId);
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
