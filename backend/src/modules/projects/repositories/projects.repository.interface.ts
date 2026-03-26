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
  assignConsultant(projectId: string, consultantId: string): Promise<Project>;
  isOwner(projectId: string, userId: string): Promise<boolean>;
  addMember(projectId: string, dto: AddProjectMemberDto): Promise<unknown>;
  getProfileDisplayName(userId: string): Promise<string | null>;
  inviteByEmail(
    projectId: string,
    invitedBy: string,
    dto: InviteProjectByEmailDto,
  ): Promise<unknown>;
  listInvitesForUser(
    userId: string,
    query?: ProjectInviteQueryDto,
  ): Promise<unknown[]>;
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
  getMemberById(
    projectId: string,
    memberId: string,
  ): Promise<{
    id: string;
    user_id: string | null;
    role: string;
    position?: string | null;
    permissions_json?: Record<string, unknown> | null;
  } | null>;
  getMemberByProjectAndUserId(
    projectId: string,
    userId: string,
  ): Promise<{
    id: string;
    user_id: string | null;
    role: string;
    position?: string | null;
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
