import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const AI_MEMORY_SOURCES = ['user_request', 'inferred'] as const;
export type RoadmapAiMemorySource = (typeof AI_MEMORY_SOURCES)[number];

export class CreateRoadmapAiMemoryDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  content: string;

  @IsOptional()
  @IsIn([...AI_MEMORY_SOURCES])
  source?: RoadmapAiMemorySource;
}

export interface RoadmapAiMemoryRow {
  id: string;
  roadmap_id: string;
  content: string;
  source: RoadmapAiMemorySource;
  created_by: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
