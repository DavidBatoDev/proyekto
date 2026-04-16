import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const AI_SESSION_MODES = ['chat', 'edit_plan'] as const;
export type RoadmapAiSessionMode = (typeof AI_SESSION_MODES)[number];

export const AI_MESSAGE_ROLES = ['user', 'assistant', 'system'] as const;
export type RoadmapAiMessageRole = (typeof AI_MESSAGE_ROLES)[number];

export const AI_INTENT_TYPES = [
  'smalltalk',
  'general_question',
  'roadmap_query',
  'roadmap_plan',
  'roadmap_edit',
  'confirm_action',
  'question',
  'unclear',
] as const;

export class CreateRoadmapAiSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsIn([...AI_SESSION_MODES])
  mode?: RoadmapAiSessionMode;
}

export class UpdateRoadmapAiSessionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsBoolean()
  is_archived?: boolean;

  @IsOptional()
  @IsBoolean()
  is_pinned?: boolean;
}

export class ListRoadmapAiSessionsQueryDto {
  @IsOptional()
  @Transform(({ value }) =>
    value === true || value === 'true' || value === '1' ? true : false,
  )
  @IsBoolean()
  archived?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ListRoadmapAiMessagesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  // Cursor by seq — return messages with seq <= before_seq (descending).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  before_seq?: number;

  // Or fetch forward from after_seq (ascending, exclusive).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  after_seq?: number;
}

// A single artifact, timeline event, etc. stored alongside an assistant turn.
// Kept as a loose record so the shape can evolve with the agent without a
// backend deploy — the agent response payload already matches web types.
type JsonRecord = Record<string, unknown>;

export class CreateRoadmapAiMessageDto {
  @IsIn([...AI_MESSAGE_ROLES])
  role: RoadmapAiMessageRole;

  @IsString()
  @MinLength(1)
  content: string;

  @IsOptional()
  @IsIn([...AI_INTENT_TYPES])
  intent_type?: string;

  @IsOptional()
  @IsIn([...AI_SESSION_MODES])
  response_mode?: RoadmapAiSessionMode;

  @IsOptional()
  @IsString()
  parse_mode?: string;

  @IsOptional()
  @IsArray()
  artifacts?: JsonRecord[];

  @IsOptional()
  activity_timeline?: JsonRecord;

  @IsOptional()
  commit_lifecycle?: JsonRecord;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  tokens?: number;

  @IsOptional()
  metadata?: JsonRecord;
}

export interface RoadmapAiSessionRow {
  id: string;
  roadmap_id: string;
  user_id: string;
  title: string | null;
  mode: RoadmapAiSessionMode;
  is_archived: boolean;
  archived_at: string | null;
  is_pinned: boolean;
  pinned_at: string | null;
  last_message_at: string | null;
  message_count: number;
  metadata: JsonRecord;
  created_at: string;
  updated_at: string;
}

export interface RoadmapAiMessageRow {
  id: string;
  session_id: string;
  seq: number;
  role: RoadmapAiMessageRole;
  content: string;
  intent_type: string | null;
  response_mode: RoadmapAiSessionMode | null;
  parse_mode: string | null;
  artifacts: JsonRecord[] | null;
  activity_timeline: JsonRecord | null;
  commit_lifecycle: JsonRecord | null;
  tokens: number | null;
  metadata: JsonRecord;
  created_at: string;
}
