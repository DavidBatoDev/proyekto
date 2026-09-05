import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  KNOWLEDGE_SEARCH_SOURCE_TYPES,
  type KnowledgeSearchSourceType,
} from '../../roadmaps/dto/roadmap-ai-knowledge.dto';
import type { RoadmapAiProjectContextMemberDto } from '../../roadmaps/dto/roadmap-ai-project-context.dto';
import type { KnowledgeSearchResult } from '../../../shared/knowledge/knowledge-search.service';

/**
 * Query DTOs for the user-scoped `/ai/context` family.
 *
 * The global ValidationPipe runs with `enableImplicitConversion`, which turns
 * the query string `'false'` into `true` and leaves a CSV as one string, so
 * every boolean and every list below carries an explicit `@Transform`
 * (the `ListRoadmapAiSessionsQueryDto.archived` precedent).
 */

const csvToArray = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : value;

const queryBoolean = ({ value }: { value: unknown }): boolean =>
  value === true || value === 'true' || value === '1';

export const AI_CONTEXT_LANES = [
  'current',
  'shared',
  'other_workspace',
] as const;
export type AiContextLane = (typeof AI_CONTEXT_LANES)[number];

export const AI_CONTEXT_SEARCH_KINDS = [
  'roadmap',
  'project',
  'epic',
  'feature',
  'task',
] as const;
export type AiContextSearchKind = (typeof AI_CONTEXT_SEARCH_KINDS)[number];

/** Kinds the node-search RPC handles; roadmap/project match in-process. */
export const AI_CONTEXT_NODE_KINDS = ['epic', 'feature', 'task'] as const;
export type AiContextNodeKind = (typeof AI_CONTEXT_NODE_KINDS)[number];

export const AI_CONTEXT_TASK_STATUS_FILTERS = [
  'open',
  'all',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'blocked',
] as const;
export type AiContextTaskStatusFilter =
  (typeof AI_CONTEXT_TASK_STATUS_FILTERS)[number];

export const AI_CONTEXT_REF_KINDS = [
  'project',
  'roadmap',
  'epic',
  'feature',
  'task',
  'milestone',
  'team',
] as const;
export type AiContextRefKind = (typeof AI_CONTEXT_REF_KINDS)[number];

export const AI_CONTEXT_MAX_REFS = 25;

export class AiContextOverviewQueryDto {
  @IsOptional()
  @IsUUID()
  workspace_id?: string;
}

export class AiContextRoadmapsQueryDto {
  @IsOptional()
  @IsUUID()
  workspace_id?: string;

  @IsOptional()
  @IsUUID()
  project_id?: string;

