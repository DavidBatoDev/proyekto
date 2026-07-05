import apiClient from "../axios";
import type {
  Roadmap,
  RoadmapEpic,
  RoadmapFeature,
  RoadmapMilestone,
  RoadmapTask,
} from "../../types/roadmap";

// API Response types
interface ApiResponse<T> {
  data: T;
}

// Request DTOs
export interface CreateRoadmapDto {
  name: string;
  description?: string;
  category?: string;
  project_id?: string | null;
  status?: "draft" | "active" | "paused" | "completed" | "archived";
  start_date?: string;
  end_date?: string;
  settings?: Record<string, any>;
  // Required: every roadmap must have a thumbnail for its card.
  preview_url: string;
}

export interface UpdateRoadmapDto {
  name?: string;
  description?: string;
  category?: string;
  status?: "draft" | "active" | "paused" | "completed" | "archived";
  start_date?: string;
  end_date?: string;
  settings?: Record<string, any>;
  preview_url?: string;
}

// Full roadmap structure with nested data
export interface FullRoadmap extends Roadmap {
  milestones: any[];
  epics: any[];
}

export interface RoadmapPreview extends Omit<Roadmap, "epics" | "milestones"> {
  project?: {
    id: string;
    title: string;
  } | null;
  milestones: Array<
    Pick<
      RoadmapMilestone,
      "id" | "roadmap_id" | "title" | "target_date" | "status" | "position"
    >
  >;
  epics: Array<
    Pick<RoadmapEpic, "id" | "roadmap_id" | "title" | "position" | "status"> & {
      features: Array<
        Pick<
          RoadmapFeature,
          "id" | "roadmap_id" | "epic_id" | "title" | "position"
        > & {
          tasks: Array<
            Pick<
              RoadmapTask,
              | "id"
              | "feature_id"
              | "title"
              | "assignee_id"
              | "position"
              | "status"
              | "due_date"
              | "updated_at"
              | "assignee"
            >
          >;
        }
      >;
    }
  >;
}

/**
 * Get all roadmaps for the current user
 */
export const getRoadmaps = async (): Promise<Roadmap[]> => {
  const response = await apiClient.get<ApiResponse<Roadmap[]>>("/api/roadmaps");
  return response.data.data;
};

/**
 * Get all roadmaps with lightweight preview structure
 */
export const getRoadmapsPreview = async (): Promise<RoadmapPreview[]> => {
  const response = await apiClient.get<ApiResponse<RoadmapPreview[]>>(
    "/api/roadmaps/preview",
  );
  return response.data.data;
};

/**
 * Get a single roadmap by ID
 */
export const getRoadmap = async (id: string): Promise<Roadmap> => {
  const response = await apiClient.get<ApiResponse<Roadmap>>(
    `/api/roadmaps/${id}`,
  );
  return response.data.data;
};

/**
 * Get a roadmap with full nested structure (milestones, epics, features, tasks)
 */
export const getRoadmapFull = async (id: string): Promise<FullRoadmap> => {
  const response = await apiClient.get<ApiResponse<FullRoadmap>>(
    `/api/roadmaps/${id}/full`,
  );
  return response.data.data;
};

/**
 * Create a new roadmap
 */
export const createRoadmap = async (
  data: CreateRoadmapDto,
): Promise<Roadmap> => {
  const response = await apiClient.post<ApiResponse<Roadmap>>(
    "/api/roadmaps",
    data,
  );
  return response.data.data;
};

/**
 * Update a roadmap
 */
export const updateRoadmap = async (
  id: string,
  data: UpdateRoadmapDto,
): Promise<Roadmap> => {
  const response = await apiClient.patch<ApiResponse<Roadmap>>(
    `/api/roadmaps/${id}`,
    data,
  );
  return response.data.data;
};

/**
 * Delete a roadmap
 */
export const deleteRoadmap = async (id: string): Promise<void> => {
  await apiClient.delete(`/api/roadmaps/${id}`);
};
