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

export interface AgentCommitPayload {
  change_id?: string;
  committed_at?: string;
  revision_token?: string;
  semantic_diff: AgentSemanticDiff;
  candidate_snapshot: Record<string, unknown>;
  timeline?: Array<Record<string, unknown>>;
  roadmap?: Record<string, unknown>;
}

export interface AgentRoadmapCommitArtifact {
  artifact_id: string;
  type: "roadmap_commit";
  roadmap_id: string;
  base_revision?: number;
  change_id?: string;
  status?: "draft" | "applied" | "discarded";
  title: string;
  summary: string;
  semantic_diff_summary: Record<string, number>;
  validation_issue_count: number;
  inline_commit?: AgentCommitPayload;
  created_at: string;
}

export interface AgentCreateSessionRequest {
  session_id?: string;
  roadmap_id: string;
  base_revision?: number;
  metadata?: Record<string, unknown>;
  seed_messages?: Array<{ role: string; content: string }>;
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
}

export interface AgentSendMessageOptions {
  traceId?: string;
}

export interface AgentMessageResponse {
  session_id: string;
  assistant_message: string;
  parse_mode: string;
  intent_type:
    | "smalltalk"
    | "general_question"
    | "roadmap_query"
    | "roadmap_plan"
    | "roadmap_edit"
    | "confirm_action"
    | "question"
    | "unclear";
  response_mode: "chat" | "edit_plan" | "plan_proposal";
  operations: AgentOperation[];
  staged_operations_version: number;
  staged_operations_count: number;
  artifacts: AgentRoadmapCommitArtifact[];
  plan_proposal?: AgentPlanProposal | null;
  provider_used?: "openai" | "rule_based";
  fallback_used?: boolean;
  provider_error_code?: string | null;
  debug_trace_id?: string | null;
}

export interface AgentPlanProposalTask {
  title: string;
  description?: string | null;
  status?: string | null;
  assignee_label?: string | null;
  target_feature_title?: string | null;
}

export interface AgentPlanProposalFeature {
  title: string;
  description?: string | null;
  target_epic_title?: string | null;
  tasks?: AgentPlanProposalTask[];
}

export interface AgentPlanProposalEpic {
  title: string;
  description?: string | null;
  features?: AgentPlanProposalFeature[];
}

export interface AgentPlanProposalQuestion {
  id: string;
  question: string;
  options: string[];
  allow_custom: boolean;
}

export interface AgentPlanProposalAnswer {
  question_id: string;
  question_text?: string | null;
  selected_option?: string | null;
  custom_answer?: string | null;
}

export interface AgentPlanProposal {
  plan_id: string;
  planning_turn_id?: string | null;
  summary: string;
  goal: string;
  rationale?: string | null;
  proposed_hierarchy: AgentPlanProposalEpic[];
  risks?: string[];
  next_steps?: string[];
  open_questions?: string[];
  status?:
    | "awaiting_answers"
    | "proposed"
    | "confirmed"
    | "discarded"
    | "superseded";
  current_question?: AgentPlanProposalQuestion | null;
  answers?: AgentPlanProposalAnswer[];
}

export type AgentTraceEventStatus = "running" | "success" | "error";

export interface AgentTraceEvent {
  seq: number;
  ts: string;
  event: string;
  title: string;
  status: AgentTraceEventStatus;
  summary: string;
  details?: Record<string, unknown>;
}

export type AgentTraceDetailMode = "verbose" | "structured";

export interface AgentTraceEventsResponse {
  trace_id: string;
  session_id?: string | null;
  roadmap_id?: string | null;
  events: AgentTraceEvent[];
  next_seq: number;
  done: boolean;
  started_at?: string | null;
  completed_at?: string | null;
  elapsed_ms?: number | null;
}

export interface AgentTraceEventsRequest {
  afterSeq?: number;
  limit?: number;
  detail?: AgentTraceDetailMode;
}

export interface AgentDiscardRequest {
  change_id?: string;
}

export interface AgentDiscardResponse {
  session_id: string;
  roadmap_id: string;
  discarded_change_id?: string;
  discarded_at: string;
  staged_operations_count: number;
  staged_operations_version: number;
}

export interface AgentRollbackRequest {
  change_id: string;
}

