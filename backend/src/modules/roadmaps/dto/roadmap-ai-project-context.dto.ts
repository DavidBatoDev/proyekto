import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const ROADMAP_AI_PROJECT_MEETING_WINDOWS = [
  'upcoming',
  'recent',
  'all',
] as const;

export type RoadmapAiProjectMeetingWindow =
  (typeof ROADMAP_AI_PROJECT_MEETING_WINDOWS)[number];

export class RoadmapAiProjectMeetingsQueryDto {
  @IsOptional()
  @IsIn([...ROADMAP_AI_PROJECT_MEETING_WINDOWS])
  window?: RoadmapAiProjectMeetingWindow;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export interface RoadmapAiProjectDto {
  id: string;
  title: string;
  status: string;
  category: string | null;
  project_state: string | null;
  duration: string | null;
  budget_range: string | null;
  funding_status: string | null;
  start_date: string | null;
  skills: string[];
}

export interface RoadmapAiProjectContextMemberDto {
  id: string;
  display_name: string | null;
  role: string | null;
  persona: string | null;
}

export interface RoadmapAiProjectContextDto {
  project: RoadmapAiProjectDto | null;
  brief_excerpt: string | null;
  has_full_brief: boolean;
  custom_field_keys: string[];
  members: RoadmapAiProjectContextMemberDto[];
  teams: string[];
  resource_summary: {
    count: number;
    top_titles: string[];
  };
  meeting_summary: {
    upcoming_count: number;
    next: { title: string; scheduled_at: string } | null;
  };
}

export interface RoadmapAiProjectBriefResponseDto {
  project_id: string;
  project_summary: string | null;
  custom_fields: unknown[];
}

export interface RoadmapAiProjectResourceFolderDto {
  id: string;
  name: string;
  position: number;
}

export interface RoadmapAiProjectResourceLinkDto {
  id: string;
  folder_id: string | null;
  title: string;
  url: string;
  description: string | null;
  position: number;
}

export interface RoadmapAiProjectResourcesResponseDto {
  project_id: string;
  folders: RoadmapAiProjectResourceFolderDto[];
  links: RoadmapAiProjectResourceLinkDto[];
}

export interface RoadmapAiProjectMeetingParticipantDto {
  user_id: string | null;
  display_name: string | null;
  guest_email: string | null;
  guest_name: string | null;
  role: string;
  response: string;
}

export interface RoadmapAiProjectMeetingDto {
  id: string;
  title: string;
  description: string | null;
  type: string;
  scheduled_at: string;
  ends_at: string | null;
  status: string;
  url: string | null;
  participants: RoadmapAiProjectMeetingParticipantDto[];
}

export interface RoadmapAiProjectMeetingsResponseDto {
  project_id: string;
  window: RoadmapAiProjectMeetingWindow;
  meetings: RoadmapAiProjectMeetingDto[];
}

export interface RoadmapAiProjectMemberDetailsResponseDto {
  member: {
    id: string;
    display_name: string | null;
    persona: string | null;
    bio: string | null;
    skills: string[];
    role: string | null;
    capabilities: Record<string, unknown>;
    teams: string[];
  };
}

export interface RoadmapAiNoProjectResponseDto {
  error: { code: 'NO_PROJECT' };
}
