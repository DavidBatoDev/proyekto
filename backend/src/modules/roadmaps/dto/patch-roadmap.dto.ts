import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export type JsonPatchOp =
  | 'add'
  | 'remove'
  | 'replace'
  | 'move'
  | 'copy'
  | 'test';

export class JsonPatchOperationDto {
  @IsEnum(['add', 'remove', 'replace', 'move', 'copy', 'test'])
  op: JsonPatchOp;

  @IsString()
  path: string;

  @IsOptional()
  value?: unknown;

  @IsOptional()
  @IsString()
  from?: string;
}

export class PatchRoadmapDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JsonPatchOperationDto)
  operations: JsonPatchOperationDto[];
}

export class FullRoadmapTaskDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(['todo', 'in_progress', 'in_review', 'done', 'blocked'])
  status?: string;

  @IsOptional()
  @IsEnum(['urgent', 'high', 'medium', 'low'])
  priority?: string;

  @IsOptional()
  @IsUUID()
  assignee_id?: string;

  @IsOptional()
  @IsDateString()
  due_date?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

export class FullRoadmapFeatureDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  is_deliverable?: boolean;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FullRoadmapTaskDto)
  roadmap_tasks?: FullRoadmapTaskDto[];
}

export class FullRoadmapEpicDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum([
    'backlog',
    'planned',
    'in_progress',
    'in_review',
    'completed',
    'on_hold',
  ])
  status?: string;

  @IsOptional()
  @IsEnum(['critical', 'high', 'medium', 'low', 'nice_to_have'])
  priority?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FullRoadmapFeatureDto)
  roadmap_features?: FullRoadmapFeatureDto[];
}

export class FullRoadmapMilestoneDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(['not_started', 'in_progress', 'at_risk', 'completed', 'missed'])
  status?: string;

  @IsDateString()
  target_date: string;

  @IsOptional()
  @IsDateString()
  completed_date?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsString()
  color?: string;
}

export class CreateFullRoadmapDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  project_id?: string;

  @IsOptional()
  @IsEnum(['draft', 'active', 'paused', 'completed', 'archived'])
  status?: string;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FullRoadmapEpicDto)
  roadmap_epics?: FullRoadmapEpicDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FullRoadmapMilestoneDto)
  roadmap_milestones?: FullRoadmapMilestoneDto[];
}

export type FullRoadmapState = CreateFullRoadmapDto;
