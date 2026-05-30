import { CreateRoadmapDto, UpdateRoadmapDto } from '../dto/roadmaps.dto';

export type RoadmapContextSearchNodeType = 'epic' | 'feature' | 'task';

export type RoadmapContextSearchCandidateRecord = {
  id: string;
  type: RoadmapContextSearchNodeType;
  title: string;
  description?: string;
  parent_id: string;
  parent_title?: string;
};

export type FindFullRoadmapOptions = {
  includeTaskAssigneeProfile?: boolean;
};

export interface IRoadmapsRepository {
  findAll(userId: string): Promise<any[]>;
  findAllFull(userId: string): Promise<any[]>;
  findByProjectId(projectId: string, userId?: string): Promise<any | null>;
  findById(id: string, userId?: string): Promise<any | null>;
  findUpdatedAt(id: string): Promise<string | null>;
  findFull(
    id: string,
    userId?: string,
    options?: FindFullRoadmapOptions,
  ): Promise<any | null>;
  findByUser(userId: string): Promise<any[]>;
  searchContextCandidates(
    roadmapId: string,
    query: string,
    options?: {
      nodeType?: RoadmapContextSearchNodeType;
      scanLimit?: number;
    },
  ): Promise<RoadmapContextSearchCandidateRecord[]>;
  findPreviews(userId: string): Promise<any[]>;
  findConsultantProjectless(userId: string): Promise<any[]>;
  findPublicTemplatePreviews(): Promise<any[]>;
  findPublicTemplateById(id: string): Promise<any | null>;
  create(dto: CreateRoadmapDto, userId: string): Promise<any>;
  update(id: string, dto: UpdateRoadmapDto): Promise<any>;
  cloneFromTemplate(templateId: string, userId: string): Promise<any>;
  remove(id: string): Promise<void>;
  migrateGuestRoadmaps(
    sessionId: string,
    userId: string,
  ): Promise<{ migrated: number }>;
}
