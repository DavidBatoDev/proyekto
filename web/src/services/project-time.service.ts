// @ts-nocheck
//
// REFERENCE: kept alongside the time route + component pages.
// Project-level Time page removed in May 2026; backend project-time
// module is gone, so calls to these functions error at runtime. Code
// kept for shape / query-key patterns when wiring time UI into the
// team detail page.

import { apiClient } from "@/api";

export type TimeLogStatus = "pending" | "approved" | "rejected";

export interface TaskTimeLog {
  id: string;
  project_id: string;
  task_id: string;
  member_user_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  status: TimeLogStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  source: "timer" | "manual";
  created_at: string;
  updated_at: string;
  task?: {
    id: string;
    title: string;
  };
  member?: {
    id: string;
    display_name?: string;
    email?: string;
    avatar_url?: string;
    banner_url?: string;
  };
  reviewer?: {
    id: string;
    display_name?: string;
    email?: string;
    avatar_url?: string;
  };
}

export interface TimeLogListResult {
  items: TaskTimeLog[];
  total: number;
  page: number;
  limit: number;
}

export interface ProjectMemberTimeRate {
  id: string;
  project_id: string;
  project_member_id: string;
  member_user_id: string;
  hourly_rate: number;
  currency: string;
  custom_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  created_at: string;
  updated_at: string;
  member?: {
    id: string;
    display_name?: string;
    email?: string;
    avatar_url?: string;
    banner_url?: string;
  };
  project_member?: {
    id: string;
    role?: string;
    position?: string;
  };
}

export interface ProjectTaskOption {
  id: string;
  title: string;
  feature_id: string;
  roadmap_id: string;
  feature_title?: string;
  epic_title?: string;
  feature_position?: number;
  epic_position?: number;
}

type ApiResponse<T> = {
  data: T;
};

function extractError(error: unknown, fallback: string): Error {
  const maybeAxios = error as {
    response?: {
      status?: number;
      data?: { error?: { message?: string }; message?: string };
    };
    message?: string;
  };
  const message =
    maybeAxios?.response?.data?.error?.message ||
    maybeAxios?.response?.data?.message ||
    maybeAxios?.message ||
    fallback;
  const wrappedError = new Error(message) as Error & {
    status?: number;
    cause?: unknown;
  };
  wrappedError.status = maybeAxios?.response?.status;
  wrappedError.cause = error;
  return wrappedError;
}

