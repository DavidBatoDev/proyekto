/**
 * Roadmap Service Layer
 * Centralized API communication for all roadmap CRUD operations
 */

import { isAxiosError } from "axios";
import { apiClient } from "@/api";
import type {
	Comment,
	EpicPriority,
	EpicStatus,
	FeatureStatus,
	Roadmap,
	RoadmapEpic,
	RoadmapFeature,
	RoadmapMilestone,
	RoadmapStatus,
	RoadmapTask,
	TaskPriority,
	TaskStatus,
} from "@/types/roadmap";

// ============================================================================
// Type Definitions
// ============================================================================

export class RoadmapServiceError extends Error {
	constructor(
		message: string,
		public statusCode?: number,
		public originalError?: unknown,
	) {
		super(message);
		this.name = "RoadmapServiceError";
	}
}

/**
 * Handle API errors consistently
 */
function handleServiceError(error: unknown, operation: string): never {
	console.error(`[RoadmapService] ${operation} failed:`, error);

	if (error instanceof Error) {
		// Axios errors have a response property
		const axiosError = error as any;
		if (axiosError.response) {
			const status = axiosError.response.status;
			const responseError = axiosError.response.data?.error;
			const message =
				(typeof responseError === "string"
					? responseError
					: responseError?.message) ||
				axiosError.response.data?.message ||
				error.message;

			throw new RoadmapServiceError(
				`${operation} failed: ${message}`,
				status,
				error,
			);
		}
		throw new RoadmapServiceError(
			`${operation} failed: ${error.message}`,
			undefined,
			error,
		);
	}

	throw new RoadmapServiceError(
		`${operation} failed: Unknown error`,
		undefined,
		error,
	);
}

export interface ApiResponse<T> {
	success: boolean;
	data: T;
	message?: string;
	error?: string;
}

// Full roadmap structure with nested data
export interface FullRoadmap extends Roadmap {
	milestones: RoadmapMilestone[];
	epics: RoadmapEpic[];
}

// Roadmap DTOs
export interface CreateRoadmapDto {
	name: string;
	description?: string;
	category?: string;
	project_id?: string | null;
	status?: RoadmapStatus;
	start_date?: string;
	end_date?: string;
	settings?: Record<string, any>;
}

export interface UpdateRoadmapDto {
	name?: string;
	description?: string;
	category?: string;
	project_id?: string | null;
	status?: RoadmapStatus;
	start_date?: string;
	end_date?: string;
	settings?: Record<string, any>;
	preview_url?: string;
	is_public?: boolean;
	is_templatable?: boolean;
}

export interface UpdateRoadmapTemplateSettingsDto {
	is_public?: boolean;
	is_templatable?: boolean;
}

export interface UpsertFullRoadmapTaskDto {
	id?: string;
	title: string;
	description?: string;
	status?: TaskStatus;
	priority?: TaskPriority;
	assignee_id?: string;
	due_date?: string;
	position?: number;
}

export interface UpsertFullRoadmapFeatureDto {
	id?: string;
	title: string;
	description?: string;
	status?: FeatureStatus;
	position?: number;
	is_deliverable?: boolean;
	start_date?: string;
	end_date?: string;
	roadmap_tasks?: UpsertFullRoadmapTaskDto[];
}

export interface UpsertFullRoadmapEpicDto {
	id?: string;
	title: string;
	description?: string;
	status?: EpicStatus;
	priority?: EpicPriority;
	position?: number;
	color?: string;
	start_date?: string;
	end_date?: string;
	tags?: string[];
	roadmap_features?: UpsertFullRoadmapFeatureDto[];
}

export interface UpsertFullRoadmapDto {
	id?: string;
	name: string;
	description?: string;
	project_id?: string;
	status?: RoadmapStatus;
	start_date?: string;
	end_date?: string;
	settings?: Record<string, any>;
	roadmap_epics?: UpsertFullRoadmapEpicDto[];
}

// Milestone DTOs
export interface CreateMilestoneDto {
	title: string;
	description?: string;
	target_date: string;
	status?: RoadmapMilestone["status"];
	position?: number;
	color?: string;
}

export interface UpdateMilestoneDto {
	title?: string;
	description?: string;
	target_date?: string;
	status?: RoadmapMilestone["status"];
	color?: string;
}