export interface AgentRollbackResponse {
  session_id: string;
  roadmap_id: string;
  rollback: {
    change_id: string;
    reapplied_at: string;
    revision_token: string;
    timeline: Array<{
      change_id: string;
      committed_at: string;
      discarded_at?: string;
      status: "applied" | "discarded";
      operations_count: number;
      semantic_diff: AgentSemanticDiff;
    }>;
    roadmap: Record<string, unknown>;
  };
}

export interface AgentCommitRequest {
  operations?: AgentOperation[];
  base_revision?: number;
  revision_token?: string;
}

export interface AgentCommitResponse {
  session_id: string;
  roadmap_id: string;
  commit: Record<string, unknown>;
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

function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    try {
      return String(value);
    } catch {
      return undefined;
    }
  }
}

export function isAgentTimeoutError(error: unknown): boolean {
  const timeoutPattern = /(timeout|aborted|econnaborted|network error)/i;
  if (error instanceof RoadmapAgentServiceError) {
    return timeoutPattern.test(error.message);
  }

  if (isAxiosError(error)) {
    if (error.code && timeoutPattern.test(error.code)) return true;
    if (error.message && timeoutPattern.test(error.message)) return true;
  }

  if (error instanceof Error) {
    return timeoutPattern.test(error.message);
  }

  return false;
}

function extractNestedMessage(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || value == null) return undefined;
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  const candidates = [record.message, record.detail, record.error];
  for (const candidate of candidates) {
    const extracted = extractNestedMessage(candidate, depth + 1);
    if (extracted) return extracted;
  }

  const compact = safeStringify(record);
  if (compact && compact !== "{}") return compact;
  return undefined;
}

function throwAgentError(error: unknown, operation: string): never {
  // 404s flow through the caller's own retry logic (trace-not-ready grace,
  // Redis-miss rehydration) — don't redundantly log them at error level.
  const status = isAxiosError(error) ? error.response?.status : undefined;
  if (status === 404) {
    console.debug(`[RoadmapAgentService] ${operation} → 404 (caller handles)`);
  } else {
    console.error(`[RoadmapAgentService] ${operation} failed:`, error);
  }

  if (isAxiosError(error)) {
    const status = error.response?.status;
    const detail = error.response?.data?.detail as unknown;
    const nestedDetailMessage = extractNestedMessage(detail);
    const responseMessage = extractNestedMessage(error.response?.data);
    const message = nestedDetailMessage || responseMessage || error.message;

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
    options?: AgentSendMessageOptions,
  ): Promise<AgentMessageResponse> {
    try {
      const response = await agentApiClient.post<AgentMessageResponse>(
        `/agent/sessions/${sessionId}/messages`,
        payload,
        options?.traceId
          ? {
              headers: {
                "X-Trace-Id": options.traceId,
              },
            }
          : undefined,
      );
      return response.data;
    } catch (error) {
      throwAgentError(error, "Send AI message");
    }
  },

  async getTraceEvents(
    sessionId: string,
    traceId: string,
    options: AgentTraceEventsRequest = {},
  ): Promise<AgentTraceEventsResponse> {
    try {
      const response = await agentApiClient.get<AgentTraceEventsResponse>(
        `/agent/sessions/${sessionId}/traces/${traceId}/events`,
        {
          params: {
            after_seq: options.afterSeq ?? 0,
            limit: options.limit ?? 50,
            detail: options.detail ?? "verbose",
          },
        },
      );
      return response.data;
    } catch (error) {
      throwAgentError(error, "Get AI trace events");
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

  async commitSession(
    sessionId: string,
    payload: AgentCommitRequest = {},
  ): Promise<AgentCommitResponse> {
    try {
      const response = await agentApiClient.post<AgentCommitResponse>(
        `/agent/sessions/${sessionId}/commit`,
        payload,
      );
      return response.data;
    } catch (error) {
      throwAgentError(error, "Commit AI staged edits");
    }
  },

  async rollbackSession(
    sessionId: string,
    payload: AgentRollbackRequest,
  ): Promise<AgentRollbackResponse> {
    try {
      const response = await agentApiClient.post<AgentRollbackResponse>(
        `/agent/sessions/${sessionId}/rollback`,
        payload,
      );
      return response.data;
    } catch (error) {
      throwAgentError(error, "Reapply AI committed change");
    }
  },
};

export default roadmapAgentService;
