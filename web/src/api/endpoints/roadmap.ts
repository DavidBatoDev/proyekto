import type {
	Roadmap,
	RoadmapEpic,
	RoadmapFeature,
	RoadmapMilestone,
	RoadmapTask,
} from "../../types/roadmap";
import apiClient from "../axios";

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

/** One entry in a roadmap's commit history. */
export interface RoadmapChangeHistoryEntry {
	change_id: string;
	roadmap_id: string;
	project_id: string | null;
	actor_id: string | null;
	status: "applied" | "discarded";
	operations_count: number | null;
	semantic_change_count: number | null;
	committed_at: string | null;
	discarded_at: string | null;
}

/**
 * A roadmap's commit history, newest first.
 *
 * Used to identify the commit that carried an approved change request onto the
 * roadmap: `project_change_requests.applied_change_id` has to reference a real
 * `roadmap_change_history` row, so the commit is picked rather than typed.
 */
export const getRoadmapChanges = async (
	roadmapId: string,
	params: { limit?: number; before?: string } = {},
): Promise<RoadmapChangeHistoryEntry[]> => {
	const query = new URLSearchParams();
	if (params.limit) query.set("limit", String(params.limit));
	if (params.before) query.set("before", params.before);
	const suffix = query.toString() ? `?${query.toString()}` : "";
	const response = await apiClient.get<
		ApiResponse<RoadmapChangeHistoryEntry[]>
	>(`/api/roadmaps/${roadmapId}/ai/changes${suffix}`);
	return response.data.data;
};