// Epic DTOs
export interface CreateEpicDto {
	roadmap_id: string;
	title: string;
	description?: string;
	priority?: EpicPriority;
	status?: EpicStatus;
	position?: number;
	color?: string;
	estimated_hours?: number;
	start_date?: string;
	end_date?: string;
	tags?: string[];
	labels?: Array<{ id: string; name: string; color: string }>;
}

export interface UpdateEpicDto {
	title?: string;
	description?: string;
	priority?: EpicPriority;
	status?: EpicStatus;
	position?: number;
	color?: string;
	estimated_hours?: number;
	actual_hours?: number;
	start_date?: string;
	end_date?: string;
	completed_date?: string;
	tags?: string[];
	labels?: Array<{ id: string; name: string; color: string }>;
}

export interface ReorderEpicDto {
	epic_id: string;
	new_order_index: number;
}

// Feature DTOs
export interface CreateFeatureDto {
	roadmap_id: string;
	epic_id: string;
	title: string;
	description?: string;
	status?: FeatureStatus;
	position?: number;
	is_deliverable?: boolean;
	estimated_hours?: number;
	start_date?: string;
	end_date?: string;
}

export interface UpdateFeatureDto {
	title?: string;
	description?: string;
	status?: FeatureStatus;
	position?: number;
	is_deliverable?: boolean;
	estimated_hours?: number;
	actual_hours?: number;
	start_date?: string;
	end_date?: string;
}

export interface ReorderFeatureDto {
	feature_id: string;
	new_order_index: number;
}

export interface LinkFeatureToMilestoneDto {
	feature_id: string;
	milestone_id: string;
}

// Task DTOs
export interface CreateTaskDto {
	feature_id: string;
	title: string;
	status?: TaskStatus;
	priority?: TaskPriority;
	position?: number;
	assignee_id?: string | null;
	due_date?: string;
}

export interface UpdateTaskDto {
	title?: string;
	status?: TaskStatus;
	priority?: TaskPriority;
	position?: number;
	assignee_id?: string | null;
	due_date?: string | null;
	completed_at?: string;
}

export interface ReorderTaskDto {
	task_id: string;
	new_order_index: number;
}

export interface AssignTaskDto {
	task_id: string;
	user_id: string;
}

const normalizeComment = (raw: any): Comment => {
	const normalizedUser = raw.user ?? raw.author;
	const normalizedUserId = raw.user_id ?? raw.author_id ?? normalizedUser?.id;
	const resolvedUpdatedAt = raw.updated_at ?? raw.created_at;
	const resolvedEditedAt =
		raw.edited_at ??
		(resolvedUpdatedAt && raw.created_at && resolvedUpdatedAt !== raw.created_at
			? resolvedUpdatedAt
			: undefined);

	return {
		id: raw.id,
		user_id: normalizedUserId,
		author_id: raw.author_id,
		content: raw.content,
		created_at: raw.created_at,
		updated_at: resolvedUpdatedAt,
		edited_at: resolvedEditedAt,
		user: normalizedUser
			? {
					id: normalizedUser.id,
					display_name: normalizedUser.display_name,
					first_name: normalizedUser.first_name,
					last_name: normalizedUser.last_name,
					avatar_url: normalizedUser.avatar_url,
					email: normalizedUser.email,
				}
			: undefined,
	};
};

// ============================================================================
// Roadmap Service
// ============================================================================

