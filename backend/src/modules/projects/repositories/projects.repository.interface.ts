import {
  Project,
  ProjectResourceFolder,
  ProjectResourceLink,
} from '../../../common/entities';
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
  UpdateProjectDto,
  UpdateProjectMemberDto,
  UpdateProjectMemberPermissionsDto,
  UpdateProjectResourceFolderDto,
  UpdateProjectResourceLinkDto,
} from '../dto/project.dto';
import type { ProjectPermissions } from '../permissions/project-permissions';

export type ProjectResourceFolderWithLinks = ProjectResourceFolder & {
  links: ProjectResourceLink[];
};

export type ProjectResourcesPayload = {
  folders: ProjectResourceFolderWithLinks[];
  uncategorized_links: ProjectResourceLink[];
};

export interface ProjectsRepository {
  getCreatorProfileForProjectCreation(userId: string): Promise<{
    active_persona: string;
    is_consultant_verified: boolean;
  } | null>;
  findByUser(userId: string): Promise<Project[]>;
  findDashboardByUser(userId: string): Promise<Project[]>;
  findById(id: string): Promise<
    | (Project & {
        client?: unknown;
        consultant?: unknown;
        members?: unknown[];
      })
    | null
  >;
  create(userId: string, dto: CreateProjectDto): Promise<Project>;
  update(id: string, dto: UpdateProjectDto): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  transferOwner(
    projectId: string,
    previousOwnerId: string,
    newOwnerId: string,
  ): Promise<Project>;
  reassignConsultant(
    projectId: string,
    ownerId: string,
    previousConsultantId: string | null,
    newConsultantId: string,
  ): Promise<Project>;
  assignConsultant(projectId: string, consultantId: string): Promise<Project>;
  isOwner(projectId: string, userId: string): Promise<boolean>;
  isConsultantVerified(userId: string): Promise<boolean>;
  addMember(projectId: string, dto: AddProjectMemberDto): Promise<unknown>;
  getProfileDisplayName(userId: string): Promise<string | null>;
  getInviterProfile(
    userId: string,
  ): Promise<{ displayName: string | null; avatarUrl: string | null }>;
  inviteByEmail(
    projectId: string,
    invitedBy: string,
    dto: InviteProjectByEmailDto,
  ): Promise<unknown>;
  listInvitesForUser(
    userId: string,
    query?: ProjectInviteQueryDto,
  ): Promise<unknown[]>;
  listProjectInvites(projectId: string): Promise<unknown[]>;
  cancelInvite(projectId: string, inviteId: string): Promise<void>;
  respondInvite(
    userId: string,
    inviteId: string,
    dto: RespondProjectInviteDto,
  ): Promise<unknown>;
  updateMember(
    projectId: string,
    memberId: string,
    dto: UpdateProjectMemberDto,
  ): Promise<unknown>;
  removeMember(projectId: string, memberId: string): Promise<void>;
  unassignTasksForMemberInProject(
    projectId: string,
    userId: string,
  ): Promise<number>;
  getMemberById(
    projectId: string,
    memberId: string,
  ): Promise<{
    id: string;
    user_id: string | null;
    role: string;
    origin: string | null;
    position: string | null;
    capabilities: Record<string, unknown>;
    permissions_json?: Record<string, unknown> | null;
  } | null>;
  getMemberByProjectAndUserId(
    projectId: string,
    userId: string,
  ): Promise<{
    id: string;
    user_id: string | null;
    role: string;
    origin: string | null;
    position: string | null;
    capabilities: Record<string, unknown>;
    permissions_json?: Record<string, unknown> | null;
  } | null>;
  getMemberPermissions(
    projectId: string,
    memberId: string,
  ): Promise<ProjectPermissions | null>;
  updateMemberPermissions(
    projectId: string,
    memberId: string,
    dto: UpdateProjectMemberPermissionsDto,
  ): Promise<unknown>;
  updateMemberCapabilities(
    projectId: string,
    memberId: string,
    capabilities: Record<string, boolean>,
  ): Promise<unknown>;
  updateMemberPosition(
    projectId: string,
    memberId: string,
    position: string | null,
  ): Promise<unknown>;
  updateRoleMemberPermissions(
    projectId: string,
    role: string,
    permissions: ProjectPermissions,
  ): Promise<void>;
  getRolePermissions(
    projectId: string,
    role: string,
  ): Promise<ProjectPermissions | null>;
  listProjectResources(projectId: string): Promise<ProjectResourcesPayload>;
  createProjectResourceFolder(
    projectId: string,
    dto: CreateProjectResourceFolderDto,
  ): Promise<ProjectResourceFolder>;
  updateProjectResourceFolder(
    projectId: string,
    folderId: string,
    dto: UpdateProjectResourceFolderDto,
  ): Promise<ProjectResourceFolder>;
  deleteProjectResourceFolder(
    projectId: string,
    folderId: string,
  ): Promise<void>;
  reorderProjectResourceFolders(
    projectId: string,
    dto: ReorderProjectResourceFoldersDto,
  ): Promise<ProjectResourceFolder[]>;
  createProjectResourceLink(
    projectId: string,
    dto: CreateProjectResourceLinkDto,
  ): Promise<ProjectResourceLink>;
  updateProjectResourceLink(
    projectId: string,
    linkId: string,
    dto: UpdateProjectResourceLinkDto,
  ): Promise<ProjectResourceLink>;
  deleteProjectResourceLink(projectId: string, linkId: string): Promise<void>;
  reorderProjectResourceLinks(
    projectId: string,
    dto: ReorderProjectResourceLinksDto,
  ): Promise<ProjectResourceLink[]>;
}
