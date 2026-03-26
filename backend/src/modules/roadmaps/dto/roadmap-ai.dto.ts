import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export type RoadmapAiOperationType =
  | 'add_epic'
  | 'add_feature'
  | 'add_task'
  | 'update_node'
  | 'move_node'
  | 'delete_node'
  | 'mark_status'
  | 'shift_dates';

export type RoadmapNodeType = 'roadmap' | 'epic' | 'feature' | 'task';

export class RoadmapAiOperationDto {
  @IsEnum([
    'add_epic',
    'add_feature',
    'add_task',
    'update_node',
    'move_node',
    'delete_node',
    'mark_status',
    'shift_dates',
  ])
  op: RoadmapAiOperationType;

  @IsOptional()
  @IsEnum(['roadmap', 'epic', 'feature', 'task'])
  node_type?: RoadmapNodeType;

  @IsOptional()
  @IsUUID()
  node_id?: string;

  @IsOptional()
  @IsUUID()
  parent_id?: string;

  @IsOptional()
  @IsUUID()
  new_parent_id?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsObject()
  patch?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsInt()
  delta_days?: number;

  @IsOptional()
  @IsObject()
  scope?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}

export class RoadmapAiPreviewDto {
  @IsOptional()
  @IsInt()
  base_revision?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoadmapAiOperationDto)
  operations: RoadmapAiOperationDto[];
}

export class RoadmapAiCommitDto {
  @IsUUID()
  preview_id: string;

  @IsOptional()
  @IsInt()
  base_revision?: number;
}

export class RoadmapAiRollbackDto {
  @IsInt()
  target_revision: number;
}

export type RoadmapValidationIssueCode =
  | 'MISSING_REQUIRED_FIELD'
  | 'INVALID_TYPE'
  | 'INVALID_ENUM'
  | 'DUPLICATE_ID'
  | 'BROKEN_RELATIONSHIP'
  | 'DEPENDENCY_CYCLE'
  | 'INVALID_DATE_RANGE'
  | 'HIERARCHY_VIOLATION'
  | 'PROGRESS_MISMATCH'
  | 'STALE_REVISION'
  | 'OUT_OF_SCOPE_MUTATION';

export class RoadmapValidationIssueDto {
  @IsEnum([
    'MISSING_REQUIRED_FIELD',
    'INVALID_TYPE',
    'INVALID_ENUM',
    'DUPLICATE_ID',
    'BROKEN_RELATIONSHIP',
    'DEPENDENCY_CYCLE',
    'INVALID_DATE_RANGE',
    'HIERARCHY_VIOLATION',
    'PROGRESS_MISMATCH',
    'STALE_REVISION',
    'OUT_OF_SCOPE_MUTATION',
  ])
  code: RoadmapValidationIssueCode;

  @IsEnum(['error', 'warning'])
  severity: 'error' | 'warning';

  @IsString()
  path: string;

  @IsString()
  message: string;

  @IsOptional()
  @IsObject()
  node_ref?: {
    type: RoadmapNodeType;
    id: string;
  };
}

export class SemanticDiffChangeDto {
  @IsEnum([
    'NODE_ADDED',
    'NODE_REMOVED',
    'NODE_MOVED',
    'STATUS_CHANGED',
    'DATE_CHANGED',
    'DEPENDENCY_CHANGED',
  ])
  type:
    | 'NODE_ADDED'
    | 'NODE_REMOVED'
    | 'NODE_MOVED'
    | 'STATUS_CHANGED'
    | 'DATE_CHANGED'
    | 'DEPENDENCY_CHANGED';

  @IsObject()
  node: {
    type: RoadmapNodeType;
    id: string;
  };

  @IsOptional()
  @IsObject()
  from?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  to?: Record<string, unknown>;
}

export class SemanticDiffDto {
  @IsObject()
  summary: Record<string, number>;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SemanticDiffChangeDto)
  changes: SemanticDiffChangeDto[];
}

export class RoadmapAiPreviewResponseDto {
  @IsUUID()
  preview_id: string;

  @IsOptional()
  @IsInt()
  base_revision?: number;

  @IsString()
  base_updated_at: string;

  @ValidateNested()
  @Type(() => SemanticDiffDto)
  semantic_diff: SemanticDiffDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoadmapValidationIssueDto)
  validation_issues: RoadmapValidationIssueDto[];

  @IsObject()
  candidate_snapshot: Record<string, unknown>;
}

export class RoadmapAiCommitResponseDto {
  @IsString()
  committed_at: string;

  @IsString()
  revision_token: string;

  @ValidateNested()
  @Type(() => SemanticDiffDto)
  semantic_diff: SemanticDiffDto;

  @IsObject()
  roadmap: Record<string, unknown>;
}

export class RoadmapAiRollbackResponseDto {
  @IsBoolean()
  ok: boolean;

  @IsString()
  message: string;
}