export const roadmapService = {
	/**
	 * Get all roadmaps for the authenticated user
	 */
	async getAll(): Promise<Roadmap[]> {
		try {
			const response =
				await apiClient.get<ApiResponse<Roadmap[]>>("/api/roadmaps");
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, "Get all roadmaps");
		}
	},

	/**
	 * Get a single roadmap by ID
	 */
	async getById(id: string): Promise<Roadmap> {
		try {
			const response = await apiClient.get<ApiResponse<Roadmap>>(
				`/api/roadmaps/${id}`,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, `Get roadmap ${id}`);
		}
	},

	/**
	 * Get a roadmap with all nested entities (milestones, epics, features, tasks)
	 */
	async getFull(id: string): Promise<FullRoadmap> {
		try {
			const response = await apiClient.get<ApiResponse<FullRoadmap>>(
				`/api/roadmaps/${id}/full`,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, `Get full roadmap ${id}`);
		}
	},

	/**
	 * Create a new roadmap
	 */
	async create(data: CreateRoadmapDto): Promise<Roadmap> {
		try {
			const response = await apiClient.post<ApiResponse<Roadmap>>(
				"/api/roadmaps",
				data,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, "Create roadmap");
		}
	},

	async upsertFull(data: UpsertFullRoadmapDto): Promise<FullRoadmap> {
		try {
			const response = await apiClient.post<ApiResponse<FullRoadmap>>(
				"/api/roadmaps/full",
				data,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, "Upsert full roadmap");
		}
	},

	/**
	 * Replace the empty roadmap currently linked to a project with an
	 * existing unlinked roadmap. The previous empty roadmap is deleted
	 * server-side as part of the swap.
	 */
	async replaceProjectRoadmap(
		projectId: string,
		replacementRoadmapId: string,
	): Promise<Roadmap> {
		try {
			const response = await apiClient.post<ApiResponse<Roadmap>>(
				"/api/roadmaps/replace-for-project",
				{
					project_id: projectId,
					replacement_roadmap_id: replacementRoadmapId,
				},
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(
				error,
				`Replace roadmap for project ${projectId}`,
			);
		}
	},

	/**
	 * Update an existing roadmap
	 */
	async update(id: string, data: UpdateRoadmapDto): Promise<Roadmap> {
		try {
			const response = await apiClient.patch<ApiResponse<Roadmap>>(
				`/api/roadmaps/${id}`,
				data,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, `Update roadmap ${id}`);
		}
	},

	/**
	 * Get the roadmap linked to a specific project
	 */
	async getByProjectId(projectId: string): Promise<Roadmap | null> {
		try {
			const response = await apiClient.get<ApiResponse<Roadmap>>(
				`/api/roadmaps/project/${projectId}`,
			);
			return response.data.data ?? null;
		} catch (error) {
			if (isAxiosError(error) && error.response?.status === 404) {
				return null;
			}
			throw handleServiceError(error, `Get roadmap for project ${projectId}`);
		}
	},

	async getConsultantTemplateRoadmaps(): Promise<Roadmap[]> {
		try {
			const response = await apiClient.get<ApiResponse<Roadmap[]>>(
				"/api/roadmaps/consultant/templates/mine",
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, "Get consultant template roadmaps");
		}
	},

	async getPublicTemplates(): Promise<Roadmap[]> {
		try {
			const response = await apiClient.get<ApiResponse<Roadmap[]>>(
				"/api/roadmaps/templates/public",
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, "Get public templates");
		}
	},

	async updateTemplateSettings(
		id: string,
		data: UpdateRoadmapTemplateSettingsDto,
	): Promise<Roadmap> {
		try {
			const response = await apiClient.patch<ApiResponse<Roadmap>>(
				`/api/roadmaps/${id}/template-settings`,
				data,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(
				error,
				`Update template settings for roadmap ${id}`,
			);
		}
	},

	async cloneFromTemplate(id: string): Promise<Roadmap> {
		try {
			const response = await apiClient.post<ApiResponse<Roadmap>>(
				`/api/roadmaps/${id}/clone-from-template`,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, `Clone roadmap template ${id}`);
		}
	},

	/**
	 * Delete a roadmap
	 */
	async delete(id: string): Promise<void> {
		try {
			await apiClient.delete(`/api/roadmaps/${id}`);
		} catch (error) {
			throw handleServiceError(error, `Delete roadmap ${id}`);
		}
	},
};

// ============================================================================
// Milestone Service
// ============================================================================

export const milestoneService = {
	async getAll(roadmapId: string): Promise<RoadmapMilestone[]> {
		try {
			const response = await apiClient.get<ApiResponse<RoadmapMilestone[]>>(
				`/api/roadmaps/${roadmapId}/milestones`,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(
				error,
				`Get milestones for roadmap ${roadmapId}`,
			);
		}
	},

	async create(
		roadmapId: string,
		data: CreateMilestoneDto,
	): Promise<RoadmapMilestone> {
		try {
			const response = await apiClient.post<ApiResponse<RoadmapMilestone>>(
				`/api/roadmaps/${roadmapId}/milestones`,
				data,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, "Create milestone");
		}
	},

	async update(
		id: string,
		data: UpdateMilestoneDto,
	): Promise<RoadmapMilestone> {
		try {
			const response = await apiClient.patch<ApiResponse<RoadmapMilestone>>(
				`/api/roadmaps/milestones/${id}`,
				data,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, `Update milestone ${id}`);
		}
	},

	async delete(id: string): Promise<void> {
		try {
			await apiClient.delete(`/api/roadmaps/milestones/${id}`);
		} catch (error) {
			throw handleServiceError(error, `Delete milestone ${id}`);
		}
	},
};

// ============================================================================
// Epic Service
// ============================================================================

export const epicService = {
	/**
	 * Get all epics for a roadmap
	 */
	async getAll(roadmapId: string): Promise<RoadmapEpic[]> {
		try {
			const response = await apiClient.get<ApiResponse<RoadmapEpic[]>>(
				`/api/epics?roadmap_id=${roadmapId}`,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, `Get epics for roadmap ${roadmapId}`);
		}
	},

	/**
	 * Get a single epic by ID
	 */
	async getById(id: string): Promise<RoadmapEpic> {
		try {
			const response = await apiClient.get<ApiResponse<RoadmapEpic>>(
				`/api/epics/${id}`,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, `Get epic ${id}`);
		}
	},

	/**
	 * Create a new epic
	 */
	async create(data: CreateEpicDto): Promise<RoadmapEpic> {
		try {
			const response = await apiClient.post<ApiResponse<RoadmapEpic>>(
				"/api/epics",
				data,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, "Create epic");
		}
	},

	/**
	 * Update an existing epic
	 */
	async update(id: string, data: UpdateEpicDto): Promise<RoadmapEpic> {
		try {
			const response = await apiClient.patch<ApiResponse<RoadmapEpic>>(
				`/api/epics/${id}`,
				data,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, `Update epic ${id}`);
		}
	},

	/**
	 * Reorder epics within a roadmap
	 */
	async reorder(roadmapId: string, reorders: ReorderEpicDto[]): Promise<void> {
		try {
			const items = reorders.map((item) => ({
				id: item.epic_id,
				position: item.new_order_index,
			}));
			await apiClient.patch(`/api/epics/reorder`, {
				roadmap_id: roadmapId,
				items,
			});
		} catch (error) {
			throw handleServiceError(error, `Reorder epics in roadmap ${roadmapId}`);
		}
	},

	/**
	 * Delete an epic
	 */
	async delete(id: string): Promise<void> {
		try {
			await apiClient.delete(`/api/epics/${id}`);
		} catch (error) {
			throw handleServiceError(error, `Delete epic ${id}`);
		}
	},
};

// ============================================================================
// Feature Service
// ============================================================================

export const featureService = {
	/**
	 * Get all features for an epic
	 */
	async getAll(epicId: string): Promise<RoadmapFeature[]> {
		try {
			const response = await apiClient.get<ApiResponse<RoadmapFeature[]>>(
				`/api/features?epic_id=${epicId}`,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, `Get features for epic ${epicId}`);
		}
	},

	/**
	 * Get a single feature by ID
	 */
	async getById(id: string): Promise<RoadmapFeature> {
		try {
			const response = await apiClient.get<ApiResponse<RoadmapFeature>>(
				`/api/features/${id}`,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, `Get feature ${id}`);
		}
	},

	/**
	 * Create a new feature
	 */
	async create(data: CreateFeatureDto): Promise<RoadmapFeature> {
		try {
			const response = await apiClient.post<ApiResponse<RoadmapFeature>>(
				"/api/features",
				data,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, "Create feature");
		}
	},

	/**
	 * Update an existing feature
	 */
	async update(id: string, data: UpdateFeatureDto): Promise<RoadmapFeature> {
		try {
			const response = await apiClient.patch<ApiResponse<RoadmapFeature>>(
				`/api/features/${id}`,
				data,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, `Update feature ${id}`);
		}
	},

	/**
	 * Reorder features within an epic
	 */
	async reorder(epicId: string, reorders: ReorderFeatureDto[]): Promise<void> {
		try {
			const items = reorders.map((item) => ({
				id: item.feature_id,
				position: item.new_order_index,
			}));
			await apiClient.patch(`/api/features/reorder`, {
				epic_id: epicId,
				items,
			});
		} catch (error) {
			throw handleServiceError(error, `Reorder features in epic ${epicId}`);
		}
	},

	/**
	 * Link a feature to a milestone
	 */
	async linkToMilestone(data: LinkFeatureToMilestoneDto): Promise<void> {
		try {
			await apiClient.post(`/api/features/link-milestone`, data);
		} catch (error) {
			throw handleServiceError(
				error,
				`Link feature ${data.feature_id} to milestone ${data.milestone_id}`,
			);
		}
	},

	/**
	 * Unlink a feature from a milestone
	 */
	async unlinkFromMilestone(
		featureId: string,
		milestoneId: string,
	): Promise<void> {
		try {
			await apiClient.post(`/api/features/unlink-milestone`, {
				feature_id: featureId,
				milestone_id: milestoneId,
			});
		} catch (error) {
			throw handleServiceError(
				error,
				`Unlink feature ${featureId} from milestone ${milestoneId}`,
			);
		}
	},

	/**
	 * Delete a feature
	 */
	async delete(id: string): Promise<void> {
		try {
			await apiClient.delete(`/api/features/${id}`);
		} catch (error) {
			throw handleServiceError(error, `Delete feature ${id}`);
		}
	},
};

// ============================================================================
// Task Service
// ============================================================================

export const taskService = {
	/**
	 * Get all tasks for a feature
	 */
	async getAll(featureId: string): Promise<RoadmapTask[]> {
		try {
			const response = await apiClient.get<ApiResponse<RoadmapTask[]>>(
				`/api/tasks?feature_id=${featureId}`,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, `Get tasks for feature ${featureId}`);
		}
	},

	/**
	 * Get a single task by ID
	 */
	async getById(id: string): Promise<RoadmapTask> {
		try {
			const response = await apiClient.get<ApiResponse<RoadmapTask>>(
				`/api/tasks/${id}`,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, `Get task ${id}`);
		}
	},

	/**
	 * Create a new task
	 */
	async create(data: CreateTaskDto): Promise<RoadmapTask> {
		try {
			const response = await apiClient.post<ApiResponse<RoadmapTask>>(
				"/api/tasks",
				data,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, "Create task");
		}
	},

	/**
	 * Update an existing task
	 */
	async update(id: string, data: UpdateTaskDto): Promise<RoadmapTask> {
		try {
			const response = await apiClient.patch<ApiResponse<RoadmapTask>>(
				`/api/tasks/${id}`,
				data,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, `Update task ${id}`);
		}
	},

	/**
	 * Reorder tasks within a feature
	 */
	async reorder(featureId: string, reorders: ReorderTaskDto[]): Promise<void> {
		try {
			await apiClient.patch(`/api/tasks/reorder`, {
				feature_id: featureId,
				reorders,
			});
		} catch (error) {
			throw handleServiceError(error, `Reorder tasks in feature ${featureId}`);
		}
	},

	/**
	 * Assign a task to a user
	 */
	async assign(data: AssignTaskDto): Promise<RoadmapTask> {
		try {
			const response = await apiClient.post<ApiResponse<RoadmapTask>>(
				"/api/tasks/assign",
				data,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(
				error,
				`Assign task ${data.task_id} to user ${data.user_id}`,
			);
		}
	},

	/**
	 * Unassign a task from a user
	 */
	async unassign(taskId: string): Promise<RoadmapTask> {
		try {
			const response = await apiClient.post<ApiResponse<RoadmapTask>>(
				"/api/tasks/unassign",
				{
					task_id: taskId,
				},
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, `Unassign task ${taskId}`);
		}
	},

	/**
	 * Delete a task
	 */
	async delete(id: string): Promise<void> {
		try {
			await apiClient.delete(`/api/tasks/${id}`);
		} catch (error) {
			throw handleServiceError(error, `Delete task ${id}`);
		}
	},
};

export const commentsService = {
	async getEpicComments(epicId: string): Promise<Comment[]> {
		try {
			const response = await apiClient.get<ApiResponse<any[]>>(
				`/api/epics/${epicId}/comments`,
			);
			return (response.data.data ?? []).map(normalizeComment);
		} catch (error) {
			throw handleServiceError(error, `Get comments for epic ${epicId}`);
		}
	},

	async addEpicComment(epicId: string, content: string): Promise<Comment> {
		try {
			const response = await apiClient.post<ApiResponse<any>>(
				`/api/epics/${epicId}/comments`,
				{ content },
			);
			return normalizeComment(response.data.data);
		} catch (error) {
			throw handleServiceError(error, `Add comment to epic ${epicId}`);
		}
	},

	async updateEpicComment(
		epicId: string,
		commentId: string,
		content: string,
	): Promise<Comment> {
		try {
			const response = await apiClient.patch<ApiResponse<any>>(
				`/api/epics/${epicId}/comments/${commentId}`,
				{ content },
			);
			return normalizeComment(response.data.data);
		} catch (error) {
			throw handleServiceError(
				error,
				`Update comment ${commentId} on epic ${epicId}`,
			);
		}
	},

	async deleteEpicComment(epicId: string, commentId: string): Promise<void> {
		try {
			await apiClient.delete(`/api/epics/${epicId}/comments/${commentId}`);
		} catch (error) {
			throw handleServiceError(
				error,
				`Delete comment ${commentId} on epic ${epicId}`,
			);
		}
	},

	async getFeatureComments(featureId: string): Promise<Comment[]> {
		try {
			const response = await apiClient.get<ApiResponse<any[]>>(
				`/api/features/${featureId}/comments`,
			);
			return (response.data.data ?? []).map(normalizeComment);
		} catch (error) {
			throw handleServiceError(error, `Get comments for feature ${featureId}`);
		}
	},

	async addFeatureComment(
		featureId: string,
		content: string,
	): Promise<Comment> {
		try {
			const response = await apiClient.post<ApiResponse<any>>(
				`/api/features/${featureId}/comments`,
				{ content },
			);
			return normalizeComment(response.data.data);
		} catch (error) {
			throw handleServiceError(error, `Add comment to feature ${featureId}`);
		}
	},

	async updateFeatureComment(
		featureId: string,
		commentId: string,
		content: string,
	): Promise<Comment> {
		try {
			const response = await apiClient.patch<ApiResponse<any>>(
				`/api/features/${featureId}/comments/${commentId}`,
				{ content },
			);
			return normalizeComment(response.data.data);
		} catch (error) {
			throw handleServiceError(
				error,
				`Update comment ${commentId} on feature ${featureId}`,
			);
		}
	},

	async deleteFeatureComment(
		featureId: string,
		commentId: string,
	): Promise<void> {
		try {
			await apiClient.delete(
				`/api/features/${featureId}/comments/${commentId}`,
			);
		} catch (error) {
			throw handleServiceError(
				error,
				`Delete comment ${commentId} on feature ${featureId}`,
			);
		}
	},

	async getTaskComments(taskId: string): Promise<Comment[]> {
		try {
			const response = await apiClient.get<ApiResponse<any[]>>(
				`/api/tasks/${taskId}/comments`,
			);
			return (response.data.data ?? []).map(normalizeComment);
		} catch (error) {
			throw handleServiceError(error, `Get comments for task ${taskId}`);
		}
	},

	async addTaskComment(taskId: string, content: string): Promise<Comment> {
		try {
			const response = await apiClient.post<ApiResponse<any>>(
				`/api/tasks/${taskId}/comments`,
				{ content },
			);
			return normalizeComment(response.data.data);
		} catch (error) {
			throw handleServiceError(error, `Add comment to task ${taskId}`);
		}
	},

	async updateTaskComment(
		taskId: string,
		commentId: string,
		content: string,
	): Promise<Comment> {
		try {
			const response = await apiClient.patch<ApiResponse<any>>(
				`/api/tasks/${taskId}/comments/${commentId}`,
				{ content },
			);
			return normalizeComment(response.data.data);
		} catch (error) {
			throw handleServiceError(
				error,
				`Update comment ${commentId} on task ${taskId}`,
			);
		}
	},

	async deleteTaskComment(taskId: string, commentId: string): Promise<void> {
		try {
			await apiClient.delete(`/api/tasks/${taskId}/comments/${commentId}`);
		} catch (error) {
			throw handleServiceError(
				error,
				`Delete comment ${commentId} on task ${taskId}`,
			);
		}
	},
};

// ============================================================================
// Unified Export
// ============================================================================

export const roadmapServiceAPI = {
	roadmaps: roadmapService,
	milestones: milestoneService,
	epics: epicService,
	features: featureService,
	tasks: taskService,
	comments: commentsService,
};

export default roadmapServiceAPI;
