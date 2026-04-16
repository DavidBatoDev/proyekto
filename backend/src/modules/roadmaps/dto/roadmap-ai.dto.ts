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
  @IsString()
  node_ref?: string;

  @IsOptional()
  @IsUUID()
  parent_id?: string;

  @IsOptional()
  @IsString()
  parent_ref?: string;

  @IsOptional()
  @IsUUID()
  new_parent_id?: string;

  @IsOptional()
  @IsString()
  new_parent_ref?: string;

  @IsOptional()
  @IsString()
  temp_id?: string;

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
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoadmapAiOperationDto)
  operations: RoadmapAiOperationDto[];

  @IsOptional()
  @IsInt()
  base_revision?: number;

  @IsOptional()
  @IsString()
  revision_token?: string;

  @IsOptional()
  @IsBoolean()
  include_roadmap?: boolean;

  @IsOptional()
  @IsBoolean()
  include_timeline?: boolean;
}

export class RoadmapAiRollbackDto {
  @IsUUID()
  change_id: string;
}

export class RoadmapAiDiscardDto {
  @IsUUID()
  change_id: string;
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
    'TITLE_CHANGED',
    'DESCRIPTION_CHANGED',
    'STATUS_CHANGED',
    'PRIORITY_CHANGED',
    'ASSIGNEE_CHANGED',
    'TAGS_CHANGED',
    'COLOR_CHANGED',
    'DELIVERABLE_CHANGED',
    'DATE_CHANGED',
    'DEPENDENCY_CHANGED',
  ])
  type:
    | 'NODE_ADDED'
    | 'NODE_REMOVED'
    | 'NODE_MOVED'
    | 'TITLE_CHANGED'
    | 'DESCRIPTION_CHANGED'
    | 'STATUS_CHANGED'
    | 'PRIORITY_CHANGED'
    | 'ASSIGNEE_CHANGED'
    | 'TAGS_CHANGED'
    | 'COLOR_CHANGED'
    | 'DELIVERABLE_CHANGED'
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

export class RoadmapAiChangeTimelineEntryDto {
  @IsUUID()
  change_id: string;

  @IsString()
  committed_at: string;

  @IsOptional()
  @IsString()
  discarded_at?: string;

  @IsEnum(['applied', 'discarded'])
  status: 'applied' | 'discarded';

  @IsInt()
  @Min(0)
  operations_count: number;

  @ValidateNested()
  @Type(() => SemanticDiffDto)
  semantic_diff: SemanticDiffDto;

  @IsOptional()
  @IsObject()
  temp_id_mapping?: Record<string, string>;
}

export class RoadmapAiOperationResolutionDto {
  @IsInt()
  @Min(0)
  operation_index: number;

  @IsString()
  temp_id: string;

  @IsUUID()
  assigned_id: string;

  @IsEnum(['epic', 'feature', 'task'])
  node_type: Exclude<RoadmapNodeType, 'roadmap'>;
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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoadmapAiOperationResolutionDto)
  operation_results?: RoadmapAiOperationResolutionDto[];
}

export class RoadmapAiCommitResponseDto {
  @IsUUID()
  change_id: string;

  @IsString()
  committed_at: string;

  @IsString()
  revision_token: string;

  @ValidateNested()
  @Type(() => SemanticDiffDto)
  semantic_diff: SemanticDiffDto;

  @IsObject()
  candidate_snapshot: Record<string, unknown>;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoadmapAiChangeTimelineEntryDto)
  timeline: RoadmapAiChangeTimelineEntryDto[];

  @IsOptional()
  @IsObject()
  roadmap?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoadmapAiOperationResolutionDto)
  operation_results?: RoadmapAiOperationResolutionDto[];
}

export class RoadmapAiRollbackResponseDto {
  @IsUUID()
  change_id: string;

  @IsString()
  reapplied_at: string;

  @IsString()
  revision_token: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoadmapAiChangeTimelineEntryDto)
  timeline: RoadmapAiChangeTimelineEntryDto[];

  @IsObject()
  roadmap: Record<string, unknown>;
}

export class RoadmapAiDiscardResponseDto {
  @IsUUID()
  change_id: string;

  @IsString()
  discarded_at: string;

  @IsString()
  revision_token: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoadmapAiChangeTimelineEntryDto)
  timeline: RoadmapAiChangeTimelineEntryDto[];

  @IsObject()
  roadmap: Record<string, unknown>;
}

export class RoadmapAiContextSummaryFeatureDto {
  @IsUUID()
  id: string;

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  status?: string;
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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoadmapAiContextSummaryFeatureDto)
  features: RoadmapAiContextSummaryFeatureDto[];
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

export class RoadmapAiContextPreviewSelectorQueryDto {
  @IsOptional()
  @IsUUID()
  preview_id?: string;
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

export class RoadmapAiContextResolveQueryDto {
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

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  include_parent?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  include_children?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  children_limit?: number;
}

export class RoadmapAiContextResolveTopMatchDto {
  @ValidateNested()
  @Type(() => RoadmapAiContextSearchMatchDto)
  node: RoadmapAiContextSearchMatchDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RoadmapAiContextNodeResponseDto)
  parent?: RoadmapAiContextNodeResponseDto | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoadmapAiContextChildDto)
  children?: RoadmapAiContextChildDto[];
}

export class RoadmapAiContextResolveResponseDto {
  @IsOptional()
  @IsUUID()
  resolution_id?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoadmapAiContextSearchMatchDto)
  matches: RoadmapAiContextSearchMatchDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => RoadmapAiContextResolveTopMatchDto)
  top_match?: RoadmapAiContextResolveTopMatchDto | null;
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

export class RoadmapAiContextTasksAssignedQueryDto extends RoadmapAiContextPreviewSelectorQueryDto {
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

export class RoadmapAiContextTasksFilterQueryDto extends RoadmapAiContextPreviewSelectorQueryDto {
  @IsOptional()
  @IsEnum([
    'open',
    'all',
    'todo',
    'in_progress',
    'in_review',
    'done',
    'blocked',
  ])
  status?:
    | 'open'
    | 'all'
    | 'todo'
    | 'in_progress'
    | 'in_review'
    | 'done'
    | 'blocked';

  @IsOptional()
  @IsEnum(['epic', 'feature'])
  parent_type?: 'epic' | 'feature';

  @IsOptional()
  @IsUUID()
  parent_id?: string;

  @IsOptional()
  @IsUUID()
  assignee_id?: string;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsEnum(['true', 'false'])
  include_completed?: 'true' | 'false';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class RoadmapAiContextFilteredTaskDto {
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
  @IsString()
  priority?: string;

  @IsOptional()
  @IsUUID()
  assignee_id?: string;

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

export class RoadmapAiContextTasksFilteredResponseDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoadmapAiContextFilteredTaskDto)
  tasks: RoadmapAiContextFilteredTaskDto[];
}
