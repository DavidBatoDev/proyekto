import { featureFlags } from "@/config/featureFlags";
import { isRealtimeConfigured, RealtimeRoom } from "@/lib/realtime";
import {
	type AgentCommitSummary,
	type AgentRunPhase,
	type AgentRunResponse,
	type AgentRunStatus,
	type AgentTraceEvent,
	type AgentTraceEventsResponse,
	aiAgentService,
	getAgentErrorCode,
	isAgentTimeoutError,
	isAiAgentServiceError,
	type RunCommitView,
	type RunView,
	TERMINAL_RUN_STATUSES,
} from "@/services/ai-agent.service";
import { type AiRunState, useAiRunStore } from "@/stores/aiRunStore";
import { toAgentRefs } from "./aiMentions";
import {
	chooseNextPollDelayMs,
	collectUnseenDeltaEvents,
	ensureTimelineCompleted,
	PROGRESS_DETAIL_MODE,
	PROGRESS_PRESENTATION_MODE,
	parseCommitImpactedItemsFromOperations,
	resolveCommitLifecycleFromTimeline,
	TRACE_NOT_READY_GRACE_MS,
	TRACE_POLL_INTERVAL_MS,
	TRACE_POLL_LIMIT,
	toTimelineFromTraceResponse,
} from "./aiProgress";
import { type AiSessionScope, aiScopeKey, focusRoadmapId } from "./scope";
import type { AiActivityTimeline, AiChatMessage, AiMentionSpan } from "./types";
import {
	type PersistTurnExtras,
	type PersistTurnResult,
	type SeedMessages,
	useThreadMessagesStore,
} from "./useAiThreadMessages";

// =============================================================================
// The singleton run controller. It owns the send / continue / cancel / resume
// loop of every AI thread, the trace stream (polling + realtime push) and the
// per-thread poll loops; it writes to `useAiRunStore` (run state) and
// `useThreadMessagesStore` (messages) via `getState()` and never touches
// React. Panels only subscribe and dispatch, so a run keeps advancing after
// the user switches threads, collapses the dashboard rail, or navigates away.
//
// Wire contract: plan "Cross-service wire contract" (D2). A message is a run;
// the agent advances it until a checkpoint, completion, or its per-request
// budget and answers `run.next`. While `next === "continue"` the web calls
// `continueRun`; the error switch below is the plan's "Errors" table.
//
// This module never imports `roadmapStore` (kit boundary).
// =============================================================================

// -----------------------------------------------------------------------------
// Tunables
// -----------------------------------------------------------------------------

/** Per HTTP leg: axios 180s + 10s; reset on every send / continue / resume. */
export const TRACE_POLL_LEG_TIMEOUT_MS = 190_000;
/** Hard per-run wall clock (AGENT_RUN_MAX_STEPS x ~180s, rounded up). */
export const RUN_WALL_CLOCK_CAP_MS = 30 * 60 * 1000;
/** Poll cadence floor while the tab is hidden. */
export const TRACE_POLL_HIDDEN_INTERVAL_MS = 2500;
/** 409 RUN_IN_PROGRESS on continue: another instance holds the lock. */
export const CONTINUE_BUSY_POLL_INTERVAL_MS = 3000;
export const CONTINUE_BUSY_MAX_WAIT_MS = 150_000;
/** Transport failure on continue: one retry after this delay. */
export const CONTINUE_TRANSPORT_RETRY_DELAY_MS = 1500;
/** Trailing drain for verify events after a terminal leg; 0 at checkpoints. */
export const SETTLE_DRAIN_DONE_MS = 8_000;

export const RUN_EXPIRED_MESSAGE = "This run expired before it could finish.";
export const RUN_LOST_CONTACT_MESSAGE =
	"Lost contact while Proyekto was working. The run may still be in progress.";
export const RUN_TIMED_OUT_MESSAGE =
	"Proyekto has been working on this for a long time. Resume to keep going, or stop the run.";
export const AGENT_TIMEOUT_MESSAGE =
	"AI response is taking longer than expected. Please wait or retry.";
export const FAILED_FALLBACK_MESSAGE =
	"I couldn't complete that request. Please try again.";
export const STOPPED_MESSAGE = "Stopped.";
export const ANALYZED_FALLBACK_MESSAGE = "I analyzed your request.";

/** The trace store answers 404 until the agent's first flush lands. */
export const isTraceNotReadyError = (error: unknown): boolean => {
	if (isAiAgentServiceError(error)) {
		return error.statusCode === 404;
	}
	if (error instanceof Error) {
		return /trace_events_not_found|404/i.test(error.message);
	}
	return false;
};

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

/** Scope-bound persistence the panel hands the controller per send. */
export interface ThreadPersistence {
	persistTurn: (
		threadId: string,
		role: "user" | "assistant",
		content: string,
		extras?: PersistTurnExtras,
	) => Promise<PersistTurnResult>;
	rehydrateAgentSession: (
		threadId: string,
		seedMessages: SeedMessages,
		options: { scope: AiSessionScope; baseRevision?: number },
	) => Promise<void>;
	ensureAgentSession: (threadId: string) => Promise<void>;
}

export interface RunHookContext {
	threadId: string;
	runId: string | null;
}

/** Captured once per run. The kit never touches the roadmap store itself. */
export interface RunHooks {
	/** Newly committed commits (each once; this step's carry `operations`). */
	onCommits?: (commits: RunCommitView[], context: RunHookContext) => void;
	/** Every poll / push batch of the run's trace. */
	onTraceEvents?: (traceId: string, events: AgentTraceEvent[]) => void;
	onSettled?: (response: AgentRunResponse, context: RunHookContext) => void;
}

export interface SendParams {
	scope: AiSessionScope;
	/** The active thread, or null when the first send must create it. */
	threadId: string | null;
	ensureThread: () => Promise<string>;
	/** Wire message (may be a sentinel). */
	content: string;
	/** Bubble + DB text for sentinel sends. */
	displayLabel?: string;
	refs: AiMentionSpan[];
	baseRevision?: number;
	persist: ThreadPersistence;
	hooks: RunHooks;
}

// -----------------------------------------------------------------------------
// Internal state
// -----------------------------------------------------------------------------

