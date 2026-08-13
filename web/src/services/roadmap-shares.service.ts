/**
 * Roadmap Sharing Service Layer
 * Handles all sharing and commenting operations for roadmaps
 */

import { apiClient } from "@/api";
import type {
	Comment,
	InvitedUser,
	Roadmap,
	RoadmapShare,
	ShareRole,
} from "@/types/roadmap";
import { RoadmapServiceError } from "./roadmap.service";

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Handle API errors consistently
 */
function handleServiceError(error: unknown, operation: string): never {
	console.error(`[RoadmapShareService] ${operation} failed:`, error);

	if (error instanceof Error) {
		// Axios errors have a response property
		const axiosError = error as any;
		if (axiosError.response) {
			const status = axiosError.response.status;
			const message =
				axiosError.response.data?.error ||
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

export interface ShareRoadmapConfig {
	invitedEmails: InvitedUser[];
	defaultRole: ShareRole;
	expiresAt?: string;
}

export interface RoadmapShareWithUrl extends RoadmapShare {
	share_url: string;
}

export interface SharedRoadmapInfo {
	roadmap: Roadmap;
	owner: {
		id: string;
		display_name?: string;
		first_name?: string;
		last_name?: string;
		avatar_url?: string;
	};
	accessLevel: ShareRole;
	sharedAt: string;
}

// Full roadmap structure with nested data (for shared access)
export interface FullRoadmap extends Roadmap {
	currentUserRole?: ShareRole;
	milestones: any[];
	epics: any[];
}

// ============================================================================
// Sharing Service
// ============================================================================

export const sharingService = {
	/**
	 * Create or update share configuration for a roadmap
	 */
	async shareRoadmap(
		roadmapId: string,
		config: ShareRoadmapConfig,
	): Promise<RoadmapShareWithUrl> {
		try {
			const response = await apiClient.post<ApiResponse<RoadmapShareWithUrl>>(
				`/api/roadmap-shares/${roadmapId}`,
				config,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, `Share roadmap ${roadmapId}`);
		}
	},

	/**
	 * Get current share settings for a roadmap
	 */
	async getShareSettings(
		roadmapId: string,
	): Promise<RoadmapShareWithUrl | null> {
		try {
			const response = await apiClient.get<
				ApiResponse<RoadmapShareWithUrl | null>
			>(`/api/roadmap-shares/${roadmapId}`);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(
				error,
				`Get share settings for roadmap ${roadmapId}`,
			);
		}
	},

	/**
	 * Disable sharing for a roadmap
	 */
	async disableSharing(roadmapId: string): Promise<void> {
		try {
			await apiClient.delete(`/api/roadmap-shares/${roadmapId}`);
		} catch (error) {
			throw handleServiceError(
				error,
				`Disable sharing for roadmap ${roadmapId}`,
			);
		}
	},

	/**
	 * Access a roadmap via public share token
	 */
	async getRoadmapByShareToken(token: string): Promise<FullRoadmap> {
		try {
			const response = await apiClient.get<ApiResponse<FullRoadmap>>(
				`/api/roadmap-shares/token/${token}`,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, `Access roadmap via share token`);
		}
	},

	/**
	 * Get list of roadmaps shared with the current user
	 */
	async getSharedWithMe(): Promise<SharedRoadmapInfo[]> {
		try {
			const response = await apiClient.get<ApiResponse<SharedRoadmapInfo[]>>(
				`/api/roadmap-shares/shared-with-me`,
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, `Get shared roadmaps`);
		}
	},
};

// ============================================================================
// Comments Service
// ============================================================================

export const commentsService = {
	/**
	 * Add a comment to an epic
	 */
	async addEpicComment(epicId: string, content: string): Promise<Comment> {
		try {
			const response = await apiClient.post<ApiResponse<Comment>>(
				`/api/roadmap-shares/epic/${epicId}/comments`,
				{ content },
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, `Add comment to epic ${epicId}`);
		}
	},

	/**
	 * Add a comment to a feature
	 */
	async addFeatureComment(
		featureId: string,
		content: string,
	): Promise<Comment> {
		try {
			const response = await apiClient.post<ApiResponse<Comment>>(
				`/api/roadmap-shares/feature/${featureId}/comments`,
				{ content },
			);
			return response.data.data;
		} catch (error) {
			throw handleServiceError(error, `Add comment to feature ${featureId}`);
		}
	},
};

// ============================================================================
// Unified Export
// ============================================================================

export const roadmapSharesServiceAPI = {
	sharing: sharingService,
	comments: commentsService,
};

export default roadmapSharesServiceAPI;