export const projectTimeService = {
  async start(projectId: string, taskId: string): Promise<TaskTimeLog> {
    try {
      const response = await apiClient.post<ApiResponse<TaskTimeLog>>(
        "/api/project-time/logs/start",
        {
          project_id: projectId,
          task_id: taskId,
        },
      );
      return response.data.data;
    } catch (error) {
      throw extractError(error, "Failed to start timer");
    }
  },

  async stop(logId: string, endedAt?: string): Promise<TaskTimeLog> {
    try {
      const response = await apiClient.post<ApiResponse<TaskTimeLog>>(
        `/api/project-time/logs/${logId}/stop`,
        endedAt ? { ended_at: endedAt } : {},
      );
      return response.data.data;
    } catch (error) {
      throw extractError(error, "Failed to stop timer");
    }
  },

  async update(
    logId: string,
    payload: {
      task_id?: string;
      started_at?: string;
      ended_at?: string;
      review_note?: string;
    },
  ): Promise<TaskTimeLog> {
    try {
      const response = await apiClient.patch<ApiResponse<TaskTimeLog>>(
        `/api/project-time/logs/${logId}`,
        payload,
      );
      return response.data.data;
    } catch (error) {
      throw extractError(error, "Failed to update time log");
    }
  },

  async delete(logId: string): Promise<void> {
    try {
      await apiClient.delete(`/api/project-time/logs/${logId}`);
    } catch (error) {
      throw extractError(error, "Failed to delete time log");
    }
  },

  async review(
    logId: string,
    decision: "approved" | "rejected" | "pending",
    reason?: string,
  ): Promise<TaskTimeLog> {
    try {
      const response = await apiClient.post<ApiResponse<TaskTimeLog>>(
        `/api/project-time/logs/${logId}/review`,
        {
          decision,
          reason,
        },
      );
      return response.data.data;
    } catch (error) {
      throw extractError(error, "Failed to review time log");
    }
  },

  async reviewBulk(
    logIds: string[],
    decision: "approved" | "rejected" | "pending",
    reason?: string,
  ): Promise<TaskTimeLog[]> {
    try {
      const response = await apiClient.post<ApiResponse<TaskTimeLog[]>>(
        "/api/project-time/logs/review-bulk",
        {
          log_ids: logIds,
          decision,
          reason,
        },
      );
      return response.data.data;
    } catch (error) {
      throw extractError(error, "Failed to review time logs");
    }
  },

  async listMyLogs(
    projectId: string,
    query?: {
      from?: string;
      to?: string;
      status?: TimeLogStatus;
      task_id?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<TimeLogListResult> {
    try {
      const response = await apiClient.get<ApiResponse<TimeLogListResult>>(
        `/api/project-time/projects/${projectId}/my`,
        { params: query },
      );
      return response.data.data;
    } catch (error) {
      throw extractError(error, "Failed to fetch time logs");
    }
  },

  async listApprovals(
    projectId: string,
    query?: {
      from?: string;
      to?: string;
      status?: TimeLogStatus;
      task_id?: string;
      member_user_id?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<TimeLogListResult> {
    try {
      const response = await apiClient.get<ApiResponse<TimeLogListResult>>(
        `/api/project-time/projects/${projectId}/approvals`,
        { params: query },
      );
      return response.data.data;
    } catch (error) {
      throw extractError(error, "Failed to fetch approval logs");
    }
  },

  async listTeamLogs(
    projectId: string,
    query?: {
      from?: string;
      to?: string;
      status?: TimeLogStatus;
      task_id?: string;
      member_user_id?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<TimeLogListResult> {
    try {
      const response = await apiClient.get<ApiResponse<TimeLogListResult>>(
        `/api/project-time/projects/${projectId}/team`,
        { params: query },
      );
      return response.data.data;
    } catch (error) {
      throw extractError(error, "Failed to fetch team logs");
    }
  },

  async listMyTaskLogs(
    projectId: string,
    taskId: string,
    query?: { page?: number; limit?: number },
  ): Promise<TimeLogListResult> {
    try {
      const response = await apiClient.get<ApiResponse<TimeLogListResult>>(
        `/api/project-time/projects/${projectId}/tasks/${taskId}/logs/me`,
        { params: query },
      );
      return response.data.data;
    } catch (error) {
      throw extractError(error, "Failed to fetch task time logs");
    }
  },

  async listProjectMemberRates(
    projectId: string,
  ): Promise<ProjectMemberTimeRate[]> {
    try {
      const response = await apiClient.get<ApiResponse<ProjectMemberTimeRate[]>>(
        `/api/project-time/projects/${projectId}/rates`,
      );
      return response.data.data;
    } catch (error) {
      throw extractError(error, "Failed to fetch project member time rates");
    }
  },

  async getMyProjectMemberRate(projectId: string): Promise<ProjectMemberTimeRate> {
    try {
      const response = await apiClient.get<ApiResponse<ProjectMemberTimeRate>>(
        `/api/project-time/projects/${projectId}/my-rate`,
      );
      return response.data.data;
    } catch (error) {
      throw extractError(error, "Failed to fetch my project member time rate");
    }
  },

  async listProjectTasks(projectId: string): Promise<ProjectTaskOption[]> {
    try {
      const response = await apiClient.get<ApiResponse<ProjectTaskOption[]>>(
        `/api/project-time/projects/${projectId}/tasks`,
      );
      return response.data.data;
    } catch (error) {
      throw extractError(error, "Failed to fetch project tasks");
    }
  },

  async createProjectMemberRate(
    projectId: string,
    payload: {
      project_member_id?: string;
      member_user_id?: string;
      hourly_rate: number;
      currency: string;
      custom_id?: string;
      start_date: string;
      end_date?: string;
    },
  ): Promise<ProjectMemberTimeRate> {
    try {
      const response = await apiClient.post<ApiResponse<ProjectMemberTimeRate>>(
        `/api/project-time/projects/${projectId}/rates`,
        payload,
      );
      return response.data.data;
    } catch (error) {
      throw extractError(error, "Failed to create project member time rate");
    }
  },

  async updateProjectMemberRate(
    projectId: string,
    rateId: string,
    payload: {
      hourly_rate?: number;
      currency?: string;
      custom_id?: string;
      start_date?: string;
      end_date?: string;
    },
  ): Promise<ProjectMemberTimeRate> {
    try {
      const response = await apiClient.patch<ApiResponse<ProjectMemberTimeRate>>(
        `/api/project-time/projects/${projectId}/rates/${rateId}`,
        payload,
      );
      return response.data.data;
    } catch (error) {
      throw extractError(error, "Failed to update project member time rate");
    }
  },

  async deleteProjectMemberRate(projectId: string, rateId: string): Promise<void> {
    try {
      await apiClient.delete(`/api/project-time/projects/${projectId}/rates/${rateId}`);
    } catch (error) {
      throw extractError(error, "Failed to delete project member time rate");
    }
  },
};