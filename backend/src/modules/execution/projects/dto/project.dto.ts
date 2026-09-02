import {
  ArrayMinSize,
  IsDateString,
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Matches,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  RESOURCE_FOLDER_COLORS,
  RESOURCE_FOLDER_ICONS,
} from '../../../../common/resources/folder-tokens';

export enum ProjectMemberRole {
  CONSULTANT = 'consultant',
  CLIENT = 'client',
  MEMBER = 'member',
}

export class UpdateProjectMemberPermissionsDto {
  @IsOptional()
  @IsObject()
  access?: Record<string, boolean>;

  @IsOptional()
  @IsObject()
  roadmap?: Record<string, boolean>;

  @IsOptional()
  @IsObject()
  members?: Record<string, boolean>;

  @IsOptional()
  @IsObject()
  teams?: Record<string, boolean>;

  @IsOptional()
  @IsObject()
  project?: Record<string, boolean>;

  @IsOptional()
  @IsObject()
  chat?: Record<string, boolean>;

  @IsOptional()
  @IsObject()
  resources?: Record<string, boolean>;

  @IsOptional()
  @IsObject()
  logs?: Record<string, boolean>;

  @IsOptional()
  @IsObject()
  time?: Record<string, boolean>;

  // The delivery-governance sections. Absent until now, which made the editor
  // unusable: it posts back the whole object returned by GET .../permissions, and
  // the global pipe runs forbidNonWhitelisted — so every save 400'd on
  // "property deliverables should not exist". They also have to be settable per
  // member now that the role ladder and capabilities are the only sources.
  @IsOptional()
  @IsObject()
  deliverables?: Record<string, boolean>;

  @IsOptional()
  @IsObject()
  change_requests?: Record<string, boolean>;

  @IsOptional()
  @IsObject()
  risks?: Record<string, boolean>;

  @IsOptional()
  @IsObject()
  decisions?: Record<string, boolean>;

  /**
   * Accepted and ignored.
   *
   * `mentions.invite_by_email` is a feature-flag projection, not a stored
   * permission — the resolver folds it in after resolution. The editor posts it
   * back because it round-trips the GET payload, so it has to be whitelisted or
   * the save 400s; `updateMemberPermissions` deliberately omits it from the
   * sections it reads.
   */
  @IsOptional()
  @IsObject()
  mentions?: Record<string, boolean>;
}

export class AddProjectMemberDto {
  @IsEmail() @IsOptional() email?: string;
  @IsString() @MaxLength(100) position: string;
}

export class UpdateProjectMemberDto {
  @IsEnum(ProjectMemberRole)
  @IsOptional()
  role?: ProjectMemberRole;

  @IsString()
  @IsOptional()
  @MaxLength(80)
  position?: string;
}

export class UpdateMemberPositionDto {
  @IsString()
  @MaxLength(80)
  position: string;
}

export class InviteProjectByEmailDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  position?: string;

  @IsIn(['consultant', 'client', 'member'])
  @IsOptional()
  role?: string;

  // Persisted to project_invites.default_role. Granted to the invitee when
  // they accept. Only Editor/Viewer are exposed via the /welcome multi-invite
  // step; Owner / Admin / Commenter remain admin-only for now.
  @IsIn(['editor', 'viewer'])
  @IsOptional()
  default_role?: 'editor' | 'viewer';

  @IsOptional()
  @IsString()
  @MaxLength(1200)
  message?: string;
}

export class RespondProjectInviteDto {
  @IsIn(['accepted', 'declined'])
  status: 'accepted' | 'declined';
}

export class ProjectInviteQueryDto {
  @IsOptional()
  @IsUUID()
  project_id?: string;
}

export class ProjectDashboardSummaryQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID()
  project_id?: string;

  @IsOptional()
  @IsUUID()
  team_id?: string;

  @IsOptional()
  @IsUUID()
  member_user_id?: string;
}

export class UpdateRolePermissionsDto {
  @IsIn(['consultant', 'client', 'member'])
  role: string;

  @IsObject()
  permissions: Record<string, unknown>;
}

type ProjectStatus =
  | 'draft'
  | 'bidding'
  | 'active'
  | 'paused'
  | 'completed'
  | 'archived';

export class CreateProjectDto {
  @IsEnum(['client', 'consultant'])
  @IsOptional()
  creation_mode?: 'client' | 'consultant';

