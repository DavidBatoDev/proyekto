import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const AI_MEMORY_SOURCES = ['user_request', 'inferred'] as const;
export type RoadmapAiMemorySource = (typeof AI_MEMORY_SOURCES)[number];

export const AI_MEMORY_SCOPES = ['roadmap', 'project'] as const;
export type RoadmapAiMemoryScope = (typeof AI_MEMORY_SCOPES)[number];

export const AI_MEMORY_CATEGORIES = ['preference', 'fact', 'decision'] as const;
export type RoadmapAiMemoryCategory = (typeof AI_MEMORY_CATEGORIES)[number];

export class CreateRoadmapAiMemoryDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  content: string;

  @IsOptional()
  @IsIn([...AI_MEMORY_SOURCES])
  source?: RoadmapAiMemorySource;

  @IsOptional()
  @IsIn([...AI_MEMORY_SCOPES])
  scope?: RoadmapAiMemoryScope;

  @IsOptional()
  @IsIn([...AI_MEMORY_CATEGORIES])
  category?: RoadmapAiMemoryCategory;
}

export interface RoadmapAiMemoryRow {
  id: string;
  roadmap_id: string;
  project_id: string | null;
  scope: RoadmapAiMemoryScope;
  category: RoadmapAiMemoryCategory;
  content: string;
  source: RoadmapAiMemorySource;
  created_by: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** relevant() rows: memory + cosine similarity, embedding never exposed. */
export interface RoadmapAiRelevantMemoryRow extends RoadmapAiMemoryRow {
  similarity?: number;
}
