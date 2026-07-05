import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
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
  @IsBoolean() @IsOptional() is_public?: boolean;
  @IsBoolean() @IsOptional() is_templatable?: boolean;
}

export class SuggestRoadmapMetadataDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) prompt: string;
  @IsUUID() @IsOptional() project_id?: string | null;
}

export class SuggestRoadmapIntakeStepDto {
  @IsIn(['title', 'description'])
  step: 'title' | 'description';

  @IsString() @IsNotEmpty() @MaxLength(2000) prompt: string;
  @IsUUID() @IsOptional() project_id?: string | null;
  @IsString() @IsOptional() @MaxLength(200) title?: string;
  @IsString() @IsOptional() @MaxLength(1200) description?: string;
  @IsString() @IsOptional() @MaxLength(80) category?: string;
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
  @IsBoolean() @IsOptional() is_public?: boolean;
  @IsBoolean() @IsOptional() is_templatable?: boolean;
}

export class ReplaceProjectRoadmapDto {
  @IsUUID() project_id: string;
  @IsUUID() replacement_roadmap_id: string;
}

export class UpdateRoadmapTemplateSettingsDto {
  @IsBoolean() @IsOptional() is_public?: boolean;
  @IsBoolean() @IsOptional() is_templatable?: boolean;
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
}

export class UpdateCommentDto {
  @IsString() @MaxLength(5000) content: string;
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
