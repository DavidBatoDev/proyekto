import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ChecklistItemDto {
  @IsString() @IsOptional() id?: string;
  @IsString() title: string;
  @IsBoolean() completed: boolean;
}

// Roadmap DTOs
export class CreateRoadmapDto {
  @IsString() @MaxLength(200) name: string;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() category?: string;
  @IsUUID() @IsOptional() project_id?: string;
  @IsEnum(['draft', 'active', 'paused', 'completed', 'archived'])
  @IsOptional()
  status?: string;
  @IsDateString() @IsOptional() start_date?: string;
  @IsDateString() @IsOptional() end_date?: string;
  @IsOptional() settings?: Record<string, unknown>;
  // Required: every roadmap must have a thumbnail so cards always render one.
  @IsString() @IsNotEmpty() preview_url: string;
}

export class SuggestRoadmapMetadataDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) prompt: string;
  @IsUUID() @IsOptional() project_id?: string | null;
}

/** One replayed turn of the objective-step conversation. */
export class RoadmapIntakeTurnDto {
  @IsIn(['assistant', 'user']) role: 'assistant' | 'user';
  @IsString() @IsNotEmpty() @MaxLength(900) content: string;
}

/**
 * The intake slots gathered so far. Echoed by the client each turn and merged
 * additively server-side, so the model can never forget (or clear) a slot it
 * already filled.
 */
export class RoadmapIntakeCapturedDto {
  @IsString() @IsOptional() @MaxLength(300) product?: string;
  @IsString() @IsOptional() @MaxLength(200) audience?: string;
  @IsArray()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  @ArrayMaxSize(12)
  @IsOptional()
  features?: string[];
  @IsString() @IsOptional() @MaxLength(120) platform?: string;
  @IsString() @IsOptional() @MaxLength(300) constraints?: string;
}

export class SuggestRoadmapIntakeStepDto {
  @IsIn(['objective', 'title', 'description'])
  step: 'objective' | 'title' | 'description';

  @IsString() @IsNotEmpty() @MaxLength(2000) prompt: string;
  @IsUUID() @IsOptional() project_id?: string | null;
  @IsString() @IsOptional() @MaxLength(200) title?: string;
  @IsString() @IsOptional() @MaxLength(1200) description?: string;
  @IsString() @IsOptional() @MaxLength(80) category?: string;

  /**
   * @deprecated superseded by `round`. Still declared so a cached web bundle
   * that predates the guided intake does not 400 under forbidNonWhitelisted.
   * Safe to delete once the CDN bundle has rotated.
   */
  @IsBoolean() @IsOptional() clarification_attempted?: boolean;

  // Guided-intake state (objective step only). @Type is REQUIRED here - the
  // global ValidationPipe runs whitelist + forbidNonWhitelisted, and without a
  // declared nested type these are stripped silently rather than validated.
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoadmapIntakeTurnDto)
  @ArrayMaxSize(12)
  @IsOptional()
  turns?: RoadmapIntakeTurnDto[];

  @ValidateNested()
  @Type(() => RoadmapIntakeCapturedDto)
  @IsOptional()
  captured?: RoadmapIntakeCapturedDto;

  @IsInt() @Min(0) @Max(5) @IsOptional() round?: number;
  @IsBoolean() @IsOptional() force_ready?: boolean;
}

export class UpdateRoadmapDto {
  @IsString() @IsOptional() @MaxLength(200) name?: string;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() category?: string;
  @IsUUID() @IsOptional() project_id?: string | null;
  @IsEnum(['draft', 'active', 'paused', 'completed', 'archived'])
  @IsOptional()
  status?: string;
  @IsDateString() @IsOptional() start_date?: string;
  @IsDateString() @IsOptional() end_date?: string;
  @IsOptional() settings?: Record<string, unknown>;
  @IsString() @IsOptional() preview_url?: string;
}

export class ReplaceProjectRoadmapDto {
  @IsUUID() project_id: string;
  @IsUUID() replacement_roadmap_id: string;
}

// Milestone DTOs
export class CreateMilestoneDto {
  @IsString() @MaxLength(200) title: string;
  @IsString() @IsOptional() description?: string;
  @IsDateString() target_date: string;
  @IsEnum(['not_started', 'in_progress', 'at_risk', 'completed', 'missed'])
  @IsOptional()
  status?: string;
  @IsNumber() @IsOptional() @Min(0) position?: number;
  @IsString() @IsOptional() color?: string;
}

