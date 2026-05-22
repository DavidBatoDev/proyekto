import {
  ArrayMinSize,
  IsBoolean,
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

  @IsString() @MaxLength(200) title: string;
  @IsString() @IsOptional() @MaxLength(500) brief?: string;
  @IsString() @IsOptional() @MaxLength(2000) description?: string;
  @IsEnum(['draft', 'bidding', 'active', 'paused', 'completed', 'archived'])
  @IsOptional()
  status?: ProjectStatus;
  @IsString() @IsOptional() category?: string;
  @IsString() @IsOptional() project_state?: string;
  @IsArray() @IsOptional() skills?: unknown[];
  @IsString() @IsOptional() duration?: string;
  @IsString() @IsOptional() budget_range?: string;
  @IsString() @IsOptional() currency?: string;
  @IsString() @IsOptional() client_name?: string;
  @IsString() @IsOptional() start_date?: string;
  @IsString() @IsOptional() custom_start_date?: string;

  // Consultant-mode only: optional team picked at create-time. The
  // service attaches it as the primary team in a separate write so a
  // failed attach does not roll back the project itself.
  @IsUUID() @IsOptional() primary_team_id?: string;
}

export class UpdateProjectDto {
  @IsString() @IsOptional() @MaxLength(200) title?: string;
  @IsString() @IsOptional() client_name?: string;
  @IsString() @IsOptional() @MaxLength(500) brief?: string;
  @IsString() @IsOptional() @MaxLength(2000) description?: string;
  @IsEnum(['draft', 'bidding', 'active', 'paused', 'completed', 'archived'])
  @IsOptional()
  status?: ProjectStatus;
  @IsString() @IsOptional() category?: string;
  @IsString() @IsOptional() project_state?: string;
  @IsArray() @IsOptional() skills?: unknown[];
  @IsString() @IsOptional() duration?: string;
  @IsString() @IsOptional() budget_range?: string;
  @IsString() @IsOptional() currency?: string;
  @IsString() @IsOptional() start_date?: string;
  @IsString() @IsOptional() custom_start_date?: string;
}

export class AssignConsultantDto {
  @IsString() consultant_id: string;
}

export class TransferProjectOwnerDto {
  @IsUUID()
  new_owner_id: string;
}

export class ReassignProjectConsultantDto {
  @IsUUID()
  new_consultant_id: string;
}

class ResourceReorderItemDto {
  @IsUUID()
  id: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  position: number;
}

export class CreateProjectResourceFolderDto {
  @IsString()
  @MaxLength(120)
  @Matches(/\S/, {
    message: 'Folder name must contain at least one non-whitespace character',
  })
  name: string;
}

export class UpdateProjectResourceFolderDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(/\S/, {
    message: 'Folder name must contain at least one non-whitespace character',
  })
  name?: string;
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
