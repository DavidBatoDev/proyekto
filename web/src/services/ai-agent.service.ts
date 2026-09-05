import { isAxiosError } from "axios";
import agentApiClient from "@/api/agent-axios";

// =============================================================================
// Canonical Python-agent client for the shared AI kit (roadmap panel and the
// dashboard assistant). This file owns every `Agent*` wire type; the legacy
// `roadmap-agent.service.ts` is a re-export shim over it.
//
// Wire contract: plan "Cross-service wire contract > Agent HTTP API" (D2). A
// message is a *run* the agent advances until a checkpoint, completion, or the
// per-request budget; the web calls `continueRun` while `run.next ===
// "continue"`. Responses are NOT enveloped (unlike the NestJS backend).
// =============================================================================

// -----------------------------------------------------------------------------
// Operations (shared with roadmapStore's optimistic apply)
// -----------------------------------------------------------------------------

export type AgentOperationType =
	| "add_epic"
	| "add_feature"
	| "add_task"
	| "add_milestone"
	| "update_node"
	| "move_node"
	| "delete_node"
	| "mark_status"
	| "shift_dates";

export type AgentNodeType =
	| "roadmap"
	| "epic"
	| "feature"
	| "task"
	| "milestone";

export interface AgentOperation {
	op: AgentOperationType;
	node_type?: AgentNodeType;
	node_id?: string;
	node_ref?: string;
	parent_id?: string;
	parent_ref?: string;
	new_parent_id?: string;
	new_parent_ref?: string;
	temp_id?: string;
	position?: number;
	patch?: Record<string, unknown>;
	status?: string;
	delta_days?: number;
	scope?: Record<string, unknown>;
	data?: Record<string, unknown>;
	targets?: string[];
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

export interface AgentCommitImpactedItem {
	node_id: string;
	node_type: AgentNodeType | "roadmap";
	title?: string | null;
	change_type?: string | null;
	impact?: "created" | "modified" | "deleted";
}

/** Legacy: the focus roadmap's commit in this step (pre-run clients). */
export interface AgentCommitSummary {
	committed: boolean;
	change_id?: string | null;
	semantic_diff_summary?: Record<string, number>;
	impacted_items?: AgentCommitImpactedItem[];
	impacted_summary?: Record<string, number>;
	/** Set when committed=false — staged ops were already discarded server-side. */
	error_code?: string | null;
	error_message?: string | null;
}

// -----------------------------------------------------------------------------
// Session scope (D3)
// -----------------------------------------------------------------------------

export type AgentSessionScope =
	| { kind: "roadmap"; roadmap_id: string }
	| { kind: "workspace"; workspace_id: string };

export interface AgentCreateSessionRequest {
	session_id?: string;
	scope?: AgentSessionScope;
	/** @deprecated Legacy (one release): derives `scope = {kind:"roadmap"}`. */
	roadmap_id?: string;
	base_revision?: number;
	revision_token?: string;
	metadata?: Record<string, unknown>;
	seed_messages?: Array<{ role: string; content: string }>;
}

export interface AgentCreateSessionResponse {
	session_id: string;
	scope: AgentSessionScope;
	/** Legacy mirror of `scope.roadmap_id`; null in workspace scope. */
	roadmap_id?: string | null;
	base_revision?: number | null;
	revision_token?: string | null;
	created_at: string;
}

// -----------------------------------------------------------------------------
// Context refs (D5) — @-mentions travel as {kind,id,label}; a hint, never a
// restriction.
// -----------------------------------------------------------------------------

export type AgentContextRefKind =
	| "project"
	| "roadmap"
	| "epic"
	| "feature"
	| "task"
	| "milestone"
	| "team";

export interface AgentContextRef {
	kind: AgentContextRefKind;
	id: string;
	label?: string;
}

export interface AgentResolvedRefChainEntry {
	kind: string;
	id: string;
	title?: string | null;
}

/** One entry of the agent's hydrated refs (`RunView.refs`). */
export interface AgentResolvedRef {
	kind: AgentContextRefKind;
	id: string;
	accessible: boolean;
	label?: string | null;
	title?: string | null;
	status?: string | null;
	roadmap_id?: string | null;
	project_id?: string | null;
	workspace_id?: string | null;
	/** Nearest-first: feature -> epic -> roadmap -> project -> workspace. */
	parent_chain?: AgentResolvedRefChainEntry[];
	/** NOT_FOUND | FORBIDDEN | RESOLVE_FAILED | ... when accessible=false. */
	error_code?: string | null;
}

// -----------------------------------------------------------------------------
// Messages
// -----------------------------------------------------------------------------

export type AgentMessageCapability = "continue";

export interface AgentMessageRequest {
	message: string;
	/** Up to 20 refs. */
	refs?: AgentContextRef[];
	/**
	 * Absent "continue" = legacy sync mode (the agent runs the whole request
	 * to completion, one release). The kit always sends `["continue"]`.
	 */
	capabilities?: AgentMessageCapability[];
}

export interface AgentSendMessageOptions {
	traceId?: string;
}

export type AgentIntentType =
	| "smalltalk"
	| "general_question"
	| "roadmap_query"
	| "roadmap_plan"
	| "roadmap_edit"
	| "plan_revision"
	| "confirm_action"
	| "question"
	| "unclear";

export type AgentResponseMode = "chat" | "edit_plan" | "plan_proposal";

export type AgentProviderUsed = "openai" | "rule_based";

// -----------------------------------------------------------------------------
// Runs (D1/D2)
// -----------------------------------------------------------------------------

export type AgentRunPhase = "investigate" | "propose" | "execute" | "verify";
export type AgentRunStatus =
	| "running"
	| "awaiting_user"
	| "done"
	| "failed"
	| "cancelled";
export type AgentRunNext = "continue" | "await_user" | "done";
export type AgentRunCheckpoint = "clarifier" | "proposal";
export type AgentRunBatchSource = "stage_edits" | "proposal" | "revert";
export type AgentCommitStatus = "pending" | "committed" | "failed" | "skipped";
export type AgentVerifyStatus =
	| "verified"
	| "partial"
	| "failed"
	| "nothing_to_verify";
export type AgentVerifyCheckStatus = "pass" | "warn" | "fail";

export const TERMINAL_RUN_STATUSES: ReadonlySet<AgentRunStatus> = new Set([
	"done",
	"failed",
	"cancelled",
]);

export interface RunBatchView {
	batch_id: string;
	roadmap_id: string;
	roadmap_title?: string | null;
	operations_count: number;
	contains_delete: boolean;
	source: AgentRunBatchSource;
}

/**
 * Wire shape of one roadmap's commit inside a run. `operations` is attached
 * ONLY on the commits made in the current step of `AgentRunResponse.commits`;
 * `RunView.commits` never carries it.
 */
export interface RunCommitView {
	batch_id: string;
	roadmap_id: string;
	roadmap_title?: string | null;
	project_id?: string | null;
	status: AgentCommitStatus;
	change_id?: string | null;
	operations_count: number;
	operations?: AgentOperation[] | null;
	impacted_items?: AgentCommitImpactedItem[];
	impacted_summary?: Record<string, number>;
	semantic_diff_summary?: Record<string, number>;
	error_code?: string | null;
	error_message?: string | null;
	history_recorded?: boolean | null;
}

export interface AgentVerifyCheck {
	name: string;
	status: AgentVerifyCheckStatus;
	detail?: string;
}

export interface AgentVerifyReport {
	status: AgentVerifyStatus;
	checks?: AgentVerifyCheck[];
	summary?: string;
	follow_up_plan_id?: string | null;
}

export interface AgentRunError {
	code: string;
	message?: string;
}

export interface RunView {
	/** UUIDv4 minted by the agent. */
	run_id: string;
	/** The current segment's trace id (a send or checkpoint answer mints one). */
	trace_id: string;
	status: AgentRunStatus;
	phase: AgentRunPhase;
	next: AgentRunNext;
	checkpoint?: AgentRunCheckpoint | null;
	step?: number;
	scope: AgentSessionScope;
	focus_roadmap_ids?: string[];
	refs?: AgentResolvedRef[];
	batches?: RunBatchView[];
	/** Never carries `operations`. */
	commits?: RunCommitView[];
	verify?: AgentVerifyReport | null;
	error?: AgentRunError | null;
	created_at: string;
	updated_at: string;
}

/**
 * `POST /messages` and `POST /runs/{id}/continue` response — a strict
 * superset of the legacy `MessageResponse`: every legacy field is still
 * present so an old bundle in flight keeps working, plus `commits` + `run`.
 */
export interface AgentRunResponse {
	session_id: string;
	assistant_message: string;
	/** Today's values plus "run_step" (next=continue) and "run_report". */
	parse_mode: string;
	intent_type: AgentIntentType;
	response_mode: AgentResponseMode;
	/** Legacy: ops committed to the FOCUS roadmap in this step. */
	operations: AgentOperation[];
	/** Bumped once per batch staged this step. */
	staged_operations_version: number;
	/** Ops in this step's batches. */
	staged_operations_count: number;
	plan_proposal?: AgentPlanProposal | null;
	clarifier?: AgentClarifierCard | null;
	provider_used?: AgentProviderUsed;
	fallback_used?: boolean;
	provider_error_code?: string | null;
	debug_trace_id?: string | null;
	/** Legacy: the focus roadmap's commit in this step. */
	commit_summary?: AgentCommitSummary | null;
	/** Cumulative for the run; `operations` only on commits made this step. */
	commits?: RunCommitView[];
	run?: RunView | null;
}

/** @deprecated Legacy name for `AgentRunResponse` (kept for the shim). */
export type AgentMessageResponse = AgentRunResponse;

export interface AgentContinueRunOptions {
	traceId?: string;
}

export interface AgentCancelRunResponse {
	run: RunView;
}

// -----------------------------------------------------------------------------
// Plan proposals + clarifiers (unchanged shapes)
// -----------------------------------------------------------------------------

export interface AgentPlanProposalTask {
	title: string;
	description?: string | null;
	status?: string | null;
	/** Legacy single label; `assignee_labels` wins when present. */
	assignee_label?: string | null;
	/** Every proposed assignee (display names), first = primary. */
	assignee_labels?: string[] | null;
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

export type AgentPlanProposalKind = "plan" | "edits";

/**
 * One roadmap a pending proposal applies to. `kind="plan"` targets carry a
 * titles-only `proposed_hierarchy`; `kind="edits"` targets carry concrete
 * `operations` (a `stage_edits` batch that tripped the checkpoint policy).
 */
export interface AgentPlanProposalTarget {
	roadmap_id: string;
	roadmap_title?: string | null;
	project_id?: string | null;
	proposed_hierarchy?: AgentPlanProposalEpic[];
	operations?: AgentOperation[] | null;
	/** Human lines for the card ("Delete epic 'X' and 4 tasks"). */
	summary_lines?: string[];
	operations_count?: number;
	contains_delete?: boolean;
	/** Flips when that target's commit lands (partial-failure resume). */
	committed?: boolean;
}

export interface AgentPlanProposal {
	plan_id: string;
	planning_turn_id?: string | null;
	/** "plan" = titles materialized on confirm; "edits" = concrete operations. */
	kind?: AgentPlanProposalKind;
	/**
	 * One entry per roadmap the proposal touches; `proposed_hierarchy` below
	 * mirrors `targets[0]` for the single-roadmap card. Empty = legacy
	 * focus-roadmap-only plan.
	 */
	targets?: AgentPlanProposalTarget[];
	/** Run that recorded the proposal (confirm resumes it). */
	run_id?: string | null;
	summary: string;
	goal: string;
	rationale?: string | null;
	proposed_hierarchy: AgentPlanProposalEpic[];
	risks?: string[];
	next_steps?: string[];
	status?:
		| "awaiting_answers"
		| "proposed"
		| "confirmed"
		| "discarded"
		| "superseded";
	/** Plural — 1 to 4 questions the planner asked this turn. */
	current_questions?: AgentPlanProposalQuestion[];
	/** @deprecated Singular form — legacy shape kept for one release. Prefer `current_questions`. */
	current_question?: AgentPlanProposalQuestion | null;
	answers?: AgentPlanProposalAnswer[];
}

export interface AgentClarifierOption {
	label: string;
	description?: string | null;
}

export interface AgentClarifierQuestion {
	id: string;
	header?: string | null;
	question: string;
	multi_select: boolean;
	allow_custom: boolean;
	options: AgentClarifierOption[];
}

export interface AgentClarifierAnswerEntry {
	question_id: string;
	question?: string;
	selected_options: string[];
	custom_answer?: string;
}

export interface AgentClarifierCard {
	lane: "edit" | "query" | "plan";
	question_id: string;
	/** Legacy mirror of `questions[0].question` — kept for old persisted rows. */
	question: string;
	/** Legacy mirror of `questions[0]` option labels. */
	options: string[];
	allow_custom: boolean;
	reason?: string | null;
	/** 1–4 structured questions; absent on cards from older agents. */
	questions?: AgentClarifierQuestion[];
}

// -----------------------------------------------------------------------------
// Traces
// -----------------------------------------------------------------------------

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
	/** Run the segment belongs to (null on traces recorded before runs). */
	run_id?: string | null;
	/** Phase at the last flush. */
	phase?: string | null;
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

// =============================================================================
// Errors
// =============================================================================

/** Agent error codes the kit switches on (plan "Errors"). */
export type AgentErrorCode =
	| "AUTH_REQUIRED"
	| "SESSION_NOT_FOUND"
	| "SESSION_SCOPE_NOT_FOUND"
	| "RUN_NOT_FOUND"
	| "RUN_NOT_CONTINUABLE"
	| "RUN_IN_PROGRESS"
	| "TRACE_EVENTS_NOT_FOUND";

export interface AiAgentServiceErrorDetails {
	/** Agent error code parsed from the body (`{detail:{code}}` or `{code}`). */
	code?: string | null;
	/** Carried by 409 RUN_IN_PROGRESS / RUN_NOT_CONTINUABLE bodies. */
	run?: RunView | null;
}

export class AiAgentServiceError extends Error {
	public code: string | null;
	public run: RunView | null;

