import apiClient from "@/api/axios";

export type TimeLogStatus = "pending" | "approved" | "rejected";
export type TimeLogReviewDecision = "pending" | "approved" | "rejected";

export interface ProfileMini {
	id: string;
	display_name: string | null;
	avatar_url: string | null;
	first_name?: string | null;
	last_name?: string | null;
	email?: string | null;
}

export interface TaskTimeLog {
	id: string;
	project_id: string;
	task_id: string | null;
	member_user_id: string;
	team_id: string | null;
	started_at: string;
	ended_at: string | null;
	duration_seconds: number | null;
	status: TimeLogStatus;
	reviewed_by: string | null;
	reviewed_at: string | null;
	review_note: string | null;
	source: "timer" | "manual";
	rate_snapshot: number;
	currency_snapshot: string;
	created_at: string;
	updated_at: string;
	task?: { id: string; title: string } | null;
	member?: ProfileMini | null;
	reviewer?: Pick<ProfileMini, "id" | "display_name" | "avatar_url"> | null;
	project?: { id: string; title: string | null } | null;
}

export interface TimeLogListResult {
	items: TaskTimeLog[];
	total: number;
}

export interface ResolvedTeamRate {
	team_id: string;
	hourly_rate: number;
	currency: string;
}

export interface ProjectTaskOption {
	id: string;
	title: string;
	feature_id: string;
	feature_title: string | null;
	epic_id: string | null;
	epic_title: string | null;
}

export interface TeamLogProject {
	id: string;
	title: string | null;
}

export interface TeamLogMember {
	id: string;
	display_name: string | null;
	avatar_url: string | null;
	email: string | null;
}

export interface ListLogsQuery {
	status?: TimeLogStatus;
	project_id?: string;
	member_user_id?: string;
	from?: string;
	to?: string;
	page?: number;
	limit?: number;
}

type ApiResponse<T> = { data: T };

function extractError(error: unknown, fallback: string): Error {
	const e = error as {
		response?: {
			status?: number;
			data?: { error?: { message?: string }; message?: string };
		};
		message?: string;
	};
	const message =
		e?.response?.data?.error?.message ||
		e?.response?.data?.message ||
		e?.message ||
		fallback;
	const wrapped = new Error(message) as Error & {
		status?: number;
		cause?: unknown;
	};
	wrapped.status = e?.response?.status;
	wrapped.cause = error;
	return wrapped;
}

function normalizeNullableUuid(value?: string | null): string | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (trimmed.length === 0) return null;
	const lower = trimmed.toLowerCase();
	if (lower === "null" || lower === "undefined") return null;
	const uuidV4Like =
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	return uuidV4Like.test(trimmed) ? trimmed : null;
}

export const teamTimeService = {
	async startLog(
		projectId: string,
		taskId?: string | null,
	): Promise<TaskTimeLog> {
		try {
			const res = await apiClient.post<ApiResponse<TaskTimeLog>>(
				"/api/team-time/logs/start",
				{
					project_id: projectId,
					task_id: normalizeNullableUuid(taskId),
				},
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to start timer");
		}
	},

	async stopLog(logId: string, endedAt?: string): Promise<TaskTimeLog> {
		try {
			const res = await apiClient.post<ApiResponse<TaskTimeLog>>(
				`/api/team-time/logs/${logId}/stop`,
				endedAt ? { ended_at: endedAt } : {},
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to stop timer");
		}
	},

	async updateLog(
		logId: string,
		payload: {
			task_id?: string | null;
			started_at?: string;
			ended_at?: string;
		},
	): Promise<TaskTimeLog> {
		try {
			const normalizedPayload =
				Object.prototype.hasOwnProperty.call(payload, "task_id")
					? {
							...payload,
							task_id: normalizeNullableUuid(payload.task_id),
						}
					: payload;
			const res = await apiClient.patch<ApiResponse<TaskTimeLog>>(
				`/api/team-time/logs/${logId}`,
				normalizedPayload,
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to update time log");
		}
	},

	async deleteLog(logId: string): Promise<void> {
		try {
			await apiClient.delete(`/api/team-time/logs/${logId}`);
		} catch (e) {
			throw extractError(e, "Failed to delete time log");
		}
	},

	async createManualLog(payload: {
		project_id: string;
		task_id?: string | null;
		started_at: string;
		ended_at: string;
	}): Promise<TaskTimeLog> {
		try {
			const normalizedPayload = {
				...payload,
				task_id: normalizeNullableUuid(payload.task_id),
			};
			const res = await apiClient.post<ApiResponse<TaskTimeLog>>(
				"/api/team-time/logs/manual",
				normalizedPayload,
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to create time log");
		}
	},

	async getLog(logId: string): Promise<TaskTimeLog> {
		try {
			const res = await apiClient.get<ApiResponse<TaskTimeLog>>(
				`/api/team-time/logs/${logId}`,
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to load time log");
		}
	},

	async reviewLog(
		logId: string,
		decision: TimeLogReviewDecision,
		reason?: string,
	): Promise<TaskTimeLog> {
		try {
			const res = await apiClient.post<ApiResponse<TaskTimeLog>>(
				`/api/team-time/logs/${logId}/review`,
				{ decision, reason },
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to review time log");
		}
	},

	async reviewLogsBulk(
		logIds: string[],
		decision: TimeLogReviewDecision,
		reason?: string,
	): Promise<{ reviewed: number }> {
		try {
			const res = await apiClient.post<ApiResponse<{ reviewed: number }>>(
				"/api/team-time/logs/review-bulk",
				{ log_ids: logIds, decision, reason },
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to review time logs");
		}
	},

	async listMyTeamLogs(
		teamId: string,
		query?: ListLogsQuery,
	): Promise<TimeLogListResult> {
		try {
			const res = await apiClient.get<ApiResponse<TimeLogListResult>>(
				`/api/team-time/teams/${teamId}/my`,
				{ params: query },
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to fetch your team logs");
		}
	},

	async getMyTeamProjectRate(
		teamId: string,
		projectId: string,
	): Promise<ResolvedTeamRate | null> {
		try {
			const res = await apiClient.get<ApiResponse<ResolvedTeamRate | null>>(
				`/api/team-time/teams/${teamId}/projects/${projectId}/my-rate`,
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to fetch your project rate");
		}
	},

	async listTeamProjectTasks(
		teamId: string,
		projectId: string,
	): Promise<ProjectTaskOption[]> {
		try {
			const res = await apiClient.get<ApiResponse<ProjectTaskOption[]>>(
				`/api/team-time/teams/${teamId}/projects/${projectId}/tasks`,
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to fetch project tasks");
		}
	},

	async listTeamLogs(
		teamId: string,
		query?: ListLogsQuery,
	): Promise<TimeLogListResult> {
		try {
			const res = await apiClient.get<ApiResponse<TimeLogListResult>>(
				`/api/team-time/teams/${teamId}/logs`,
				{ params: query },
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to fetch team logs");
		}
	},

	async listTeamLogProjects(
		teamId: string,
	): Promise<TeamLogProject[]> {
		try {
			const res = await apiClient.get<ApiResponse<TeamLogProject[]>>(
				`/api/team-time/teams/${teamId}/projects`,
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to fetch team projects");
		}
	},

	async listTeamLogMembers(
		teamId: string,
	): Promise<TeamLogMember[]> {
		try {
			const res = await apiClient.get<ApiResponse<TeamLogMember[]>>(
				`/api/team-time/teams/${teamId}/members`,
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to fetch team members");
		}
	},
};
