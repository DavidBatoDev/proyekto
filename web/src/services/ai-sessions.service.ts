import { isAxiosError } from "axios";
import { apiClient } from "@/api";
import { type AiSessionScope, aiSessionsBasePath } from "@/components/ai/scope";

// =============================================================================
// Backend AI-sessions client, scope-first. The base path comes from the scope
// (`/api/roadmaps/{id}/ai-sessions` or `/api/workspaces/{id}/ai-sessions`,
// D6); the eight routes and DTOs are identical across both controllers.
// =============================================================================

export type AiSessionMode = "chat" | "edit_plan" | "plan_proposal";
export type AiMessageRole = "user" | "assistant" | "system";
export type AiSessionScopeKind = "roadmap" | "workspace";

export interface AiSession {
	id: string;
	/** Set in roadmap scope; null in workspace scope. */
	roadmap_id: string | null;
	/** Set in workspace scope; null in roadmap scope. */
	workspace_id: string | null;
	scope: AiSessionScopeKind;
	user_id: string;
	title: string | null;
	mode: AiSessionMode;
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

export interface AiMessage {
	id: string;
	session_id: string;
	seq: number;
	role: AiMessageRole;
	content: string;
	intent_type: string | null;
	response_mode: AiSessionMode | null;
	parse_mode: string | null;
	artifacts: Array<Record<string, unknown>> | null;
	activity_timeline: Record<string, unknown> | null;
	commit_lifecycle: Record<string, unknown> | null;
	tokens: number | null;
	/** May carry `refs`, `run`, `plan_proposal`, `clarifier`. */
	metadata: Record<string, unknown>;
	created_at: string;
}

export interface CreateAiSessionPayload {
	title?: string;
	mode?: AiSessionMode;
}

export interface UpdateAiSessionPayload {
	title?: string;
	is_archived?: boolean;
	is_pinned?: boolean;
}

export interface AppendAiMessagePayload {
	role: AiMessageRole;
	content: string;
	intent_type?: string;
	response_mode?: AiSessionMode;
	parse_mode?: string;
	artifacts?: Array<Record<string, unknown>>;
	activity_timeline?: Record<string, unknown>;
	commit_lifecycle?: Record<string, unknown>;
	tokens?: number;
	/** `{ refs?, run?, plan_proposal?, clarifier? }`; 64KB cap server-side. */
	metadata?: Record<string, unknown>;
}

export interface AppendAiMessageResult {
	message: AiMessage;
	seed_messages: Array<{ role: string; content: string }>;
}

// Backend wraps every response in `{ data: T }` via a global
// ResponseInterceptor (backend/src/common/interceptors/response.interceptor.ts),
// so axios sees the envelope. Every read-method below unwraps it.
interface ApiEnvelope<T> {
	data: T;
}

export class AiSessionsServiceError extends Error {
	constructor(
		message: string,
		public statusCode?: number,
		public originalError?: unknown,
	) {
		super(message);
		this.name = "AiSessionsServiceError";
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
		throw new AiSessionsServiceError(
			`${operation} failed: ${detail}`,
			status,
			error,
		);
	}
	const message = error instanceof Error ? error.message : String(error);
	throw new AiSessionsServiceError(
		`${operation} failed: ${message}`,
		undefined,
		error,
	);
}

export const aiSessionsService = {
	async list(
		scope: AiSessionScope,
		options: { archived?: boolean; limit?: number } = {},
	): Promise<AiSession[]> {
		try {
			const response = await apiClient.get<ApiEnvelope<AiSession[]>>(
				aiSessionsBasePath(scope),
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
		scope: AiSessionScope,
		payload: CreateAiSessionPayload = {},
	): Promise<AiSession> {
		try {
			const response = await apiClient.post<ApiEnvelope<AiSession>>(
				aiSessionsBasePath(scope),
				payload,
			);
			return response.data.data;
		} catch (error) {
			handleError(error, "Create AI session");
		}
	},

	async getById(scope: AiSessionScope, sessionId: string): Promise<AiSession> {
		try {
			const response = await apiClient.get<ApiEnvelope<AiSession>>(
				`${aiSessionsBasePath(scope)}/${sessionId}`,
			);
			return response.data.data;
		} catch (error) {
			handleError(error, "Get AI session");
		}
	},

	async update(
		scope: AiSessionScope,
		sessionId: string,
		payload: UpdateAiSessionPayload,
	): Promise<AiSession> {
		try {
			const response = await apiClient.patch<ApiEnvelope<AiSession>>(
				`${aiSessionsBasePath(scope)}/${sessionId}`,
				payload,
			);
			return response.data.data;
		} catch (error) {
			handleError(error, "Update AI session");
		}
	},

	async delete(scope: AiSessionScope, sessionId: string): Promise<void> {
		try {
			await apiClient.delete(`${aiSessionsBasePath(scope)}/${sessionId}`);
		} catch (error) {
			handleError(error, "Delete AI session");
		}
	},

	async listMessages(
		scope: AiSessionScope,
		sessionId: string,
		options: { limit?: number; before_seq?: number; after_seq?: number } = {},
	): Promise<AiMessage[]> {
		try {
			const response = await apiClient.get<ApiEnvelope<AiMessage[]>>(
				`${aiSessionsBasePath(scope)}/${sessionId}/messages`,
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
		scope: AiSessionScope,
		sessionId: string,
		payload: AppendAiMessagePayload,
	): Promise<AppendAiMessageResult> {
		try {
			const response = await apiClient.post<ApiEnvelope<AppendAiMessageResult>>(
				`${aiSessionsBasePath(scope)}/${sessionId}/messages`,
				payload,
			);
			return response.data.data;
		} catch (error) {
			handleError(error, "Append AI message");
		}
	},
};

export default aiSessionsService;