	constructor(
		message: string,
		public statusCode?: number,
		public originalError?: unknown,
		details: AiAgentServiceErrorDetails = {},
	) {
		super(message);
		this.name = "AiAgentServiceError";
		this.code = details.code ?? null;
		this.run = details.run ?? null;
	}
}

export function isAiAgentServiceError(
	error: unknown,
): error is AiAgentServiceError {
	return error instanceof AiAgentServiceError;
}

/** The agent error code on an error, or null when there is none. */
export function getAgentErrorCode(error: unknown): string | null {
	return isAiAgentServiceError(error) ? error.code : null;
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

/**
 * The request never reached the agent: a CORS-blocked preflight, DNS failure
 * or lost connectivity. Axios reports these as `ERR_NETWORK` / "Network
 * Error" with no response. Distinct from a timeout, which means the agent
 * was reached but did not answer in time.
 */
export function isAgentNetworkError(error: unknown): boolean {
	const networkPattern = /(err_network|network error)/i;
	if (isAxiosError(error)) {
		if (error.response) return false;
		if (error.code && networkPattern.test(error.code)) return true;
		return !!error.message && networkPattern.test(error.message);
	}
	if (error instanceof Error) {
		return networkPattern.test(error.message);
	}
	return false;
}

export function isAgentTimeoutError(error: unknown): boolean {
	const timeoutPattern = /(timeout|aborted|econnaborted)/i;
	if (error instanceof AiAgentServiceError) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeRunView(value: unknown): value is RunView {
	return (
		isRecord(value) &&
		typeof value.run_id === "string" &&
		typeof value.status === "string"
	);
}

/**
 * Flatten an agent error body into `{code, run}`. FastAPI wraps
 * `HTTPException(detail={...})` as `{detail: {code, message, run?}}`; a
 * custom JSON response may send the bare `{code, message, run?}`; and a
 * plain-string `detail` carries neither. Nested `error` objects are walked
 * too so the NestJS-shaped bodies the agent forwards still yield a code.
 */
export function parseAgentErrorBody(body: unknown): AiAgentServiceErrorDetails {
	const queue: Record<string, unknown>[] = [];
	if (isRecord(body)) queue.push(body);
	const seen = new Set<Record<string, unknown>>();
	let code: string | null = null;
	let run: RunView | null = null;
	let depth = 0;
	while (queue.length > 0 && depth < 8) {
		const candidate = queue.shift();
		depth += 1;
		if (!candidate || seen.has(candidate)) continue;
		seen.add(candidate);
		if (code === null && typeof candidate.code === "string") {
			const trimmed = candidate.code.trim();
			if (trimmed) code = trimmed;
		}
		if (run === null && looksLikeRunView(candidate.run)) {
			run = candidate.run;
		}
		if (isRecord(candidate.detail)) queue.push(candidate.detail);
		if (isRecord(candidate.error)) queue.push(candidate.error);
	}
	return { code, run };
}

function throwAgentError(error: unknown, operation: string): never {
	// 404s flow through the caller's own retry logic (trace-not-ready grace,
	// Redis-miss rehydration) and 409s are control-flow (a run is executing);
	// don't redundantly log them at error level.
	const status = isAxiosError(error) ? error.response?.status : undefined;
	if (status === 404 || status === 409) {
		console.debug(`[AiAgentService] ${operation} → ${status} (caller handles)`);
	} else {
		console.error(`[AiAgentService] ${operation} failed:`, error);
	}

	if (isAxiosError(error)) {
		const status = error.response?.status;
		const body = error.response?.data as unknown;
		const detail = isRecord(body) ? body.detail : undefined;
		const nestedDetailMessage = extractNestedMessage(detail);
		const responseMessage = extractNestedMessage(body);
		const message = nestedDetailMessage || responseMessage || error.message;

		throw new AiAgentServiceError(
			`${operation} failed: ${message}`,
			status,
			error,
			parseAgentErrorBody(body),
		);
	}

	if (error instanceof Error) {
		throw new AiAgentServiceError(
			`${operation} failed: ${error.message}`,
			undefined,
			error,
		);
	}

	throw new AiAgentServiceError(
		`${operation} failed: Unknown error`,
		undefined,
		error,
	);
}

function traceHeaders(traceId: string | undefined) {
	return traceId ? { headers: { "X-Trace-Id": traceId } } : undefined;
}

// =============================================================================
// Client
// =============================================================================

export const aiAgentService = {
	/** POST /agent/sessions — auth required (bearer or guest header). */
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

	/**
	 * POST /agent/sessions/{id}/messages — starts a new run segment. `X-Trace-Id`
	 * names the segment trace the caller is already polling.
	 */
	async sendMessage(
		sessionId: string,
		payload: AgentMessageRequest,
		options?: AgentSendMessageOptions,
	): Promise<AgentRunResponse> {
		const post = async () => {
			const response = await agentApiClient.post<AgentRunResponse>(
				`/agent/sessions/${sessionId}/messages`,
				payload,
				traceHeaders(options?.traceId),
			);
			return response.data;
		};
		try {
			return await post();
		} catch (error) {
			// Plan decisions (confirm/reject clicks) are idempotent control
			// messages the agent resolves in ~200ms — a network-level failure
			// here is almost always a transient blip (e.g. the dev agent
			// reloading), so retry once instead of stranding the user with a
			// "please retry" error on a button click.
			const isPlanDecision =
				typeof payload.message === "string" &&
				payload.message.startsWith("__plan_decision__");
			if (
				isPlanDecision &&
				(isAgentTimeoutError(error) || isAgentNetworkError(error))
			) {
				await new Promise((resolve) => setTimeout(resolve, 1500));
				try {
					return await post();
				} catch (retryError) {
					throwAgentError(retryError, "Send AI message");
				}
			}
			throwAgentError(error, "Send AI message");
		}
	},

	/**
	 * POST /agent/sessions/{id}/runs/{runId}/continue — advances a run whose
	 * last response said `next: "continue"`. The agent reuses `run.trace_id`
	 * (the header is informational only).
	 *
	 * Errors the caller switches on via `error.code`: SESSION_NOT_FOUND (404,
	 * rehydrate + retry once), RUN_NOT_FOUND (404, terminal),
	 * RUN_NOT_CONTINUABLE (409, settle from `error.run`), RUN_IN_PROGRESS (409,
	 * lock held — poll again; `error.run` carries the current view).
	 */
	async continueRun(
		sessionId: string,
		runId: string,
		options?: AgentContinueRunOptions,
	): Promise<AgentRunResponse> {
		try {
			const response = await agentApiClient.post<AgentRunResponse>(
				`/agent/sessions/${sessionId}/runs/${runId}/continue`,
				{},
				traceHeaders(options?.traceId),
			);
			return response.data;
		} catch (error) {
			throwAgentError(error, "Continue AI run");
		}
	},

	/** POST /agent/sessions/{id}/runs/{runId}/cancel -> `{ run }`. */
	async cancelRun(
		sessionId: string,
		runId: string,
	): Promise<AgentCancelRunResponse> {
		try {
			const response = await agentApiClient.post<AgentCancelRunResponse>(
				`/agent/sessions/${sessionId}/runs/${runId}/cancel`,
				{},
			);
			return response.data;
		} catch (error) {
			throwAgentError(error, "Cancel AI run");
		}
	},

	/** GET /agent/sessions/{id}/traces/{traceId}/events — unchanged signature. */
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
};

export type AiAgentService = typeof aiAgentService;

export default aiAgentService;