export class UpdateMilestoneDto {
  @IsString() @IsOptional() @MaxLength(200) title?: string;
  @IsString() @IsOptional() description?: string;
  @IsDateString() @IsOptional() target_date?: string;
  @IsEnum(['not_started', 'in_progress', 'at_risk', 'completed', 'missed'])
  @IsOptional()
  status?: string;
  @IsString() @IsOptional() color?: string;
}

export class ReorderDto {
  @IsNumber() @Min(0) position: number;
}

export class BulkReorderDto {
  @IsUUID() @IsOptional() roadmap_id?: string;
  @IsUUID() @IsOptional() epic_id?: string;
  @IsUUID() @IsOptional() feature_id?: string;
  @IsEnum(['todo', 'in_progress', 'in_review', 'done', 'blocked'])
  @IsOptional()
  status?: string;
  @IsArray() items: { id: string; position: number }[];
}

// Epic DTOs
export class CreateEpicDto {
  @IsUUID() roadmap_id: string;
  @IsString() @MaxLength(200) title: string;
  @IsString() @IsOptional() description?: string;
  @IsEnum(['critical', 'high', 'medium', 'low', 'nice_to_have'])
  @IsOptional()
  priority?: string;
  @IsEnum([
    'backlog',
    'planned',
    'in_progress',
    'in_review',
    'completed',
    'on_hold',
  ])
  @IsOptional()
  status?: string;
  @IsNumber() @IsOptional() @Min(0) position?: number;
  @IsString() @IsOptional() color?: string;
  @IsNumber() @IsOptional() @Min(0) estimated_hours?: number;
  @IsDateString() @IsOptional() start_date?: string;
  @IsDateString() @IsOptional() end_date?: string;
  @IsArray() @IsOptional() tags?: string[];
}

export class UpdateEpicDto {
  @IsString() @IsOptional() @MaxLength(200) title?: string;
  @IsString() @IsOptional() description?: string | null;
  @IsEnum(['critical', 'high', 'medium', 'low', 'nice_to_have'])
  @IsOptional()
  priority?: string;
  @IsEnum([
    'backlog',
    'planned',
    'in_progress',
    'in_review',
    'completed',
    'on_hold',
  ])
  @IsOptional()
  status?: string;
  @IsNumber() @IsOptional() @Min(0) position?: number;
  @IsString() @IsOptional() color?: string;
  @IsNumber() @IsOptional() @Min(0) estimated_hours?: number;
  @IsNumber() @IsOptional() @Min(0) actual_hours?: number;
  @IsDateString() @IsOptional() start_date?: string | null;
  @IsDateString() @IsOptional() end_date?: string | null;
  @IsDateString() @IsOptional() completed_date?: string;
  @IsArray() @IsOptional() tags?: string[];
  @IsArray() @IsOptional() labels?: any[];
}

const FEATURE_STATUS_VALUES = [
  'not_started',
  'in_progress',
  'in_review',
  'completed',
  'blocked',
];

// Feature DTOs
export class CreateFeatureDto {
  @IsUUID() roadmap_id: string;
  @IsUUID() epic_id: string;
  @IsString() @MaxLength(200) title: string;
  @IsString() @IsOptional() description?: string;
  @IsNumber() @IsOptional() @Min(0) position?: number;
  @IsBoolean() @IsOptional() is_deliverable?: boolean;
  @IsNumber() @IsOptional() @Min(0) estimated_hours?: number;
  @IsDateString() @IsOptional() start_date?: string;
  @IsDateString() @IsOptional() end_date?: string;
  // A brand-new feature always has 0 tasks, so this is honored as-is.
  @IsIn(FEATURE_STATUS_VALUES) @IsOptional() status?: string;
  @IsArray()
  @IsOptional()
  @IsUUID('all', { each: true })
  assignee_ids?: string[];
}

export class UpdateFeatureDto {
  @IsUUID() @IsOptional() epic_id?: string;
  @IsString() @IsOptional() @MaxLength(200) title?: string;
  @IsString() @IsOptional() description?: string | null;
  @IsNumber() @IsOptional() @Min(0) position?: number;
  @IsBoolean() @IsOptional() is_deliverable?: boolean;
  @IsNumber() @IsOptional() @Min(0) estimated_hours?: number;
  @IsNumber() @IsOptional() @Min(0) actual_hours?: number;
  @IsDateString() @IsOptional() start_date?: string | null;
  @IsDateString() @IsOptional() end_date?: string | null;
  // Only honored when the feature currently has 0 tasks — FeaturesService
  // strips this otherwise so a feature with tasks always stays derived.
  @IsIn(FEATURE_STATUS_VALUES) @IsOptional() status?: string;
  @IsArray()
  @IsOptional()
  @IsUUID('all', { each: true })
  assignee_ids?: string[];
}

