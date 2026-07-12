import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Source types callers may filter on. 'memory' is excluded — memories have
 * their own endpoint; 'file_chunk' is reserved for the file-extraction phase
 * but already valid so enabling it later needs no API change. */
export const KNOWLEDGE_SEARCH_SOURCE_TYPES = [
  'chat_message',
  'task_comment',
  'activity_log',
  'brief',
  'file_chunk',
] as const;
export type KnowledgeSearchSourceType =
  (typeof KNOWLEDGE_SEARCH_SOURCE_TYPES)[number];

export class RoadmapAiKnowledgeSearchQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  query: string;

  @IsOptional()
  @Transform(({ value }): unknown =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : (value as unknown),
  )
  @IsIn([...KNOWLEDGE_SEARCH_SOURCE_TYPES], { each: true })
  sources?: KnowledgeSearchSourceType[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}

export class RoadmapAiRelevantMemoriesQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  query: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}

export interface RoadmapAiKnowledgeSearchResultDto {
  id: string;
  source_type: string;
  source_id: string;
  roadmap_id: string | null;
  room_id: string | null;
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  score: number;
}

export interface RoadmapAiKnowledgeSearchResponseDto {
  project_id: string | null;
  query: string;
  results: RoadmapAiKnowledgeSearchResultDto[];
}