interface PollLoopState {
	threadId: string;
	sessionId: string;
	traceId: string;
	afterSeq: number;
	/** Reset on every send / continue / resume (per-leg deadline). */
	legStartedAtMs: number;
	cancelled: boolean;
	timerId: ReturnType<typeof setTimeout> | null;
	pollingFailed: boolean;
	// assistant_delta seqs already appended to the streaming preview. Both
	// polling and realtime push feed the preview; this prevents the same
	// chunk from being appended twice when their windows overlap.
	processedDeltaSeqs: Set<number>;
	// Epoch ms of the last realtime-pushed batch for this trace (0 = none).
	// A fresh push backs polling off to the reconciliation heartbeat.
	lastPushAtMs: number;
	// A poll fetch is currently awaiting its response. Guards the pushed-done
	// fast path from starting a second concurrent poll loop.
	inFlight: boolean;
	// Push reported done while a fetch was in flight: that fetch reconciles
	// immediately on completion instead of waiting out the backoff timer.
	reconcileAsap: boolean;
}

interface ThreadContext {
	threadId: string;
	scope: AiSessionScope;
	scopeKey: string;
	persist: ThreadPersistence;
	hooks: RunHooks;
	baseRevision?: number;
	loop: PollLoopState | null;
	/** Anchor of the hard wall-clock cap. */
	runStartedAtMs: number;
	/** Commits already handed to `hooks.onCommits` (by batch id). */
	seenCommitKeys: Set<string>;
	/** Replay seeds from the last persisted user turn. */
	lastSeeds: SeedMessages;
	/** Re-send guard for the RUN_IN_PROGRESS-on-send path. */
	resendDepth: number;
}

interface PushRoomEntry {
	room: RealtimeRoom;
	count: number;
}

type ContinueOutcome =
	| { kind: "response"; response: AgentRunResponse }
	| { kind: "settle"; response: AgentRunResponse }
	| { kind: "resumable"; errorMessage?: string };

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const noop = () => {};

const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