export class LinkMilestoneDto {
  @IsUUID() feature_id: string;
  @IsUUID() milestone_id: string;
}

export class UnlinkMilestoneDto {
  @IsUUID() feature_id: string;
  @IsUUID() milestone_id: string;
}

// Task DTOs
export class CreateTaskDto {
  @IsUUID() feature_id: string;
  @IsString() @MaxLength(200) title: string;
  @IsString() @IsOptional() description?: string | null;
  @IsEnum(['urgent', 'high', 'medium', 'low']) @IsOptional() priority?: string;
  @IsEnum(['todo', 'in_progress', 'in_review', 'done', 'blocked'])
  @IsOptional()
  status?: string;
  @IsUUID() @IsOptional() assignee_id?: string;
  @IsArray()
  @IsOptional()
  @IsUUID('all', { each: true })
  assignee_ids?: string[];
  @IsDateString() @IsOptional() due_date?: string;
  @IsNumber() @IsOptional() @Min(0) position?: number;
  @IsIn(['real_work', 'training']) @IsOptional() work_type?:
    | 'real_work'
    | 'training';
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemDto)
  checklist?: ChecklistItemDto[];
}

export class QuickCreateTaskFromTimerDto {
  @IsUUID() project_id: string;
  @IsString() @MaxLength(200) title: string;
  @IsUUID() @IsOptional() assignee_id?: string;
  @IsDateString() @IsOptional() due_date?: string;
  @IsIn(['timer']) @IsOptional() source?: 'timer';
  @IsIn(['real_work', 'training']) @IsOptional() work_type?:
    | 'real_work'
    | 'training';
}

export class UpdateTaskDto {
  @IsString() @IsOptional() @MaxLength(200) title?: string;
  @IsString() @IsOptional() description?: string | null;
  @IsEnum(['urgent', 'high', 'medium', 'low']) @IsOptional() priority?: string;
  @IsEnum(['todo', 'in_progress', 'in_review', 'done', 'blocked'])
  @IsOptional()
  status?: string;
  @IsUUID() @IsOptional() assignee_id?: string;
  @IsArray()
  @IsOptional()
  @IsUUID('all', { each: true })
  assignee_ids?: string[];
  @IsNumber() @IsOptional() @Min(0) position?: number;
  @IsNumber() @IsOptional() @Min(0) board_order?: number;
  @IsDateString() @IsOptional() due_date?: string | null;
  @IsDateString() @IsOptional() completed_at?: string;
  @IsIn(['real_work', 'training']) @IsOptional() work_type?:
    | 'real_work'
    | 'training';
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemDto)
  checklist?: ChecklistItemDto[];
}

// Comment/Attachment DTOs
export class AddCommentDto {
  @IsString() @MaxLength(5000) content: string;
  /**
   * Thread root this is a reply to. Omit for a new thread.
   *
   * Only validated for shape here — that the parent is a root, and sits on the
   * same node, is enforced by the assert_comment_reply_shape trigger, so a
   * forged id fails at the DB rather than on trust in this layer.
   */
  @IsUUID() @IsOptional() parent_id?: string;
}

export class UpdateCommentDto {
  @IsString() @MaxLength(5000) content: string;
}

/**
 * Resolve/reopen a thread. Explicit boolean rather than a POST /resolve +
 * DELETE /resolve pair: the UI is a toggle, and a toggle that sends the state
 * it wants is idempotent under a double-click.
 */
export class ResolveCommentDto {
  @IsBoolean() resolved: boolean;
}

export class AddAttachmentDto {
  @IsString() file_name: string;
  @IsString() @IsOptional() file_url?: string | null;
  @IsString() @IsOptional() mime_type?: string;
  @IsNumber() @IsOptional() @Min(0) file_size?: number;
}

// Dependency DTOs
export class AddDependencyDto {
  @IsUUID() blocking_task_id: string;
}

/**
 * Feature-level (Gantt) dependency. dependency_type ships now even though the
 * UI only emits 'FS', so SS/FF become a UI change rather than a migration.
 * 'SF' is deliberately not offered.
 */
export class CreateFeatureDependencyDto {
  @IsUUID()
  blocking_feature_id: string;

  @IsUUID()
  blocked_feature_id: string;

  @IsOptional()
  @IsIn(['FS', 'SS', 'FF'])
  dependency_type?: string;

  @IsOptional()
  @IsInt()
  @Min(-365)
  @Max(365)
  lag_days?: number;
}
