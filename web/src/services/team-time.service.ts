import apiClient from "@/api/axios";

export type TimeLogStatus = "pending" | "approved" | "paid" | "rejected";
export type TimeLogReviewDecision = "pending" | "approved" | "paid" | "rejected";
export type TaskWorkType = "real_work" | "training";

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
	break_minutes?: number;
	status: TimeLogStatus;
	reviewed_by: string | null;
	reviewed_at: string | null;
	review_note: string | null;
	source: "timer" | "manual";
	rate_snapshot: number;
	currency_snapshot: string;
	work_type_snapshot: TaskWorkType;
	created_at: string;
	updated_at: string;
	limit_context?: TimeLogLimitContext;
	task?: { id: string; title: string; work_type?: TaskWorkType } | null;
	member?: ProfileMini | null;
	reviewer?: Pick<ProfileMini, "id" | "display_name" | "avatar_url"> | null;
	project?: { id: string; title: string | null } | null;
	day_review_summary?: TimeLogDaySummary;
	review_comments?: TimeLogComment[];
}

export interface TimeLogComment {
	id: string;
	log_id: string;
	author_user_id: string;
	body: string;
	created_at: string;
	updated_at: string;
	author?: ProfileMini | null;
}

export interface TimeLogDaySummary {
	day: string;
	total_logs: number;
	pending_logs: number;
	approved_logs: number;
	paid_logs: number;
	rejected_logs: number;
	total_seconds: number;
	limit_context?: TimeLogLimitContext;
}

export interface TimeLogLimitContext {
	over_limit: boolean;
	limit_window: "weekly" | "monthly" | null;
	limit_hours: number | null;
	logged_hours_in_window: number | null;
	overtime_requires_approval: boolean;
	window_start: string | null;
	window_end: string | null;
}

export interface TimeLogListResult {
	items: TaskTimeLog[];
	total: number;
}

export interface ResolvedTeamRate {
	team_id: string;
	hourly_rate: number;
	training_hourly_rate: number;
	currency: string;
	weekly_limit_hours: number | null;
	monthly_limit_hours: number | null;
	overtime_requires_approval: boolean;
}

export interface ProjectTaskOption {
	id: string;
	title: string;
	work_type?: TaskWorkType;
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

/** Per-currency fee totals split by status (mirrors the backend LogsSummary). */
export interface LogsSummaryBucket {
	pendingFees: number;
	approvedFees: number;
	paidFees: number;
	rejectedFees: number;
	totalFees: number;
}

/**
 * Accurate log aggregates over the full filtered set — not capped by the 200-row
 * list limit. Structurally compatible with the web `LogStats` used by the stats card.
 */
/** Log counts per status over the full filtered set (drives the Team Logs tabs). */
export interface LogStatusCounts {
	pending: number;
	approved: number;
	paid: number;
	rejected: number;
}

export interface LogsSummary {
	buckets: Record<string, LogsSummaryBucket>;
	currencies: string[];
	totalHours: number;
	statusCounts?: LogStatusCounts;
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

	async stopLog(logId: string, endedAt?: string, breakMinutes?: number): Promise<TaskTimeLog> {
		try {
			const body: { ended_at?: string; break_minutes?: number } = {};
			if (endedAt) body.ended_at = endedAt;
			if (typeof breakMinutes === "number") body.break_minutes = breakMinutes;
			const res = await apiClient.post<ApiResponse<TaskTimeLog>>(
				`/api/team-time/logs/${logId}/stop`,
				body,
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
			break_minutes?: number;
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
		break_minutes?: number;
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

	async getMyRunningLog(): Promise<TaskTimeLog | null> {
		try {
			const res = await apiClient.get<ApiResponse<TaskTimeLog | null>>(
				"/api/team-time/logs/me/running",
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to load running timer");
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
	): Promise<{ reviewed: number; day_summaries?: TimeLogDaySummary[] }> {
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

	async listLogComments(logId: string): Promise<TimeLogComment[]> {
		try {
			const res = await apiClient.get<ApiResponse<TimeLogComment[]>>(
				`/api/team-time/logs/${logId}/comments`,
			);
			return res.data.data ?? [];
		} catch (e) {
			throw extractError(e, "Failed to fetch log comments");
		}
	},

	async createLogComment(
		logId: string,
		body: string,
	): Promise<TimeLogComment> {
		try {
			const res = await apiClient.post<ApiResponse<TimeLogComment>>(
				`/api/team-time/logs/${logId}/comments`,
				{ body },
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to add log comment");
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

	async getTeamLogsSummary(
		teamId: string,
		query?: ListLogsQuery,
	): Promise<LogsSummary> {
		try {
			const res = await apiClient.get<ApiResponse<LogsSummary>>(
				`/api/team-time/teams/${teamId}/logs/summary`,
				{ params: query },
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to fetch team log totals");
		}
	},

	async getMyTeamLogsSummary(
		teamId: string,
		query?: ListLogsQuery,
	): Promise<LogsSummary> {
		try {
			const res = await apiClient.get<ApiResponse<LogsSummary>>(
				`/api/team-time/teams/${teamId}/my/summary`,
				{ params: query },
			);
			return res.data.data;
		} catch (e) {
			throw extractError(e, "Failed to fetch your log totals");
		}
	},

	/**
	 * Every approved log for a member (approved ⟹ unpaid), paginated past the
	 * 200-row list cap and filtered to one currency — the complete set the
	 * "Pay member" action must cover so a busy member isn't silently under-paid.
	 */
	async listAllMemberApprovedLogs(
		teamId: string,
		memberId: string,
		currency: string,
		range?: { from?: string; to?: string },
	): Promise<TaskTimeLog[]> {
		const PAGE = 200;
		const out: TaskTimeLog[] = [];
		for (let page = 1; ; page++) {
			const res = await this.listTeamLogs(teamId, {
				member_user_id: memberId,
				status: "approved",
				from: range?.from,
				to: range?.to,
				page,
				limit: PAGE,
			});
			out.push(...res.items);
			if (res.items.length < PAGE) break;
		}
		return out.filter((log) => (log.currency_snapshot || "USD") === currency);
	},

	/**
	 * Every team log of a given status, paginated past the 200-row cap. Used by
	 * Payouts to group outstanding (approved) balances by cut-off and to flag
	 * cut-offs that still have pending logs awaiting review.
	 */
	async listAllTeamLogsByStatus(
		teamId: string,
		status: TimeLogStatus,
	): Promise<TaskTimeLog[]> {
		const PAGE = 200;
		const out: TaskTimeLog[] = [];
		for (let page = 1; ; page++) {
			const res = await this.listTeamLogs(teamId, {
				status,
				page,
				limit: PAGE,
			});
			out.push(...res.items);
			if (res.items.length < PAGE) break;
		}
		return out;
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
