import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export const AI_SESSION_MODES = ['chat', 'edit_plan', 'plan_proposal'] as const;
export type RoadmapAiSessionMode = (typeof AI_SESSION_MODES)[number];

export const AI_SESSION_SCOPE_KINDS = ['roadmap', 'workspace'] as const;
export type AiSessionScopeKind = (typeof AI_SESSION_SCOPE_KINDS)[number];

/**
 * What an AI thread is attached to. Exactly one target: a roadmap thread is
 * the in-canvas assistant (focus = that roadmap); a workspace thread is the
 * dashboard assistant (focus = the workspace, free to reach anything the user
 * can access). Mirrors the DB one-of CHECK on roadmap_ai_sessions
 * (roadmap_id XOR workspace_id, discriminated by `scope`).
 */
export type AiSessionScope =
  | { kind: 'roadmap'; roadmapId: string }
  | { kind: 'workspace'; workspaceId: string };

/** Serialized-JSON ceiling shared by the agent-state snapshot and per-message
 * metadata. Both land in jsonb columns the agent replays on rehydration, so
 * the cap keeps the Redis/HTTP payloads bounded. */
export const AI_SESSION_JSON_MAX_CHARS = 65_536;

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

export class UpdateRoadmapAiSessionAgentStateDto {
  /** Durable snapshot of the agent's memory-class session state (pending
   * plan, undo log, recents, conversation summary). Stored under
   * roadmap_ai_sessions.metadata.agent_state and replayed into the agent's
   * Redis session on rehydration so TTL expiry loses nothing. */
  @IsObject()
  agent_state: Record<string, unknown>;
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

export const MESSAGE_METADATA_TOO_LARGE_CODE = 'MESSAGE_METADATA_TOO_LARGE';

// `metadata` is free-form (refs, run views, ...) and the web writes it on
// every turn, so it needs the same 64KB ceiling the agent-state snapshot has.
// Runs inside the global ValidationPipe, so an oversized payload is a 400
// whose message leads with the code for the agent/web to switch on.
@ValidatorConstraint({ name: 'RoadmapAiMessageMetadataSize', async: false })
class RoadmapAiMessageMetadataSizeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    try {
      const serialized = JSON.stringify(value);
      return (
        typeof serialized === 'string' &&
        serialized.length <= AI_SESSION_JSON_MAX_CHARS
      );
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return `${MESSAGE_METADATA_TOO_LARGE_CODE}: message metadata exceeds the 64KB limit`;
  }
}

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
  @Validate(RoadmapAiMessageMetadataSizeConstraint)
  metadata?: JsonRecord;
}

export interface RoadmapAiSessionRow {
  id: string;
  /** Set when scope === 'roadmap'; null for workspace threads. */
  roadmap_id: string | null;
  /** Set when scope === 'workspace'; null for roadmap threads. */
  workspace_id: string | null;
  scope: AiSessionScopeKind;
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