  /**
   * Which workspace the project belongs to. Omit to use the caller's default
   * workspace — see WorkspacesService.resolveWorkspaceForWrite. Declared here
   * because the global ValidationPipe runs forbidNonWhitelisted, so an
   * undeclared field would 400 the request.
   */
  @IsUUID()
  @IsOptional()
  workspace_id?: string;

  @IsString() @MaxLength(200) title: string;
  @IsString() @IsOptional() @MaxLength(500) brief?: string;
  @IsString() @IsOptional() @MaxLength(2000) description?: string;
  @IsEnum(['draft', 'bidding', 'active', 'paused', 'completed', 'archived'])
  @IsOptional()
  status?: ProjectStatus;
  @IsString() @IsOptional() duration?: string;
  // Default currency for new rates/contracts/invoices and the project time
  // display fallback. Not a conversion — existing frozen amounts are untouched.
  @IsString() @IsOptional() @MaxLength(8) currency?: string;

  // Consultant-mode only: optional team picked at create-time. The
  // service attaches it as the primary team in a separate write so a
  // failed attach does not roll back the project itself.
  @IsUUID() @IsOptional() primary_team_id?: string;
}

export class CreateProjectFromRoadmapDto {
  @IsUUID()
  roadmap_id: string;

  @IsString()
  @IsOptional()
  guest_session_id?: string;
}

export class UpdateProjectDto {
  @IsString() @IsOptional() @MaxLength(200) title?: string;
  @IsString() @IsOptional() @MaxLength(500) brief?: string;
  @IsString() @IsOptional() @MaxLength(2000) description?: string;
  @IsEnum(['draft', 'bidding', 'active', 'paused', 'completed', 'archived'])
  @IsOptional()
  status?: ProjectStatus;
  @IsString() @IsOptional() duration?: string;
  @IsString() @IsOptional() @MaxLength(8) currency?: string;
}

export class TransferProjectOwnerDto {
  @IsUUID()
  new_owner_id: string;
}

class ResourceReorderItemDto {
  @IsUUID()
  id: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  position: number;
}

/**
 * Folder decoration tokens. Kept in code rather than the DB so adding an icon
 * is a deploy, not a migration; the column only guards shape and length.
 */
export const PROJECT_RESOURCE_FOLDER_ICONS = RESOURCE_FOLDER_ICONS;
export const PROJECT_RESOURCE_FOLDER_COLORS = RESOURCE_FOLDER_COLORS;

export class CreateProjectResourceFolderDto {
  @IsString()
  @MaxLength(120)
  @Matches(/\S/, {
    message: 'Folder name must contain at least one non-whitespace character',
  })
  name: string;

  @IsOptional()
  @IsIn(PROJECT_RESOURCE_FOLDER_ICONS as unknown as string[])
  icon?: string;

  @IsOptional()
  @IsIn(PROJECT_RESOURCE_FOLDER_COLORS as unknown as string[])
  color?: string;
}

export class UpdateProjectResourceFolderDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(/\S/, {
    message: 'Folder name must contain at least one non-whitespace character',
  })
  name?: string;

  @IsOptional()
  @IsIn(PROJECT_RESOURCE_FOLDER_ICONS as unknown as string[])
  icon?: string;

  @IsOptional()
  @IsIn(PROJECT_RESOURCE_FOLDER_COLORS as unknown as string[])
  color?: string;
}

export class ReorderProjectResourceFoldersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ResourceReorderItemDto)
  items: ResourceReorderItemDto[];
}

export class CreateProjectResourceLinkDto {
  @IsString()
  @MaxLength(255)
  @Matches(/\S/, {
    message: 'Link title must contain at least one non-whitespace character',
  })
  title: string;

  @IsString()
  @MaxLength(2048)
  @IsUrl({
    require_protocol: true,
    require_tld: false,
    require_host: true,
    protocols: ['http', 'https'],
  })
  @Matches(/^https?:\/\//i, {
    message: 'Link URL must start with http:// or https://',
  })
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsUUID()
  folder_id?: string | null;
}

export class UpdateProjectResourceLinkDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/\S/, {
    message: 'Link title must contain at least one non-whitespace character',
  })
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl({
    require_protocol: true,
    require_tld: false,
    require_host: true,
    protocols: ['http', 'https'],
  })
  @Matches(/^https?:\/\//i, {
    message: 'Link URL must start with http:// or https://',
  })
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsUUID()
  folder_id?: string | null;
}

export class ReorderProjectResourceLinksDto {
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsUUID()
  folder_id?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ResourceReorderItemDto)
  items: ResourceReorderItemDto[];
}