function newId(): string {
	const cryptoRef = globalThis.crypto as Crypto | undefined;
	if (cryptoRef && typeof cryptoRef.randomUUID === "function") {
		return cryptoRef.randomUUID();
	}
	return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

const nowIso = () => new Date().toISOString();

function toRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function toStringValue(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function isDocumentHidden(): boolean {
	return typeof document !== "undefined" && document.hidden === true;
}

const RUN_PHASES: ReadonlySet<string> = new Set([
	"investigate",
	"propose",
	"execute",
	"verify",
]);

function isRunPhase(value: unknown): value is AgentRunPhase {
	return typeof value === "string" && RUN_PHASES.has(value);
}

/** The assistant text when the agent sent none, by run status. */
export function fallbackAssistantMessage(
	status: AgentRunStatus | null,
	error?: { code?: string; message?: string } | null,
): string {
	if (status === "cancelled") return STOPPED_MESSAGE;
	if (status === "failed") {
		const detail = error?.message?.trim();
		return detail
			? `${FAILED_FALLBACK_MESSAGE} ${detail}`
			: FAILED_FALLBACK_MESSAGE;
	}
	return ANALYZED_FALLBACK_MESSAGE;
}

/** `RunCommitView` without the (possibly large) operations for persistence. */
function stripCommitOperations(commits: RunCommitView[]): RunCommitView[] {
	return commits.map(({ operations: _operations, ...rest }) => rest);
}

/**
 * Legacy agents (pre-run) answer with `commit_summary` for the focus roadmap
 * instead of `commits`; synthesize the one commit card the run era renders.
 */
export function synthesizeLegacyCommit(
	summary: AgentCommitSummary,
	response: Pick<AgentRunResponse, "operations">,
	roadmapId: string | null,
): RunCommitView {
	const operations = response.operations ?? [];
	return {
		batch_id: "legacy-commit-summary",
		roadmap_id: roadmapId ?? "",
		roadmap_title: null,
		project_id: null,
		status: summary.committed ? "committed" : "failed",
		change_id: summary.change_id ?? null,
		operations_count: operations.length,
		operations,
		impacted_items: summary.impacted_items ?? [],
		impacted_summary: summary.impacted_summary,
		semantic_diff_summary: summary.semantic_diff_summary,
		error_code: summary.error_code ?? null,
		error_message: summary.error_message ?? null,
	};
}

/** Progress for the banner: batches planned vs commits settled. */
function countCommitsProgress(
	run: RunView | null,
	commits: RunCommitView[],
): AiRunState["commitsProgress"] {
	const total = Math.max(run?.batches?.length ?? 0, commits.length);
	if (total === 0) return null;
	const done = commits.filter((commit) => commit.status !== "pending").length;
	return { done: Math.min(done, total), total };
}

// =============================================================================
// Controller
// =============================================================================

export class AiRunController {
	private readonly contexts = new Map<string, ThreadContext>();
	private readonly loopsByTrace = new Map<string, PollLoopState>();
	/** Poll cursor per trace id; survives across sends (a checkpoint answer may reuse the trace). */
	private readonly traceCursor = new Map<string, number>();
	private readonly pushRooms = new Map<string, PushRoomEntry>();
	private unloadHookInstalled = false;

	// ---------------------------------------------------------------------------
	// Public API
	// ---------------------------------------------------------------------------

	/**
	 * Start a run for a user message. Sets `startingByScope` BEFORE awaiting
	 * `ensureThread()` so the double-send guard covers the session-create
	 * round-trip (`useAiRunState` ORs it into `isSending`).
	 */
	async send(params: SendParams): Promise<void> {
		const scopeKey = aiScopeKey(params.scope);
		const store = useAiRunStore.getState();
		if (store.startingByScope[scopeKey]) return;
		if (params.threadId && this.isBusy(params.threadId)) return;

		store.setStarting(scopeKey, true);
		let threadId: string;
		try {
			threadId = params.threadId ?? (await params.ensureThread());
		} catch (error) {
			useAiRunStore.getState().setStarting(scopeKey, false);
			throw error;
		}
		if (this.isBusy(threadId)) {
			useAiRunStore.getState().setStarting(scopeKey, false);
			return;
		}

		const ctx = this.bindContext(threadId, params);
		ctx.runStartedAtMs = Date.now();
		ctx.seenCommitKeys = new Set();
		ctx.resendDepth = 0;
		this.patchRun(threadId, {
			scopeKey,
			isSending: true,
			errorMessage: null,
			tracePollingFailed: false,
			cancelRequested: false,
			resumable: null,
			legIndex: 0,
			runId: null,
			traceId: null,
			phase: null,
			status: null,
			next: null,
			commitsProgress: null,
			streamingPreview: null,
		});
		useAiRunStore.getState().setStarting(scopeKey, false);

		const userFacing = params.displayLabel ?? params.content;
		const refs = params.refs;
		this.appendMessage(threadId, {
			id: newId(),
			role: "user",
			content: userFacing,
			timestamp: nowIso(),
			...(refs.length > 0 ? { refs } : {}),
		});

		try {
			// Persist the user turn BEFORE calling the agent so it survives an
			// agent failure. The response includes the last N messages we can
			// replay if the agent's Redis session expired. We persist the friendly
			// text (not the sentinel) so history never shows raw JSON.
			const { seed_messages } = await ctx.persist.persistTurn(
				threadId,
				"user",
				userFacing,
				refs.length > 0
					? { metadata: { refs: refs as unknown as Record<string, unknown>[] } }
					: undefined,
			);
			ctx.lastSeeds = seed_messages;
			await ctx.persist.ensureAgentSession(threadId);
			await this.runSegment(ctx, params.content, refs);
		} catch (error) {
			this.failSend(ctx, error);
		}
	}

	/** Re-issue `continue` for a run whose last leg failed at the transport level. */
	async resume(threadId: string): Promise<void> {
		const ctx = this.contexts.get(threadId);
		const state = this.getRun(threadId);
		const resumable = state?.resumable;
		if (!ctx || !resumable || state?.isSending) return;
		ctx.runStartedAtMs = Date.now();
		this.patchRun(threadId, {
			resumable: null,
			isSending: true,
			errorMessage: null,
			cancelRequested: false,
			tracePollingFailed: false,
		});
		this.startTracePolling(ctx, resumable.traceId);
		const synthetic = this.responseFromRunView(
			this.syntheticRunView(ctx, {
				run_id: resumable.runId,
				trace_id: resumable.traceId,
				status: "running",
				phase: state?.phase ?? "investigate",
				next: "continue",
			}),
		);
		try {
			await this.advance(ctx, synthetic, { skipFirstApply: true });
		} catch (error) {
			this.failSend(ctx, error);
		}
	}

	/** Ask the agent to stop the thread's run. */
	async cancel(threadId: string): Promise<void> {
		const ctx = this.contexts.get(threadId);
		const state = this.getRun(threadId);
		if (!ctx || !state) return;
		const runId = state.runId ?? state.resumable?.runId ?? null;
		if (!runId) {
			// Nothing on the agent side yet (thread creation / first leg not
			// answered): the in-flight leg's response settles with "Stopped.".
			this.patchRun(threadId, { cancelRequested: true });
			return;
		}
		this.patchRun(threadId, { cancelRequested: true });
		let cancelled: RunView | null = null;
		try {
			const result = await aiAgentService.cancelRun(threadId, runId);
			cancelled = result?.run ?? null;
		} catch (error) {
			console.warn("[AiRunController] cancel_run_failed", {
				thread_id: threadId,
				run_id: runId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
		// With no leg in flight (resumable state) nothing else will settle the
		// run; do it here from the cancel body (or locally if that failed too).
		const latest = this.getRun(threadId);
		if (latest?.resumable && !latest.isSending) {
			const run =
				cancelled ??
				this.syntheticRunView(ctx, {
					run_id: runId,
					trace_id: latest.resumable.traceId,
					status: "cancelled",
					phase: latest.phase ?? "investigate",
					next: "done",
				});
			this.patchRun(threadId, { resumable: null, isSending: true });
			const response = this.responseFromRunView({
				...run,
				status: "cancelled",
				next: "done",
			});
			this.applyLeg(ctx, response);
			await this.settle(ctx, response);
		}
	}

	/**
	 * Realtime push subscription for the user's `ai_trace_event` room.
	 * Guarded exactly like the old panel effect (flag, transport configured,
	 * signed-in user — guests poll only), refcounted per user so the two
	 * dashboard mounts share one socket, StrictMode-safe (attach / detach /
	 * attach just re-creates the room). Returns the detach function.
	 */
	attachPush(userId: string | null | undefined): () => void {
		if (!featureFlags.realtimeAiTracePush) return noop;
		if (!isRealtimeConfigured()) return noop;
		if (!userId) return noop;
		let entry = this.pushRooms.get(userId);
		if (!entry) {
			const room = new RealtimeRoom(`user:${userId}`);
			room.on("ai_trace_event", (payload: unknown) => {
				this.applyPushedTraceEvents(payload);
			});
			room.connect();
			entry = { room, count: 0 };
			this.pushRooms.set(userId, entry);
		}
		entry.count += 1;
		const bound = entry;
		let detached = false;
		return () => {
			if (detached) return;
			detached = true;
			bound.count -= 1;
			if (bound.count <= 0 && this.pushRooms.get(userId) === bound) {
				bound.room.close();
				this.pushRooms.delete(userId);
			}
		};
	}

	/**
	 * Realtime-pushed trace events (agent -> DO worker -> `user:{id}` room):
	 * merged through the same seq-deduped path as polling, so push and poll
	 * coexist idempotently. Push paints the UI and backs polling off to the
	 * reconciliation heartbeat; a pushed `done` triggers an immediate
	 * authoritative poll. Push never advances `afterSeq` and never finalizes.
	 */
	applyPushedTraceEvents(payload: unknown): void {
		const record = toRecord(payload);
		if (!record) return;
		const traceId = toStringValue(record.trace_id);
		if (!traceId) return;
		const loop = this.loopsByTrace.get(traceId);
		if (!loop || loop.cancelled) return;
		const ctx = this.contexts.get(loop.threadId);
		if (!ctx) return;
		const events = Array.isArray(record.events)
			? (record.events as AgentTraceEvent[])
			: [];
		if (events.length === 0) return;
		loop.lastPushAtMs = Date.now();
		const startedAt = toStringValue(record.started_at);
		this.mergeTimeline(loop, {
			trace_id: loop.traceId,
			events,
			next_seq: loop.afterSeq,
			done: this.getRun(loop.threadId)?.liveActivity?.done ?? false,
			...(startedAt ? { started_at: startedAt } : {}),
		} as AgentTraceEventsResponse);
		this.applyStreamingDeltaEvents(loop, events);
		this.applyRunEventDetails(ctx, events);
		ctx.hooks.onTraceEvents?.(loop.traceId, events);
		if (record.done === true && !loop.pollingFailed) {
			if (loop.inFlight) {
				loop.reconcileAsap = true;
			} else {
				if (loop.timerId != null) {
					clearTimeout(loop.timerId);
					loop.timerId = null;
				}
				void this.pollTraceEvents(ctx, loop);
			}
		}
	}

	/** A thread was deleted: stop its stream and drop its run state. */
	teardownThread(threadId: string): void {
		const ctx = this.contexts.get(threadId);
		if (ctx?.loop) this.stopLoop(ctx, ctx.loop);
		this.contexts.delete(threadId);
		useAiRunStore.getState().resetRun(threadId);
	}

	/** Stop every poll loop (page unload). Run state is left as-is. */
	teardownAll(): void {
		for (const ctx of this.contexts.values()) {
			if (ctx.loop) this.stopLoop(ctx, ctx.loop);
		}
	}

	/** Test hook: forget every thread, cursor, and push room. */
	resetForTests(): void {
		this.teardownAll();
		this.contexts.clear();
		this.loopsByTrace.clear();
		this.traceCursor.clear();
		for (const entry of this.pushRooms.values()) entry.room.close();
		this.pushRooms.clear();
	}

	/** Test hook: the poll cursor recorded for a trace. */
	getTraceCursor(traceId: string): number | undefined {
		return this.traceCursor.get(traceId);
	}

	// ---------------------------------------------------------------------------
	// Send / continue / settle
	// ---------------------------------------------------------------------------

	private bindContext(threadId: string, params: SendParams): ThreadContext {
		const existing = this.contexts.get(threadId);
		if (existing) {
			existing.scope = params.scope;
			existing.scopeKey = aiScopeKey(params.scope);
			existing.persist = params.persist;
			existing.hooks = params.hooks;
			existing.baseRevision = params.baseRevision;
			return existing;
		}
		const created: ThreadContext = {
			threadId,
			scope: params.scope,
			scopeKey: aiScopeKey(params.scope),
			persist: params.persist,
			hooks: params.hooks,
			baseRevision: params.baseRevision,
			loop: null,
			runStartedAtMs: Date.now(),
			seenCommitKeys: new Set(),
			lastSeeds: [],
			resendDepth: 0,
		};
		this.contexts.set(threadId, created);
		this.installUnloadHook();
		return created;
	}

	/**
	 * One segment: mint a trace, send the message, adopt the agent's trace,
	 * and drive the run to its next checkpoint or terminal state.
	 */
	private async runSegment(
		ctx: ThreadContext,
		content: string,
		refs: AiMentionSpan[],
	): Promise<void> {
		const threadId = ctx.threadId;
		this.patchRun(threadId, { isSending: true, resumable: null });
		const clientTraceId = newId();
		this.startTracePolling(ctx, clientTraceId);

		let response: AgentRunResponse;
		try {
			response = await this.sendWithRehydrate(
				ctx,
				content,
				refs,
				clientTraceId,
			);
		} catch (error) {
			const code = getAgentErrorCode(error);
			const adopted = isAiAgentServiceError(error) ? error.run : null;
			if (code === "RUN_IN_PROGRESS" && adopted && ctx.resendDepth < 1) {
				// A run is still executing on the agent (crashed step with pending
				// commits, or another tab). Adopt it, drive it to settle, then
				// re-send the queued message: the user turn is already persisted
				// but the agent has not seen it.
				ctx.resendDepth += 1;
				this.adoptTrace(ctx, adopted.trace_id);
				await this.advance(ctx, this.responseFromRunView(adopted));
				if (this.getRun(threadId)?.cancelRequested) return;
				await this.runSegment(ctx, content, refs);
				return;
			}
			throw error;
		}

		const effectiveTraceId =
			response.run?.trace_id || response.debug_trace_id || clientTraceId;
		this.adoptTrace(ctx, effectiveTraceId);
		await this.advance(ctx, response);
	}

	/** `sendMessage` with the SESSION_NOT_FOUND rehydrate-and-retry-once path. */
	private async sendWithRehydrate(
		ctx: ThreadContext,
		content: string,
		refs: AiMentionSpan[],
		traceId: string,
	): Promise<AgentRunResponse> {
		const threadId = ctx.threadId;
		const payload = {
			message: content,
			refs: toAgentRefs(refs),
			capabilities: ["continue" as const],
		};
		try {
			return await aiAgentService.sendMessage(threadId, payload, { traceId });
		} catch (error) {
			if (!this.isSessionNotFound(error)) throw error;
			await ctx.persist.rehydrateAgentSession(threadId, ctx.lastSeeds, {
				scope: ctx.scope,
				baseRevision: ctx.baseRevision,
			});
			return aiAgentService.sendMessage(threadId, payload, { traceId });
		}
	}

	private isSessionNotFound(error: unknown): boolean {
		const code = getAgentErrorCode(error);
		if (code === "SESSION_NOT_FOUND") return true;
		// Pre-code agents answered a bare 404 for a Redis miss.
		return (
			code === null && isAiAgentServiceError(error) && error.statusCode === 404
		);
	}

	/**
	 * The continuation loop: apply each leg to the store, call `continue`
	 * while the agent says so (and the user has not stopped the run), then
	 * settle the assistant turn.
	 */
	private async advance(
		ctx: ThreadContext,
		first: AgentRunResponse,
		options: { skipFirstApply?: boolean } = {},
	): Promise<void> {
		const threadId = ctx.threadId;
		let response = first;
		let legs = 0;
		for (;;) {
			if (legs > 0 || !options.skipFirstApply) this.applyLeg(ctx, response);
			const run = response.run ?? null;
			const cancelRequested = Boolean(this.getRun(threadId)?.cancelRequested);
			if (!run || run.next !== "continue" || cancelRequested) {
				await this.settle(ctx, response);
				return;
			}
			if (Date.now() - ctx.runStartedAtMs > RUN_WALL_CLOCK_CAP_MS) {
				this.markResumable(ctx, run, RUN_TIMED_OUT_MESSAGE);
				return;
			}
			const outcome = await this.continueLeg(ctx, run);
			legs += 1;
			if (outcome.kind === "response") {
				response = outcome.response;
				continue;
			}
			if (outcome.kind === "settle") {
				this.applyLeg(ctx, outcome.response);
				await this.settle(ctx, outcome.response);
				return;
			}
			this.markResumable(ctx, run, outcome.errorMessage);
			return;
		}
	}

	/** One `continue` call with the plan's error switch. */
	private async continueLeg(
		ctx: ThreadContext,
		run: RunView,
	): Promise<ContinueOutcome> {
		const threadId = ctx.threadId;
		this.resetLegDeadline(ctx);
		let rehydrated = false;
		let transportRetried = false;
		const busySinceMs = Date.now();
		for (;;) {
			try {
				const response = await aiAgentService.continueRun(
					threadId,
					run.run_id,
					{ traceId: run.trace_id },
				);
				return { kind: "response", response };
			} catch (error) {
				const code = getAgentErrorCode(error);
				const status = isAiAgentServiceError(error)
					? error.statusCode
					: undefined;
				const body = isAiAgentServiceError(error) ? error.run : null;

				if (this.isSessionNotFound(error)) {
					if (rehydrated) {
						return { kind: "settle", response: this.expiredResponse(run) };
					}
					rehydrated = true;
					await ctx.persist.rehydrateAgentSession(threadId, ctx.lastSeeds, {
						scope: ctx.scope,
						baseRevision: ctx.baseRevision,
					});
					continue;
				}
				if (code === "RUN_NOT_FOUND") {
					return { kind: "settle", response: this.expiredResponse(run) };
				}
				if (code === "RUN_NOT_CONTINUABLE") {
					return {
						kind: "settle",
						response: this.responseFromRunView(body ?? run),
					};
				}
				if (code === "RUN_IN_PROGRESS") {
					if (body) this.applyRunView(ctx, body);
					if (Date.now() - busySinceMs > CONTINUE_BUSY_MAX_WAIT_MS) {
						return { kind: "resumable" };
					}
					await sleep(CONTINUE_BUSY_POLL_INTERVAL_MS);
					continue;
				}
				const isClientError =
					typeof status === "number" && status >= 400 && status < 500;
				if (isClientError && !isAgentTimeoutError(error)) {
					// A definitive rejection (401/403/422...): nothing to retry.
					return {
						kind: "settle",
						response: this.failedResponse(
							run,
							error instanceof Error ? error.message : String(error),
						),
					};
				}
				if (!transportRetried) {
					transportRetried = true;
					await sleep(CONTINUE_TRANSPORT_RETRY_DELAY_MS);
					continue;
				}
				console.warn("[AiRunController] continue_transport_failed", {
					thread_id: threadId,
					run_id: run.run_id,
					error: error instanceof Error ? error.message : String(error),
				});
				return { kind: "resumable" };
			}
		}
	}

	/** Patch the run fields from a leg and hand new commits to the hooks. */
	private applyLeg(ctx: ThreadContext, response: AgentRunResponse): void {
		const threadId = ctx.threadId;
		const run = response.run ?? null;
		const commits = this.commitsOf(ctx, response);
		const previous = this.getRun(threadId);
		this.patchRun(threadId, {
			runId: run?.run_id ?? previous?.runId ?? null,
			traceId: run?.trace_id ?? previous?.traceId ?? null,
			phase: run?.phase ?? previous?.phase ?? null,
			status: run?.status ?? previous?.status ?? null,
			next: run?.next ?? previous?.next ?? null,
			legIndex: (previous?.legIndex ?? 0) + 1,
			commitsProgress: countCommitsProgress(run, commits),
		});
		this.emitNewCommits(ctx, run?.run_id ?? null, commits);
	}

	/** Patch the run fields from a bare `RunView` (409 bodies, cancel). */
	private applyRunView(ctx: ThreadContext, run: RunView): void {
		const commits = run.commits ?? [];
		this.patchRun(ctx.threadId, {
			runId: run.run_id,
			traceId: run.trace_id,
			phase: run.phase,
			status: run.status,
			next: run.next,
			commitsProgress: countCommitsProgress(run, commits),
		});
		this.emitNewCommits(ctx, run.run_id, commits);
	}

	/** Cumulative commits of a leg (legacy `commit_summary` synthesized). */
	private commitsOf(
		ctx: ThreadContext,
		response: AgentRunResponse,
	): RunCommitView[] {
		if (Array.isArray(response.commits)) return response.commits;
		if (response.run?.commits) return response.run.commits;
		if (response.commit_summary) {
			return [
				synthesizeLegacyCommit(
					response.commit_summary,
					response,
					focusRoadmapId(ctx.scope),
				),
			];
		}
		return [];
	}

	private emitNewCommits(
		ctx: ThreadContext,
		runId: string | null,
		commits: RunCommitView[],
	): void {
		if (!ctx.hooks.onCommits) return;
		const fresh: RunCommitView[] = [];
		for (const commit of commits) {
			if (commit.status !== "committed") continue;
			const key = commit.batch_id || `${commit.roadmap_id}:${commit.change_id}`;
			if (ctx.seenCommitKeys.has(key)) continue;
			ctx.seenCommitKeys.add(key);
			fresh.push(commit);
		}
		if (fresh.length === 0) return;
		try {
			ctx.hooks.onCommits(fresh, { threadId: ctx.threadId, runId });
		} catch (error) {
			console.warn("[AiRunController] on_commits_hook_failed", error);
		}
	}

	/** Append the assistant turn, persist it, and finalize the trace. */
	private async settle(
		ctx: ThreadContext,
		response: AgentRunResponse,
	): Promise<void> {
		const threadId = ctx.threadId;
		const state = this.getRun(threadId);
		const run = response.run ?? null;
		const cancelRequested = Boolean(state?.cancelRequested);
		const status: AgentRunStatus | null = cancelRequested
			? "cancelled"
			: (run?.status ??
				(response.parse_mode === "agent_error" ? "failed" : "done"));
		const traceId = ctx.loop?.traceId ?? state?.traceId ?? null;

		// The segment is over: mark the live timeline complete for this trace
		// (finalize drains trailing events and moves it onto the message).
		this.patchLiveActivity(threadId, (prev) =>
			prev && traceId && prev.traceId === traceId
				? ensureTimelineCompleted(prev)
				: prev,
		);

		const assistantId = newId();
		this.patchRun(threadId, { liveActivityHostMessageId: assistantId });

		const commits =
			Array.isArray(response.commits) || response.commit_summary
				? this.commitsOf(ctx, response)
				: run?.commits && run.commits.length > 0
					? run.commits
					: undefined;
		// Legacy (pre-run) edit replies with staged ops but no commit info: keep
		// the old "committing" card that finalize resolves from the trace.
		const trackLegacyLifecycle =
			!commits &&
			!response.commit_summary &&
			response.response_mode === "edit_plan" &&
			((response.staged_operations_count ?? 0) > 0 ||
				(response.operations?.length ?? 0) > 0);

		const content =
			response.assistant_message?.trim() ||
			fallbackAssistantMessage(status, run?.error ?? null);
		const message: AiChatMessage = {
			id: assistantId,
			role: "assistant",
			content,
			timestamp: nowIso(),
			parseMode: response.parse_mode || "agent_response",
			intentType: response.intent_type,
			responseMode: response.response_mode,
			planProposal: response.plan_proposal ?? undefined,
			clarifier: response.clarifier ?? undefined,
			...(commits && commits.length > 0 ? { commits } : {}),
			...(run?.run_id ? { runId: run.run_id } : {}),
			...(trackLegacyLifecycle
				? {
						commitLifecycle: {
							state: "committing" as const,
							impactedItems: parseCommitImpactedItemsFromOperations(
								response.operations,
							),
							updatedAt: nowIso(),
						},
					}
				: {}),
		};
		this.appendMessage(threadId, message);
		if (commits) this.emitNewCommits(ctx, run?.run_id ?? null, commits);

		// Persist the assistant turn. Fire-and-forget so slow writes never block
		// the live trace; the run summary (no operations) rides `metadata.run`.
		const metadata: Record<string, unknown> = {};
		if (response.plan_proposal) metadata.plan_proposal = response.plan_proposal;
		if (response.clarifier) metadata.clarifier = response.clarifier;
		if (run) {
			metadata.run = {
				run_id: run.run_id,
				phase: run.phase,
				status,
				commits: stripCommitOperations(commits ?? run.commits ?? []),
			};
		}
		void ctx.persist
			.persistTurn(threadId, "assistant", response.assistant_message || "", {
				intentType: response.intent_type,
				responseMode: response.response_mode,
				parseMode: response.parse_mode || "agent_response",
				metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
			})
			.catch((err) => {
				console.warn(
					"[AiRunController] assistant message persistence failed",
					err,
				);
			});

		this.patchRun(threadId, {
			isSending: false,
			streamingPreview: null,
			status,
			phase: run?.phase ?? state?.phase ?? null,
			next: run?.next ?? "done",
			resumable: null,
			cancelRequested: false,
		});

		try {
			ctx.hooks.onSettled?.(response, {
				threadId,
				runId: run?.run_id ?? null,
			});
		} catch (error) {
			console.warn("[AiRunController] on_settled_hook_failed", error);
		}

		const terminal = status !== null && TERMINAL_RUN_STATUSES.has(status);
		if (traceId) {
			this.finalizeTraceTimeline(
				ctx,
				assistantId,
				traceId,
				terminal ? SETTLE_DRAIN_DONE_MS : 0,
			);
		} else {
			this.clearLiveActivity(threadId);
		}
	}

	/** The send failed before/at the agent call: error bubble, stop the stream. */
	private failSend(ctx: ThreadContext, error: unknown): void {
		const threadId = ctx.threadId;
		const timeoutError = isAgentTimeoutError(error);
		const readableError =
			error instanceof Error
				? error.message
				: "Failed to reach AI agent service.";
		const userFacingMessage = timeoutError
			? AGENT_TIMEOUT_MESSAGE
			: readableError;
		if (timeoutError) {
			console.warn("[AiRunController] send_message_timeout", {
				thread_id: threadId,
				error: readableError,
			});
		} else {
			console.warn("[AiRunController] send_failed", {
				thread_id: threadId,
				error: readableError,
			});
		}
		this.appendMessage(threadId, {
			id: newId(),
			role: "assistant",
			content: timeoutError ? AGENT_TIMEOUT_MESSAGE : FAILED_FALLBACK_MESSAGE,
			timestamp: nowIso(),
			parseMode: "agent_error",
		});
		if (ctx.loop) this.stopLoop(ctx, ctx.loop);
		this.clearLiveActivity(threadId);
		this.patchRun(threadId, {
			isSending: false,
			streamingPreview: null,
			errorMessage: userFacingMessage,
			cancelRequested: false,
		});
	}

	/** Transport lost mid-run: keep the run resumable, no assistant message. */
	private markResumable(
		ctx: ThreadContext,
		run: RunView,
		errorMessage: string = RUN_LOST_CONTACT_MESSAGE,
	): void {
		const threadId = ctx.threadId;
		if (ctx.loop) this.stopLoop(ctx, ctx.loop);
		this.patchRun(threadId, {
			isSending: false,
			streamingPreview: null,
			resumable: { runId: run.run_id, traceId: run.trace_id },
			errorMessage,
		});
	}

	// ---------------------------------------------------------------------------
	// Response shaping
	// ---------------------------------------------------------------------------

	private syntheticRunView(
		ctx: ThreadContext,
		partial: Pick<RunView, "run_id" | "trace_id" | "status" | "phase" | "next">,
	): RunView {
		const timestamp = nowIso();
		return {
			...partial,
			scope:
				ctx.scope.kind === "roadmap"
					? { kind: "roadmap", roadmap_id: ctx.scope.roadmapId }
					: { kind: "workspace", workspace_id: ctx.scope.workspaceId },
			commits: [],
			created_at: timestamp,
			updated_at: timestamp,
		};
	}

	/** A `RunView`-only body (409s, cancel) as a settle-able response. */
	private responseFromRunView(run: RunView): AgentRunResponse {
		return {
			session_id: "",
			assistant_message: "",
			parse_mode: "run_report",
			intent_type: "unclear",
			response_mode: "chat",
			operations: [],
			staged_operations_version: 0,
			staged_operations_count: 0,
			commits: run.commits ?? [],
			run,
		};
	}

	private failedResponse(run: RunView, message: string): AgentRunResponse {
		return this.responseFromRunView({
			...run,
			status: "failed",
			next: "done",
			error: { code: "RUN_FAILED", message },
		});
	}

	private expiredResponse(run: RunView): AgentRunResponse {
		return {
			...this.responseFromRunView({
				...run,
				status: "failed",
				next: "done",
				error: { code: "RUN_NOT_FOUND", message: RUN_EXPIRED_MESSAGE },
			}),
			assistant_message: RUN_EXPIRED_MESSAGE,
		};
	}

	// ---------------------------------------------------------------------------
	// Trace stream
	// ---------------------------------------------------------------------------

	private resetLegDeadline(ctx: ThreadContext): void {
		if (ctx.loop) ctx.loop.legStartedAtMs = Date.now();
	}

	private adoptTrace(ctx: ThreadContext, traceId: string): void {
		this.patchRun(ctx.threadId, { traceId });
		if (ctx.loop && ctx.loop.traceId === traceId && !ctx.loop.cancelled) {
			this.resetLegDeadline(ctx);
			return;
		}
		this.startTracePolling(ctx, traceId);
	}

	/**
	 * (Re)start the poll loop for a trace from the cursor recorded for it, so a
	 * resumed segment never replays from seq 0.
	 */
	private startTracePolling(ctx: ThreadContext, traceId: string): void {
		const threadId = ctx.threadId;
		if (ctx.loop) this.stopLoop(ctx, ctx.loop);
		this.patchRun(threadId, { streamingPreview: null });
		const loop: PollLoopState = {
			threadId,
			sessionId: threadId,
			traceId,
			afterSeq: this.traceCursor.get(traceId) ?? 0,
			legStartedAtMs: Date.now(),
			cancelled: false,
			timerId: null,
			pollingFailed: false,
			processedDeltaSeqs: new Set<number>(),
			lastPushAtMs: 0,
			inFlight: false,
			reconcileAsap: false,
		};
		ctx.loop = loop;
		this.loopsByTrace.set(traceId, loop);
		this.patchRun(threadId, {
			traceId,
			tracePollingFailed: false,
			liveActivityExpanded: true,
			liveActivityHostMessageId: null,
			liveActivity: {
				traceId,
				startedAt: nowIso(),
				done: false,
				detailMode: PROGRESS_DETAIL_MODE,
				presentationMode: PROGRESS_PRESENTATION_MODE,
				steps: [],
			},
		});
		void this.pollTraceEvents(ctx, loop);
	}

	private stopLoop(ctx: ThreadContext, loop: PollLoopState): void {
		loop.cancelled = true;
		if (loop.timerId != null) {
			clearTimeout(loop.timerId);
			loop.timerId = null;
		}
		if (this.loopsByTrace.get(loop.traceId) === loop) {
			this.loopsByTrace.delete(loop.traceId);
		}
		if (ctx.loop === loop) ctx.loop = null;
	}

	private async pollTraceEvents(
		ctx: ThreadContext,
		loop: PollLoopState,
	): Promise<void> {
		if (loop.cancelled) return;
		const now = Date.now();
		if (
			now - loop.legStartedAtMs > TRACE_POLL_LEG_TIMEOUT_MS ||
			now - ctx.runStartedAtMs > RUN_WALL_CLOCK_CAP_MS
		) {
			loop.pollingFailed = true;
			this.patchRun(loop.threadId, { tracePollingFailed: true });
			return;
		}

		loop.inFlight = true;
		try {
			const response = await aiAgentService.getTraceEvents(
				loop.sessionId,
				loop.traceId,
				{
					afterSeq: loop.afterSeq,
					limit: TRACE_POLL_LIMIT,
					detail: PROGRESS_DETAIL_MODE,
				},
			);
			if (loop.cancelled) return;
			loop.afterSeq = Math.max(loop.afterSeq, response.next_seq);
			this.traceCursor.set(loop.traceId, loop.afterSeq);
			this.mergeTimeline(loop, response);
			const freshDeltaCount = this.applyStreamingDeltaEvents(
				loop,
				response.events,
			);
			this.applyRunEventDetails(ctx, response.events);
			ctx.hooks.onTraceEvents?.(loop.traceId, response.events);
			if (response.done) {
				return;
			}
			let nextDelayMs = loop.reconcileAsap
				? 0
				: chooseNextPollDelayMs(Date.now(), loop.lastPushAtMs, freshDeltaCount);
			if (isDocumentHidden()) {
				nextDelayMs = Math.max(nextDelayMs, TRACE_POLL_HIDDEN_INTERVAL_MS);
			}
			loop.reconcileAsap = false;
			loop.timerId = setTimeout(() => {
				void this.pollTraceEvents(ctx, loop);
			}, nextDelayMs);
		} catch (error) {
			if (loop.cancelled) return;
			const elapsedSinceLegMs = Date.now() - loop.legStartedAtMs;
			if (
				isTraceNotReadyError(error) &&
				elapsedSinceLegMs < TRACE_NOT_READY_GRACE_MS
			) {
				loop.timerId = setTimeout(() => {
					void this.pollTraceEvents(ctx, loop);
				}, TRACE_POLL_INTERVAL_MS);
				return;
			}
			loop.pollingFailed = true;
			this.patchRun(loop.threadId, { tracePollingFailed: true });
			console.warn("[AiRunController] trace_poll_failed", {
				session_id: loop.sessionId,
				trace_id: loop.traceId,
				error: error instanceof Error ? error.message : String(error),
			});
		} finally {
			loop.inFlight = false;
		}
	}

	private mergeTimeline(
		loop: PollLoopState,
		response: AgentTraceEventsResponse,
	): AiActivityTimeline | null {
		let merged: AiActivityTimeline | null = null;
		this.patchLiveActivity(loop.threadId, (prev) => {
			merged = toTimelineFromTraceResponse(
				PROGRESS_DETAIL_MODE,
				loop.traceId,
				response,
				prev,
				PROGRESS_PRESENTATION_MODE,
			);
			return merged;
		});
		return merged;
	}

	// Accumulate streamed assistant text (chunk events, already in seq order).
	// A higher `turn` supersedes earlier partial text — a new model call is
	// writing now. Shared by the poll loop and the realtime push handler;
	// returns how many previously-unseen chunks were applied.
	private applyStreamingDeltaEvents(
		loop: PollLoopState,
		events: AgentTraceEvent[],
	): number {
		const deltaEvents = collectUnseenDeltaEvents(
			events,
			loop.processedDeltaSeqs,
		);
		if (deltaEvents.length === 0) return 0;
		const prev = this.getRun(loop.threadId)?.streamingPreview ?? null;
		let text = prev && prev.traceId === loop.traceId ? prev.text : "";
		let turn = prev && prev.traceId === loop.traceId ? prev.turn : 0;
		for (const event of deltaEvents) {
			const details = (event.details ?? {}) as {
				text?: unknown;
				turn?: unknown;
			};
			const chunk = typeof details.text === "string" ? details.text : "";
			const eventTurn = typeof details.turn === "number" ? details.turn : turn;
			if (eventTurn > turn) {
				text = "";
				turn = eventTurn;
			}
			text += chunk;
		}
		this.patchRun(loop.threadId, {
			streamingPreview: { traceId: loop.traceId, turn, text },
		});
		return deltaEvents.length;
	}

	/**
	 * `phase_entered` is hidden from the timeline but carries the live phase
	 * and commit progress between legs — patch the banner from it.
	 */
	private applyRunEventDetails(
		ctx: ThreadContext,
		events: AgentTraceEvent[],
	): void {
		let patch: Partial<Pick<AiRunState, "phase" | "commitsProgress">> | null =
			null;
		for (const event of events) {
			if (event.event !== "phase_entered") continue;
			const details = toRecord(event.details);
			if (!details) continue;
			if (isRunPhase(details.phase)) {
				patch = { ...(patch ?? {}), phase: details.phase };
			}
			const done = details.commits_done;
			const total = details.commits_total;
			if (typeof done === "number" && typeof total === "number" && total > 0) {
				patch = {
					...(patch ?? {}),
					commitsProgress: { done: Math.min(done, total), total },
				};
			}
		}
		if (patch) this.patchRun(ctx.threadId, patch);
	}

	/**
	 * Move the live timeline onto the assistant message. At a terminal leg the
	 * trace is drained for `drainMs` (trailing verify events); at a checkpoint
	 * there is nothing to wait for. The latest computed timeline is tracked
	 * locally so the write never depends on a render-lagging read.
	 */
	private finalizeTraceTimeline(
		ctx: ThreadContext,
		assistantMessageId: string,
		traceId: string,
		drainMs: number,
	): void {
		const threadId = ctx.threadId;
		const loop = ctx.loop;
		const readLive = () => this.getRun(threadId)?.liveActivity ?? null;

		if (!loop || loop.traceId !== traceId) {
			const existing = readLive();
			if (existing && existing.traceId === traceId) {
				this.writeFinalTimeline(
					threadId,
					assistantMessageId,
					ensureTimelineCompleted(existing),
				);
			}
			this.clearLiveActivity(threadId);
			return;
		}

		const finish = async () => {
			const deadline = Date.now() + drainMs;
			let latestTimeline: AiActivityTimeline | null = readLive();
			let reportedDone = false;
			while (!loop.cancelled && Date.now() < deadline && !loop.pollingFailed) {
				if (loop.inFlight) {
					await sleep(TRACE_POLL_INTERVAL_MS);
					continue;
				}
				try {
					const response = await aiAgentService.getTraceEvents(
						loop.sessionId,
						loop.traceId,
						{
							afterSeq: loop.afterSeq,
							limit: TRACE_POLL_LIMIT,
							detail: PROGRESS_DETAIL_MODE,
						},
					);
					if (loop.cancelled) return;
					loop.afterSeq = Math.max(loop.afterSeq, response.next_seq);
					this.traceCursor.set(loop.traceId, loop.afterSeq);
					latestTimeline = this.mergeTimeline(loop, response);
					this.applyRunEventDetails(ctx, response.events);
					ctx.hooks.onTraceEvents?.(loop.traceId, response.events);
					if (response.done) {
						reportedDone = true;
						break;
					}
				} catch (error) {
					if (
						isTraceNotReadyError(error) &&
						Date.now() - loop.legStartedAtMs < TRACE_NOT_READY_GRACE_MS
					) {
						await sleep(TRACE_POLL_INTERVAL_MS);
						continue;
					}
					loop.pollingFailed = true;
					this.patchRun(threadId, { tracePollingFailed: true });
					break;
				}
				await sleep(TRACE_POLL_INTERVAL_MS);
			}
			void reportedDone;

			this.stopLoop(ctx, loop);

			const timeline = latestTimeline ?? readLive();
			if (
				timeline &&
				timeline.traceId === traceId &&
				timeline.steps.length > 0
			) {
				this.writeFinalTimeline(
					threadId,
					assistantMessageId,
					ensureTimelineCompleted(timeline),
				);
			}
			this.clearLiveActivity(threadId);
		};

		void finish();
	}

	private writeFinalTimeline(
		threadId: string,
		assistantMessageId: string,
		completedTimeline: AiActivityTimeline,
	): void {
		useThreadMessagesStore
			.getState()
			.updateInThread(threadId, assistantMessageId, (message) => {
				// Run-era turns carry `commits`; only legacy "committing" cards are
				// resolved from the trace (commit_started / completed / failed).
				if (message.commits || !message.commitLifecycle) {
					return { ...message, activityTimeline: completedTimeline };
				}
				const resolvedRaw =
					resolveCommitLifecycleFromTimeline(completedTimeline);
				const resolved =
					resolvedRaw?.state === "committed" &&
					resolvedRaw.impactedItems.length === 0 &&
					message.commitLifecycle.impactedItems.length > 0
						? {
								...resolvedRaw,
								impactedItems: message.commitLifecycle.impactedItems,
							}
						: resolvedRaw;
				const fallback =
					!resolved && message.commitLifecycle.state === "committing"
						? {
								...message.commitLifecycle,
								state: "failed" as const,
								updatedAt: completedTimeline.completedAt || nowIso(),
							}
						: message.commitLifecycle;
				return {
					...message,
					activityTimeline: completedTimeline,
					commitLifecycle: resolved ?? fallback,
				};
			});
		useAiRunStore
			.getState()
			.setActivityExpanded(threadId, assistantMessageId, false);
	}

	// ---------------------------------------------------------------------------
	// Store access
	// ---------------------------------------------------------------------------

	private getRun(threadId: string): AiRunState | undefined {
		return useAiRunStore.getState().runsByThread[threadId];
	}

	private isBusy(threadId: string): boolean {
		return Boolean(this.getRun(threadId)?.isSending);
	}

	private patchRun(
		threadId: string,
		patch: Parameters<ReturnType<typeof useAiRunStore.getState>["patchRun"]>[1],
	): void {
		useAiRunStore.getState().patchRun(threadId, patch);
	}

	private patchLiveActivity(
		threadId: string,
		updater: (prev: AiActivityTimeline | null) => AiActivityTimeline | null,
	): void {
		const prev = this.getRun(threadId)?.liveActivity ?? null;
		const next = updater(prev);
		if (next === prev) return;
		this.patchRun(threadId, { liveActivity: next });
	}

	private clearLiveActivity(threadId: string): void {
		this.patchRun(threadId, {
			liveActivity: null,
			liveActivityExpanded: false,
			liveActivityHostMessageId: null,
		});
	}

	private appendMessage(threadId: string, message: AiChatMessage): void {
		useThreadMessagesStore.getState().appendToThread(threadId, message);
	}

	private installUnloadHook(): void {
		if (this.unloadHookInstalled) return;
		if (typeof window === "undefined" || !window.addEventListener) return;
		this.unloadHookInstalled = true;
		window.addEventListener("beforeunload", () => this.teardownAll());
	}
}

export const aiRunController = new AiRunController();

export default aiRunController;