  /** Opaque keyset cursor from a previous page's `next_cursor`. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class AiContextSearchQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  q: string;

  @IsOptional()
  @Transform(csvToArray)
  @IsArray()
  @IsIn([...AI_CONTEXT_SEARCH_KINDS], { each: true })
  kinds?: AiContextSearchKind[];

  @IsOptional()
  @IsUUID()
  workspace_id?: string;

  @IsOptional()
  @IsUUID()
  project_id?: string;

  /** Narrows the accessible set; never widens it. */
  @IsOptional()
  @Transform(csvToArray)
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  roadmap_ids?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class AiContextTasksQueryDto {
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  assigned_to_me?: boolean;

  @IsOptional()
  @IsIn([...AI_CONTEXT_TASK_STATUS_FILTERS])
  status?: AiContextTaskStatusFilter;

  @IsOptional()
  @IsISO8601()
  due_before?: string;

  @IsOptional()
  @IsISO8601()
  due_after?: string;

  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  overdue?: boolean;

  @IsOptional()
  @IsUUID()
  workspace_id?: string;

  @IsOptional()
  @IsUUID()
  project_id?: string;

  @IsOptional()
  @Transform(csvToArray)
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  roadmap_ids?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/**
 * Cross-project twin of `RoadmapAiKnowledgeSearchQueryDto`. Deliberately a
 * separate class: the family spells the query param `q`, the roadmap-keyed
 * DTO keeps `query`.
 */
export class AiContextKnowledgeSearchQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  q: string;

  @IsOptional()
  @Transform(csvToArray)
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  project_ids?: string[];

  @IsOptional()
  @IsUUID()
  workspace_id?: string;

  @IsOptional()
  @Transform(csvToArray)
  @IsArray()
  @IsIn([...KNOWLEDGE_SEARCH_SOURCE_TYPES], { each: true })
  sources?: KnowledgeSearchSourceType[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}

export class AiContextRefDto {
  @IsIn([...AI_CONTEXT_REF_KINDS])
  kind: AiContextRefKind;

  @IsUUID()
  id: string;

  /** What the composer showed; echoed back for the agent, never trusted. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;
}

export class AiContextResolveRefsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(AI_CONTEXT_MAX_REFS)
  @ValidateNested({ each: true })
  @Type(() => AiContextRefDto)
  refs: AiContextRefDto[];
}

/** Exactly one of `run_id` / `session_id`; the service rejects both. */
export class AiContextChangesQueryDto {
  @ValidateIf((dto: AiContextChangesQueryDto) => !dto.session_id)
  @IsUUID()
  run_id?: string;

  @ValidateIf((dto: AiContextChangesQueryDto) => !dto.run_id)
  @IsUUID()
  session_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface AiContextActorResponseDto {
  actor_id: string;
  display_name: string | null;
  locale: null;
  timezone: null;
}

export interface AiContextRoadmapCountsDto {
  epics: number;
  features: number;
  tasks: number;
  open_tasks: number;
  overdue_tasks: number;
}

export interface AiContextOverviewWorkspaceDto {
  id: string;
  name: string;
  slug: string;
  my_role: string | null;
}

export interface AiContextOverviewProjectDto {
  id: string;
  title: string;
  status: string | null;
  workspace_id: string | null;
  owner_id: string | null;
  /** The caller's `project_access` role, or `owner` for an owner without a row. */
  my_role: string | null;
  member_count: number;
  lane: AiContextLane;
  roadmap_id: string | null;
}

export interface AiContextOverviewRoadmapDto {
  id: string;
  name: string;
  status: string | null;
  owner_id: string | null;
  project_id: string | null;
  project_title: string | null;
  workspace_id: string | null;
  lane: AiContextLane;
  updated_at: string | null;
  counts: AiContextRoadmapCountsDto;
}

export interface AiContextOverviewTeamDto {
  id: string;
  name: string;
  workspace_id: string | null;
  my_role: string | null;
  status: string | null;
  lane: AiContextLane;
}

export interface AiContextOverviewResponseDto {
  workspace: AiContextOverviewWorkspaceDto | null;
  projects: AiContextOverviewProjectDto[];
  roadmaps: AiContextOverviewRoadmapDto[];
  teams: AiContextOverviewTeamDto[];
  /** True when more than the first 300 roadmaps exist; the rest carry zero counts. */
  counts_truncated: boolean;
  generated_at: string;
}

export interface AiContextRoadmapListItemDto {
  id: string;
  name: string;
  description: string | null;
  status: string | null;
  owner_id: string | null;
  updated_at: string | null;
  project: {
    id: string;
    title: string | null;
    workspace_id: string | null;
  } | null;
}

export interface AiContextRoadmapsResponseDto {
  items: AiContextRoadmapListItemDto[];
  next_cursor: string | null;
}

/**
 * One cross-roadmap search hit. Its own class on purpose: the in-roadmap
 * `RoadmapAiContextSearchMatchDto` is compared against the shared schema by
 * `scripts/check_roadmap_ai_schema.mjs` and must not change shape.
 */
export interface AiContextSearchMatchDto {
  id: string;
  kind: AiContextSearchKind;
  title: string;
  status: string | null;
  /** 0 exact, 1 prefix, 2 substring, 3 description-only. */
  rank: number;
  roadmap_id: string | null;
  roadmap_name: string | null;
  project_id: string | null;
  project_title: string | null;
  workspace_id: string | null;
  epic_id?: string | null;
  feature_id?: string | null;
  parent_title?: string | null;
  updated_at: string | null;
}

export interface AiContextSearchResponseDto {
  matches: AiContextSearchMatchDto[];
}

export interface AiContextTaskDto {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  due_date: string | null;
  updated_at: string | null;
  assignee_ids: string[];
  feature_id: string;
  feature_title: string | null;
  epic_id: string | null;
  epic_title: string | null;
  roadmap_id: string;
  roadmap_name: string | null;
  project_id: string | null;
  project_title: string | null;
  workspace_id: string | null;
}

export interface AiContextTasksResponseDto {
  tasks: AiContextTaskDto[];
}

export interface AiContextKnowledgeSearchResponseDto {
  project_ids: string[];
  query: string;
  results: KnowledgeSearchResult[];
}

export type AiContextParentChainKind =
  | 'feature'
  | 'epic'
  | 'roadmap'
  | 'project'
  | 'workspace';

export interface AiContextParentChainEntryDto {
  kind: AiContextParentChainKind;
  id: string;
  title: string;
}

export type AiContextRefErrorCode = 'NOT_FOUND' | 'LOOKUP_FAILED';

export interface AiContextResolvedRefDto {
  kind: AiContextRefKind;
  id: string;
  accessible: boolean;
  title?: string;
  status?: string | null;
  roadmap_id?: string | null;
  project_id?: string | null;
  workspace_id?: string | null;
  /** Nearest-first: task -> feature -> epic -> roadmap -> project -> workspace. */
  parent_chain?: AiContextParentChainEntryDto[];
  error_code?: AiContextRefErrorCode;
}

export interface AiContextResolveRefsResponseDto {
  refs: AiContextResolvedRefDto[];
}

export interface AiContextProjectMembersResponseDto {
  project_id: string;
  members: RoadmapAiProjectContextMemberDto[];
}

export interface AiContextChangeDto {
  change_id: string;
  roadmap_id: string;
  project_id: string | null;
  status: string;
  operations_count: number;
  semantic_change_count: number;
  revision_token_after: string | null;
  committed_at: string;
  run_id: string | null;
  session_id: string | null;
}

export interface AiContextChangesResponseDto {
  changes: AiContextChangeDto[];
}
