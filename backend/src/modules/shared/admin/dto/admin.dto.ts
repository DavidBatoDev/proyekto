import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ApplicationsQueryDto {
  @IsString() @IsOptional() status?: string;
}

export class RejectApplicationDto {
  @IsString() @IsOptional() reason?: string;
}

export class MatchCandidatesQueryDto {
  @IsUUID()
  @IsOptional()
  project_id?: string;

  @IsString()
  @IsOptional()
  q?: string;

  @IsString()
  @IsOptional()
  niche?: string;

  @IsString()
  @IsOptional()
  availability?: string;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  minRate?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  maxRate?: number;
}

export class MatchAssignDto {
  @IsUUID() project_id: string;
  @IsUUID() consultant_id: string;
}

export class GrantAdminDto {
  @IsEnum(['support', 'moderator', 'super_admin'])
  @IsOptional()
  access_level?: string = 'support';
  @IsString() @IsOptional() department?: string;
}
