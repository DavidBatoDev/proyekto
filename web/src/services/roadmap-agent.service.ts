import { isAxiosError } from "axios";
import agentApiClient from "@/api/agent-axios";

export type AgentOperationType =
  | "add_epic"
  | "add_feature"
  | "add_task"
  | "update_node"
  | "move_node"
  | "delete_node"
  | "mark_status"
  | "shift_dates";

export type AgentNodeType = "roadmap" | "epic" | "feature" | "task";

export interface AgentOperation {
  op: AgentOperationType;
  node_type?: AgentNodeType;
  node_id?: string;
  parent_id?: string;
  new_parent_id?: string;
  position?: number;
  patch?: Record<string, unknown>;
  status?: string;
  delta_days?: number;
  scope?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

export interface AgentValidationIssue {
  code: string;
  severity: "error" | "warning";
  path: string;
  message: string;
  node_ref?: {
    type: AgentNodeType;
    id: string;
  };
}

export interface AgentSemanticDiffChange {
  type: string;
  node: {
    type: AgentNodeType;
    id: string;
  };
  from?: Record<string, unknown>;
  to?: Record<string, unknown>;
}

export interface AgentSemanticDiff {
  summary: Record<string, number>;
  changes: AgentSemanticDiffChange[];
}

export interface AgentPreviewPayload {
  preview_id: string;
  base_revision?: number;
  base_updated_at: string;
  semantic_diff: AgentSemanticDiff;
  validation_issues: AgentValidationIssue[];
  candidate_snapshot: Record<string, unknown>;
}

export interface AgentRoadmapPreviewArtifact {
  artifact_id: string;
  type: "roadmap_preview";
  roadmap_id: string;
  base_revision?: number;
  preview_id: string;
  title: string;
  summary: string;
  semantic_diff_summary: Record<string, number>;
  validation_issue_count: number;
  created_at: string;
}

export interface AgentCreateSessionRequest {
  roadmap_id: string;
  base_revision?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentCreateSessionResponse {
  session_id: string;
  roadmap_id: string;
  base_revision?: number;
  created_at: string;
}

export interface AgentMessageRequest {
  message: string;
  replace_operations?: boolean;
  auto_preview?: boolean;
}

export interface AgentMessageResponse {
  session_id: string;
  assistant_message: string;
  parse_mode: string;
  intent_type: "smalltalk" | "question" | "roadmap_edit" | "unclear";
  response_mode: "chat" | "edit_plan";
  operations: AgentOperation[];
  preview_available: boolean;
  preview_recommended: boolean;
  staged_operations_version: number;
  staged_operations_count: number;
  artifacts: AgentRoadmapPreviewArtifact[];
  provider_used?: "gemini" | "openai" | "rule_based";
  fallback_used?: boolean;
  provider_error_code?: string | null;
  debug_trace_id?: string | null;
}

export interface AgentPreviewRequest {
  operations?: AgentOperation[];
  base_revision?: number;
}

export interface AgentDiscardRequest {
  preview_id?: string;
}

export interface AgentPreviewResponse {
  session_id: string;
  roadmap_id: string;
  base_revision?: number;
  operations: AgentOperation[];
  preview: AgentPreviewPayload;
}

export interface AgentArtifactPreviewResponse {
  session_id: string;
  roadmap_id: string;
  artifact: AgentRoadmapPreviewArtifact;
  preview: AgentPreviewPayload;
}

export interface AgentDiscardResponse {
  session_id: string;
  roadmap_id: string;
  discarded_preview_id?: string;
  discarded_at: string;
  staged_operations_count: number;
  staged_operations_version: number;
}

export class RoadmapAgentServiceError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public originalError?: unknown,
  ) {
    super(message);
    this.name = "RoadmapAgentServiceError";
  }
}

function throwAgentError(error: unknown, operation: string): never {
  console.error(`[RoadmapAgentService] ${operation} failed:`, error);

  if (isAxiosError(error)) {
    const status = error.response?.status;
    const detail = error.response?.data?.detail;
    const nestedDetailMessage =
      typeof detail === "object"
        ? detail?.detail?.message ||
          detail?.detail?.error ||
          detail?.detail?.detail
        : undefined;
    const message =
      (typeof detail === "string" ? detail : detail?.message) ||
      nestedDetailMessage ||
      (typeof detail === "object" ? detail?.message : undefined) ||
      error.response?.data?.message ||
      error.message;

    throw new RoadmapAgentServiceError(
      `${operation} failed: ${message}`,
      status,
      error,
    );
  }

  if (error instanceof Error) {
    throw new RoadmapAgentServiceError(
      `${operation} failed: ${error.message}`,
      undefined,
      error,
    );
  }

  throw new RoadmapAgentServiceError(
    `${operation} failed: Unknown error`,
    undefined,
    error,
  );
}

export const roadmapAgentService = {
  async createSession(
    payload: AgentCreateSessionRequest,
  ): Promise<AgentCreateSessionResponse> {
    try {
      const response = await agentApiClient.post<AgentCreateSessionResponse>(
        "/agent/sessions",
        payload,
      );
      return response.data;
    } catch (error) {
      throwAgentError(error, "Create AI session");
    }
  },

  async sendMessage(
    sessionId: string,
    payload: AgentMessageRequest,
  ): Promise<AgentMessageResponse> {
    try {
      const response = await agentApiClient.post<AgentMessageResponse>(
        `/agent/sessions/${sessionId}/messages`,
        payload,
      );
      return response.data;
    } catch (error) {
      throwAgentError(error, "Send AI message");
    }
  },

  async previewSession(
    sessionId: string,
    payload: AgentPreviewRequest,
  ): Promise<AgentPreviewResponse> {
    try {
      const response = await agentApiClient.post<AgentPreviewResponse>(
        `/agent/sessions/${sessionId}/preview`,
        payload,
      );
      return response.data;
    } catch (error) {
      throwAgentError(error, "Preview AI operations");
    }
  },

  async getArtifactPreview(
    sessionId: string,
    artifactId: string,
  ): Promise<AgentArtifactPreviewResponse> {
    try {
      const response = await agentApiClient.get<AgentArtifactPreviewResponse>(
        `/agent/sessions/${sessionId}/artifacts/${artifactId}`,
      );
      return response.data;
    } catch (error) {
      throwAgentError(error, "Get AI artifact preview");
    }
  },

  async discardSession(
    sessionId: string,
    payload: AgentDiscardRequest = {},
  ): Promise<AgentDiscardResponse> {
    try {
      const response = await agentApiClient.post<AgentDiscardResponse>(
        `/agent/sessions/${sessionId}/discard`,
        payload,
      );
      return response.data;
    } catch (error) {
      throwAgentError(error, "Discard AI staged edits");
    }
  },
};

export default roadmapAgentService;
