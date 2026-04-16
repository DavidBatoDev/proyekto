import { isAxiosError } from "axios";
import { apiClient } from "@/api";

export type RoadmapAiSessionMode = "chat" | "edit_plan";
export type RoadmapAiMessageRole = "user" | "assistant" | "system";

export interface RoadmapAiSession {
  id: string;
  roadmap_id: string;
  user_id: string;
  title: string | null;
  mode: RoadmapAiSessionMode;
  is_archived: boolean;
  archived_at: string | null;
  is_pinned: boolean;
  pinned_at: string | null;
  last_message_at: string | null;
  message_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface RoadmapAiMessage {
  id: string;
  session_id: string;
  seq: number;
  role: RoadmapAiMessageRole;
  content: string;
  intent_type: string | null;
  response_mode: RoadmapAiSessionMode | null;
  parse_mode: string | null;
  artifacts: Array<Record<string, unknown>> | null;
  activity_timeline: Record<string, unknown> | null;
  commit_lifecycle: Record<string, unknown> | null;
  tokens: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CreateRoadmapAiSessionPayload {
  title?: string;
  mode?: RoadmapAiSessionMode;
}

export interface UpdateRoadmapAiSessionPayload {
  title?: string;
  is_archived?: boolean;
  is_pinned?: boolean;
}

export interface AppendRoadmapAiMessagePayload {
  role: RoadmapAiMessageRole;
  content: string;
  intent_type?: string;
  response_mode?: RoadmapAiSessionMode;
  parse_mode?: string;
  artifacts?: Array<Record<string, unknown>>;
  activity_timeline?: Record<string, unknown>;
  commit_lifecycle?: Record<string, unknown>;
  tokens?: number;
  metadata?: Record<string, unknown>;
}

export interface AppendRoadmapAiMessageResult {
  message: RoadmapAiMessage;
  seed_messages: Array<{ role: string; content: string }>;
}

// Backend wraps every response in `{ data: T }` via a global
// ResponseInterceptor (backend/src/common/interceptors/response.interceptor.ts),
// so axios sees the envelope. Every read-method below unwraps it.
interface ApiEnvelope<T> {
  data: T;
}

export class RoadmapAiSessionsServiceError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public originalError?: unknown,
  ) {
    super(message);
    this.name = "RoadmapAiSessionsServiceError";
  }
}

function handleError(error: unknown, operation: string): never {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    // Backend error shape (common/filters/http-exception.filter.ts):
    //   { error: { message: string, status: number, path, timestamp } }
    // Fall back to flat `{ message }` or axios's own message so this keeps
    // working across both shapes.
    const body = error.response?.data as
      | { error?: { message?: unknown }; message?: unknown }
      | undefined;
    const nested =
      typeof body?.error === "object" && body.error !== null
        ? (body.error as { message?: unknown }).message
        : undefined;
    const flat = body?.message;
    const detail =
      (typeof nested === "string" && nested) ||
      (typeof flat === "string" && flat) ||
      error.message;
    throw new RoadmapAiSessionsServiceError(
      `${operation} failed: ${detail}`,
      status,
      error,
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  throw new RoadmapAiSessionsServiceError(
    `${operation} failed: ${message}`,
    undefined,
    error,
  );
}

export const roadmapAiSessionsService = {
  async list(
    roadmapId: string,
    options: { archived?: boolean; limit?: number } = {},
  ): Promise<RoadmapAiSession[]> {
    try {
      const response = await apiClient.get<ApiEnvelope<RoadmapAiSession[]>>(
        `/api/roadmaps/${roadmapId}/ai-sessions`,
        {
          params: {
            archived: options.archived ? "true" : undefined,
            limit: options.limit,
          },
        },
      );
      return response.data.data ?? [];
    } catch (error) {
      handleError(error, "List AI sessions");
    }
  },

  async create(
    roadmapId: string,
    payload: CreateRoadmapAiSessionPayload = {},
  ): Promise<RoadmapAiSession> {
    try {
      const response = await apiClient.post<ApiEnvelope<RoadmapAiSession>>(
        `/api/roadmaps/${roadmapId}/ai-sessions`,
        payload,
      );
      return response.data.data;
    } catch (error) {
      handleError(error, "Create AI session");
    }
  },

  async getById(
    roadmapId: string,
    sessionId: string,
  ): Promise<RoadmapAiSession> {
    try {
      const response = await apiClient.get<ApiEnvelope<RoadmapAiSession>>(
        `/api/roadmaps/${roadmapId}/ai-sessions/${sessionId}`,
      );
      return response.data.data;
    } catch (error) {
      handleError(error, "Get AI session");
    }
  },

  async update(
    roadmapId: string,
    sessionId: string,
    payload: UpdateRoadmapAiSessionPayload,
  ): Promise<RoadmapAiSession> {
    try {
      const response = await apiClient.patch<ApiEnvelope<RoadmapAiSession>>(
        `/api/roadmaps/${roadmapId}/ai-sessions/${sessionId}`,
        payload,
      );
      return response.data.data;
    } catch (error) {
      handleError(error, "Update AI session");
    }
  },

  async delete(roadmapId: string, sessionId: string): Promise<void> {
    try {
      await apiClient.delete(
        `/api/roadmaps/${roadmapId}/ai-sessions/${sessionId}`,
      );
    } catch (error) {
      handleError(error, "Delete AI session");
    }
  },

  async listMessages(
    roadmapId: string,
    sessionId: string,
    options: { limit?: number; before_seq?: number; after_seq?: number } = {},
  ): Promise<RoadmapAiMessage[]> {
    try {
      const response = await apiClient.get<ApiEnvelope<RoadmapAiMessage[]>>(
        `/api/roadmaps/${roadmapId}/ai-sessions/${sessionId}/messages`,
        {
          params: {
            limit: options.limit,
            before_seq: options.before_seq,
            after_seq: options.after_seq,
          },
        },
      );
      return response.data.data ?? [];
    } catch (error) {
      handleError(error, "List AI messages");
    }
  },

  async appendMessage(
    roadmapId: string,
    sessionId: string,
    payload: AppendRoadmapAiMessagePayload,
  ): Promise<AppendRoadmapAiMessageResult> {
    try {
      const response = await apiClient.post<
        ApiEnvelope<AppendRoadmapAiMessageResult>
      >(
        `/api/roadmaps/${roadmapId}/ai-sessions/${sessionId}/messages`,
        payload,
      );
      return response.data.data;
    } catch (error) {
      handleError(error, "Append AI message");
    }
  },
};

export default roadmapAiSessionsService;
