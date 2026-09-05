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

/** The `project:projects(...)` embed carried by the light roadmap list. */
export type AccessibleRoadmapLightProject = {
  id: string;
  title: string | null;
  workspace_id: string | null;
};

/**
 * One row of `listAccessibleRoadmapsLight`: the columns the AI context family
 * needs to list, filter, and attribute roadmaps (lane, project, workspace)
 * without paying for `*`. No preview_url, no children.
 */
export type AccessibleRoadmapLightRecord = {
  id: string;
  name: string;
  description: string | null;
  status: string | null;
  project_id: string | null;
  owner_id: string | null;
  updated_at: string | null;
  project: AccessibleRoadmapLightProject | null;
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
  /**
   * Projects the user owns or holds a `project_access` row on — the predicate
   * `findAll`/`findPreviews` scope shared roadmaps with. Exposed so the AI
   * context family can intersect caller-supplied project ids against it
   * instead of copying the predicate.
   */
  getAccessibleProjectIds(userId: string): Promise<string[]>;
  /**
   * `findAll`'s owner-or-project-member union narrowed to the light columns,
   * deduped, newest `updated_at` first.
   */
  listAccessibleRoadmapsLight(
    userId: string,
  ): Promise<AccessibleRoadmapLightRecord[]>;
  searchContextCandidates(
    roadmapId: string,
    query: string,
    options?: {
      nodeType?: RoadmapContextSearchNodeType;
      scanLimit?: number;
    },
  ): Promise<RoadmapContextSearchCandidateRecord[]>;
  findPreviews(userId: string): Promise<any[]>;
  create(dto: CreateRoadmapDto, userId: string): Promise<any>;
  update(id: string, dto: UpdateRoadmapDto): Promise<any>;
  remove(id: string): Promise<void>;
  migrateGuestRoadmaps(
    sessionId: string,
    userId: string,
  ): Promise<{ migrated: number }>;
}
