import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
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

  @IsOptional()
  @IsString()
  revision_token?: string;

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

  @IsOptional()
  @IsString()
  revision_token?: string;
}

export class RoadmapAiRollbackDto {
  @IsInt()
  target_revision: number;
}

export class RoadmapAiDiscardDto {
  @IsUUID()
  preview_id: string;
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

  @IsString()
  revision_token: string;

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

export class RoadmapAiDiscardResponseDto {
  @IsBoolean()
  ok: boolean;

  @IsUUID()
  preview_id: string;

  @IsString()
  discarded_at: string;
}

export class RoadmapAiContextSummaryEpicDto {
  @IsUUID()
  id: string;

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsInt()
  feature_count: number;
}

export class RoadmapAiContextSummaryResponseDto {
  @IsUUID()
  roadmap_id: string;

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsInt()
  epic_count: number;

  @IsInt()
  feature_count: number;

  @IsInt()
  task_count: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoadmapAiContextSummaryEpicDto)
  epics: RoadmapAiContextSummaryEpicDto[];
}

export class RoadmapAiContextSearchQueryDto {
  @IsString()
  @IsNotEmpty()
  query: string;

  @IsOptional()
  @IsEnum(['epic', 'feature', 'task'])
  node_type?: Exclude<RoadmapNodeType, 'roadmap'>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class RoadmapAiContextSearchMatchDto {
  @IsUUID()
  id: string;

  @IsEnum(['epic', 'feature', 'task'])
  type: Exclude<RoadmapNodeType, 'roadmap'>;

  @IsString()
  title: string;

  @IsOptional()
  @IsUUID()
  parent_id?: string;

  @IsOptional()
  @IsString()
  parent_title?: string;

  @IsNumber()
  score: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  matched_fields?: string[];
}

export class RoadmapAiContextSearchResponseDto {
  @IsOptional()
  @IsUUID()
  resolution_id?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoadmapAiContextSearchMatchDto)
  matches: RoadmapAiContextSearchMatchDto[];
}

export class RoadmapAiContextNodeResponseDto {
  @IsUUID()
  id: string;

  @IsEnum(['roadmap', 'epic', 'feature', 'task'])
  type: RoadmapNodeType;

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  start_date?: string;

  @IsOptional()
  @IsString()
  end_date?: string;

  @IsOptional()
  @IsString()
  due_date?: string;

  @IsOptional()
  @IsUUID()
  parent_id?: string;
}

export class RoadmapAiContextChildrenQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class RoadmapAiContextResolutionChildrenQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  choice: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class RoadmapAiContextFeaturesQueryDto {
  @IsUUID()
  epic_id: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class RoadmapAiContextChildDto {
  @IsUUID()
  id: string;

  @IsEnum(['epic', 'feature', 'task'])
  type: Exclude<RoadmapNodeType, 'roadmap'>;

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsUUID()
  parent_id?: string;
}

export class RoadmapAiContextChildrenResponseDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoadmapAiContextChildDto)
  children: RoadmapAiContextChildDto[];
}

export class RoadmapAiContextActorResponseDto {
  @IsUUID()
  actor_id: string;

  @IsOptional()
  @IsString()
  display_name?: string | null;

  @IsEnum(['owner', 'editor'])
  roadmap_role: 'owner' | 'editor';

  @IsOptional()
  @IsString()
  locale?: string | null;

  @IsOptional()
  @IsString()
  timezone?: string | null;
}

export class RoadmapAiContextTasksAssignedQueryDto {
  @IsOptional()
  @IsEnum(['open', 'all'])
  status?: 'open' | 'all';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class RoadmapAiContextAssignedTaskDto {
  @IsUUID()
  id: string;

  @IsEnum(['task'])
  type: 'task';

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsUUID()
  feature_id?: string;

  @IsOptional()
  @IsString()
  feature_title?: string;

  @IsOptional()
  @IsUUID()
  epic_id?: string;

  @IsOptional()
  @IsString()
  epic_title?: string;
}

export class RoadmapAiContextTasksAssignedResponseDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoadmapAiContextAssignedTaskDto)
  tasks: RoadmapAiContextAssignedTaskDto[];
}
