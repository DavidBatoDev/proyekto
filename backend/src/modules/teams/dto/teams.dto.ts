import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';

export class CreateTeamDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsOptional()
  @IsString()
  avatar_url?: string;
}

export class UpdateTeamDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsOptional()
  @IsString()
  avatar_url?: string;
}

export const TEAM_MEMBER_ROLES = ['owner', 'admin', 'member'] as const;
export type TeamMemberRole = (typeof TEAM_MEMBER_ROLES)[number];

export class AddTeamMemberDto {
  @IsUUID()
  user_id!: string;

  @IsOptional()
  @IsIn(TEAM_MEMBER_ROLES)
  role?: TeamMemberRole;

  @IsOptional()
  @IsNumber()
  @Min(0)
  hourly_rate?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  custom_id?: string;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;
}

export class UpdateTeamMemberDto {
  @IsOptional()
  @IsIn(['admin', 'member'])
  role?: 'admin' | 'member';

  @IsOptional()
  @IsNumber()
  @Min(0)
  hourly_rate?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  custom_id?: string;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;
}

export const PROJECT_TEAM_DEFAULT_ROLES = [
  'admin',
  'editor',
  'commenter',
  'viewer',
] as const;
export type ProjectTeamDefaultRole =
  (typeof PROJECT_TEAM_DEFAULT_ROLES)[number];

export class AttachTeamDto {
  @IsUUID()
  team_id!: string;

  @IsOptional()
  @IsBoolean()
  is_primary?: boolean;

  @IsOptional()
  @IsIn(PROJECT_TEAM_DEFAULT_ROLES)
  default_role?: ProjectTeamDefaultRole;

  /** When omitted, defaults to all current team members. */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  member_user_ids?: string[];
}

export class UpdateProjectTeamDto {
  @IsOptional()
  @IsBoolean()
  is_primary?: boolean;

  @IsOptional()
  @IsIn(PROJECT_TEAM_DEFAULT_ROLES)
  default_role?: ProjectTeamDefaultRole;
}

export class AddCuratedMemberDto {
  @IsUUID()
  user_id!: string;

  @IsOptional()
  @IsIn(PROJECT_TEAM_DEFAULT_ROLES)
  role?: ProjectTeamDefaultRole;
}

export class UpdateCuratedMemberDto {
  @IsOptional()
  @IsIn(PROJECT_TEAM_DEFAULT_ROLES)
  role?: ProjectTeamDefaultRole;
}
