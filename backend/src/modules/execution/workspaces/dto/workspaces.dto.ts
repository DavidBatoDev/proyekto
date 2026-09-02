import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';

/**
 * Workspace membership roles. Same vocabulary as team_members, and equally
 * unrelated to `share_role`: a workspace role governs the organization surface
 * (settings, members, billing) and grants nothing inside a project. Project
 * access remains project_access + resolvePermissions, exclusively.
 */
export const WORKSPACE_MEMBER_ROLES = ['owner', 'admin', 'member'] as const;
export type WorkspaceMemberRole = (typeof WORKSPACE_MEMBER_ROLES)[number];

/**
 * Roles the API will hand out. `owner` is deliberately absent: ownership moves
 * through PATCH /workspaces/:id/members/:userId, which only an existing owner
 * may call, so it never arrives by invitation.
 */
export const WORKSPACE_ASSIGNABLE_ROLES = ['admin', 'member'] as const;
export type WorkspaceAssignableRole =
  (typeof WORKSPACE_ASSIGNABLE_ROLES)[number];

export const WORKSPACE_NAME_MAX_LENGTH = 120;
export const WORKSPACE_DESCRIPTION_MAX_LENGTH = 2000;

export const WORKSPACE_PLANS = [
  'free',
  'pro',
  'business',
  'enterprise',
] as const;
export type WorkspacePlan = (typeof WORKSPACE_PLANS)[number];

export class CreateWorkspaceDto {
  @IsString()
  @Length(1, WORKSPACE_NAME_MAX_LENGTH)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(WORKSPACE_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @IsOptional()
  @IsString()
  avatar_url?: string;
}

export class UpdateWorkspaceDto {
  @IsOptional()
  @IsString()
  @Length(1, WORKSPACE_NAME_MAX_LENGTH)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(WORKSPACE_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @IsOptional()
  @IsString()
  avatar_url?: string;
}

export class InviteWorkspaceMemberDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsOptional()
  @IsIn(WORKSPACE_ASSIGNABLE_ROLES)
  role?: WorkspaceAssignableRole;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}

export class RespondWorkspaceInviteDto {
  @IsIn(['accepted', 'declined'])
  status!: 'accepted' | 'declined';
}

export class UpdateWorkspaceMemberDto {
  @IsIn(WORKSPACE_MEMBER_ROLES)
  role!: WorkspaceMemberRole;
}

/**
 * Optional workspace target on create-team / create-project requests. Omitted
 * means "the caller's default workspace" — see
 * WorkspacesService.resolveWorkspaceForWrite.
 */
export class WorkspaceScopedDto {
  @IsOptional()
  @IsUUID()
  workspace_id?: string;
}
