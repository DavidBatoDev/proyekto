import { useCallback, useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import {
	type AgentClarifierCard,
	type AgentIntentType,
	type AgentPlanProposal,
	type AgentResponseMode,
	aiAgentService,
	type RunCommitView,
} from "@/services/ai-agent.service";
import {
	type AiMessage,
	AiSessionsServiceError,
	type AppendAiMessagePayload,
	aiSessionsService,
} from "@/services/ai-sessions.service";
import { useAiThreadsStore } from "@/stores/aiThreadsStore";
import { type AiSessionScope, aiScopeKey, toAgentScope } from "./scope";
import type {
	AiActivityTimeline,
	AiChatMessage,
	AiCommitLifecycle,
	AiMentionSpan,
} from "./types";

// =============================================================================
// In-memory message store (Zustand). This is working state for the panels —
// the DB is the source of truth. On thread switch we hydrate from the backend
// and seed this store; every live append/update from the run controller
// operates here so the stateful UX (live activity trace, optimistic bubbles,
// commit cards) keeps working without touching the network.
//
// Keyed by thread id, so it is scope-agnostic and shared by every mounted
// panel (the dashboard rail + fullscreen render the same thread). Exported
// because the singleton run controller writes to it via `getState()`.
// =============================================================================

export interface ThreadMessagesState {
	messagesByThread: Record<string, AiChatMessage[]>;
	hydratedThreads: Record<string, boolean>;
	setThreadMessages: (threadId: string, messages: AiChatMessage[]) => void;
	markHydrated: (threadId: string) => void;
	clearThread: (threadId: string) => void;
	appendToThread: (threadId: string, message: AiChatMessage) => void;
	updateInThread: (
		threadId: string,
		messageId: string,
		updater: (message: AiChatMessage) => AiChatMessage,
	) => void;
}

export const useThreadMessagesStore = create<ThreadMessagesState>((set) => ({
	messagesByThread: {},
	hydratedThreads: {},
	setThreadMessages: (threadId, messages) =>
		set((state) => ({
			messagesByThread: { ...state.messagesByThread, [threadId]: messages },
		})),
	markHydrated: (threadId) =>
		set((state) => ({
			hydratedThreads: { ...state.hydratedThreads, [threadId]: true },
		})),
	clearThread: (threadId) =>
		set((state) => {
			const nextMessages = { ...state.messagesByThread };
			delete nextMessages[threadId];
			const nextHydrated = { ...state.hydratedThreads };
			delete nextHydrated[threadId];
			return {
				messagesByThread: nextMessages,
				hydratedThreads: nextHydrated,
			};
		}),
	appendToThread: (threadId, message) =>
		set((state) => {
			const current = state.messagesByThread[threadId] ?? [];
			return {
				messagesByThread: {
					...state.messagesByThread,
					[threadId]: [...current, message],
				},
			};
		}),
	updateInThread: (threadId, messageId, updater) =>
		set((state) => {
			const current = state.messagesByThread[threadId];
			if (!current) return state;
			return {
				messagesByThread: {
					...state.messagesByThread,
					[threadId]: current.map((m) => (m.id === messageId ? updater(m) : m)),
				},
			};
		}),
}));

// -----------------------------------------------------------------------------
// DB row -> client message
// -----------------------------------------------------------------------------

const MENTION_KINDS = new Set([
	"project",
	"roadmap",
	"epic",
	"feature",
	"task",
	"milestone",
	"team",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `metadata.refs` is written by the web but read back untrusted. */
function parsePersistedRefs(value: unknown): AiMentionSpan[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const spans: AiMentionSpan[] = [];
	for (const entry of value) {
		if (!isRecord(entry)) continue;
		const { kind, id, label, offset, length } = entry;
		if (
			typeof kind !== "string" ||
			!MENTION_KINDS.has(kind) ||
			typeof id !== "string" ||
			typeof label !== "string" ||
			typeof offset !== "number" ||
			typeof length !== "number"
		) {
			continue;
		}
		spans.push({
			kind: kind as AiMentionSpan["kind"],
			id,
			label,
			offset,
			length,
			...(typeof entry.roadmapId === "string"
				? { roadmapId: entry.roadmapId }
				: {}),
			...(typeof entry.projectId === "string" || entry.projectId === null
				? { projectId: entry.projectId as string | null }
				: {}),
		});
	}
	return spans.length > 0 ? spans : undefined;
}

// Map a persisted DB row back to the rich client message shape. Client-only
// fields (live activity, streaming preview) don't round-trip — they're
// ephemeral UI state; the DB keeps the run summary (`metadata.run`), plan /
// clarifier cards, mention refs and the legacy commit lifecycle so past
// threads still look complete.
export function dbRowToClientMessage(row: AiMessage): AiChatMessage {
	const base: AiChatMessage = {
		id: row.id,
		role: row.role === "system" ? "assistant" : row.role,
		content: row.content,
		timestamp: row.created_at,
		parseMode: row.parse_mode ?? undefined,
		intentType: (row.intent_type ?? undefined) as AgentIntentType | undefined,
		responseMode: (row.response_mode ?? undefined) as
			| AgentResponseMode
			| undefined,
	};
	if (row.activity_timeline && typeof row.activity_timeline === "object") {
		base.activityTimeline =
			row.activity_timeline as unknown as AiActivityTimeline;
	}
	if (row.commit_lifecycle && typeof row.commit_lifecycle === "object") {
		base.commitLifecycle = row.commit_lifecycle as unknown as AiCommitLifecycle;
	}
	const metadata = isRecord(row.metadata) ? row.metadata : {};
	if (isRecord(metadata.plan_proposal)) {
		base.planProposal = metadata.plan_proposal as unknown as AgentPlanProposal;
	}
	if (isRecord(metadata.clarifier)) {
		base.clarifier = metadata.clarifier as unknown as AgentClarifierCard;
	}
	const refs = parsePersistedRefs(metadata.refs);
	if (refs) base.refs = refs;
	if (isRecord(metadata.run)) {
		if (typeof metadata.run.run_id === "string") {
			base.runId = metadata.run.run_id;
		}
		if (Array.isArray(metadata.run.commits)) {
			const commits = metadata.run.commits.filter(
				(entry): entry is RunCommitView =>
					isRecord(entry) &&
					typeof entry.roadmap_id === "string" &&
					typeof entry.status === "string",
			);
			if (commits.length > 0) base.commits = commits;
		}
	}
	return base;
}

// -----------------------------------------------------------------------------
// Scope-bound persistence helpers (pure functions of the scope; safe for the
// run controller to capture per run)
// -----------------------------------------------------------------------------

export interface PersistTurnExtras {
	intentType?: string;
	responseMode?: AgentResponseMode;
	parseMode?: string;
	activityTimeline?: Record<string, unknown>;
	commitLifecycle?: Record<string, unknown>;
	tokens?: number;
	metadata?: Record<string, unknown>;
}

export interface PersistTurnResult {
	seed_messages: Array<{ role: string; content: string }>;
}

export type SeedMessages = PersistTurnResult["seed_messages"];

/** Persist a completed turn; returns the agent's Redis-miss replay seeds. */
export async function persistTurnForScope(
	scope: AiSessionScope,
	threadId: string,
	role: "user" | "assistant",
	content: string,
	extras?: PersistTurnExtras,
): Promise<PersistTurnResult> {
	const payload: AppendAiMessagePayload = {
		role,
		content,
		intent_type: extras?.intentType,
		response_mode: extras?.responseMode,
		parse_mode: extras?.parseMode,
		activity_timeline: extras?.activityTimeline,
		commit_lifecycle: extras?.commitLifecycle,
		tokens: extras?.tokens,
		metadata: extras?.metadata,
	};
	const result = await aiSessionsService.appendMessage(
		scope,
		threadId,
		payload,
	);
	return { seed_messages: result.seed_messages };
}

/** Best-effort read of the agent's durable memory snapshot for a thread. */
export async function readAgentStateSnapshot(
	scope: AiSessionScope,
	threadId: string,
): Promise<Record<string, unknown> | undefined> {
	try {
		const row = await aiSessionsService.getById(scope, threadId);
		const candidate = (row.metadata as Record<string, unknown> | null)
			?.agent_state;
		if (candidate && typeof candidate === "object") {
			return candidate as Record<string, unknown>;
		}
	} catch {
		/* snapshot fetch is best-effort */
	}
	return undefined;
}

/**
 * On a Redis miss (the agent answered SESSION_NOT_FOUND) recreate the agent
 * session: restore the memory-class state saved by the agent's snapshot
 * write-back (pending plan, undo log, recents, summary) and replay the seed
 * messages so the next send has context.
 */
export async function rehydrateAgentSessionForScope(
	scope: AiSessionScope,
	threadId: string,
	seedMessages: SeedMessages,
	options: { baseRevision?: number } = {},
): Promise<void> {
	const agentState = await readAgentStateSnapshot(scope, threadId);
	await aiAgentService.createSession({
		session_id: threadId,
		scope: toAgentScope(scope),
		base_revision: options.baseRevision,
		metadata: agentState,
		seed_messages: seedMessages,
	});
}

// =============================================================================
// Hook
// =============================================================================

export interface UseAiThreadMessagesResult {
	messages: AiChatMessage[];
	isLoading: boolean;
	appendMessage: (threadId: string, message: AiChatMessage) => void;
	updateMessage: (
		threadId: string,
		messageId: string,
		updater: (message: AiChatMessage) => AiChatMessage,
	) => void;
	clearMessages: (threadId: string) => void;
	// Called after creating a brand-new thread so the hydration effect skips
	// the DB fetch (the DB is empty for a new row). Without this, the effect
	// fires after `setActiveThread`, fetches `[]`, and overwrites the user's
	// freshly-appended first message.
	markThreadHydrated: (threadId: string) => void;
	// Persist a completed turn to the backend. Returns the seed_messages the
	// agent should fall back on if its Redis session has expired.
	persistTurn: (
		threadId: string,
		role: "user" | "assistant",
		content: string,
		extras?: PersistTurnExtras,
	) => Promise<PersistTurnResult>;
	// On Redis-miss (agent sendMessage returns SESSION_NOT_FOUND), replay the
	// given seed_messages into the agent's session so the next send succeeds.
	rehydrateAgentSession: (
		threadId: string,
		seedMessages: SeedMessages,
		options: { scope: AiSessionScope; baseRevision?: number },
	) => Promise<void>;
}

const EMPTY_MESSAGES: AiChatMessage[] = [];

export function useAiThreadMessages(
	scope: AiSessionScope | null,
	threadId: string | null,
): UseAiThreadMessagesResult {
	const scopeKey = scope ? aiScopeKey(scope) : null;
	const messages = useThreadMessagesStore((s) =>
		threadId
			? (s.messagesByThread[threadId] ?? EMPTY_MESSAGES)
			: EMPTY_MESSAGES,
	);
	const hydrated = useThreadMessagesStore((s) =>
		threadId ? Boolean(s.hydratedThreads[threadId]) : true,
	);
	const setThreadMessages = useThreadMessagesStore((s) => s.setThreadMessages);
	const markHydrated = useThreadMessagesStore((s) => s.markHydrated);
	const clearThread = useThreadMessagesStore((s) => s.clearThread);
	const appendToThread = useThreadMessagesStore((s) => s.appendToThread);
	const updateInThread = useThreadMessagesStore((s) => s.updateInThread);

	const loadingRef = useRef(false);
	const setActiveThreadInStore = useAiThreadsStore((s) => s.setActiveThread);
	const clearDraft = useAiThreadsStore((s) => s.clearDraft);

	useEffect(() => {
		if (!threadId || !scope || !scopeKey) return;
		if (hydrated) return;
		if (loadingRef.current) return;

		// If messages were already written to this thread's in-memory slot (e.g.
		// the controller appended the optimistic user bubble before this effect
		// fired for a freshly created thread), skip the DB fetch — the DB is
		// empty for a brand-new session and fetching would overwrite the
		// optimistic user message with []. On a real page reload the in-memory
		// store is reset, so this guard is a no-op and hydration proceeds.
		const preloaded =
			useThreadMessagesStore.getState().messagesByThread[threadId];
		if (preloaded && preloaded.length > 0) {
			markHydrated(threadId);
			return;
		}

		loadingRef.current = true;
		(async () => {
			try {
				const rows = await aiSessionsService.listMessages(scope, threadId, {
					limit: 100,
				});
				const clientMessages = rows.map(dbRowToClientMessage);
				setThreadMessages(threadId, clientMessages);
				markHydrated(threadId);
			} catch (err) {
				// Stale `activeThreadId` persisted in localStorage can point at a DB
				// row the user doesn't own (or that never made it to the DB due to
				// an earlier failure). Drop it silently so the panel auto-selects a
				// real thread or creates a new one on first message.
				if (err instanceof AiSessionsServiceError && err.statusCode === 404) {
					console.debug(
						"[useAiThreadMessages] stale activeThreadId — clearing",
						{ scopeKey, threadId },
					);
					// Mark hydrated so a remounted component (e.g. HMR) doesn't
					// re-fire this effect before setActiveThreadInStore propagates.
					markHydrated(threadId);
					clearDraft(threadId);
					setActiveThreadInStore(scopeKey, null);
				} else {
					console.error("[useAiThreadMessages] failed to hydrate thread", err);
				}
			} finally {
				loadingRef.current = false;
			}
		})();
	}, [
		scope,
		scopeKey,
		threadId,
		hydrated,
		setThreadMessages,
		markHydrated,
		setActiveThreadInStore,
		clearDraft,
	]);

	const appendMessage = useCallback(
		(targetThreadId: string, message: AiChatMessage) => {
			appendToThread(targetThreadId, message);
		},
		[appendToThread],
	);

	const updateMessage = useCallback(
		(
			targetThreadId: string,
			messageId: string,
			updater: (message: AiChatMessage) => AiChatMessage,
		) => {
			updateInThread(targetThreadId, messageId, updater);
		},
		[updateInThread],
	);

	const clearMessages = useCallback(
		(targetThreadId: string) => {
			clearThread(targetThreadId);
		},
		[clearThread],
	);

	const persistTurn = useCallback<UseAiThreadMessagesResult["persistTurn"]>(
		async (targetThreadId, role, content, extras) => {
			if (!scope) {
				return { seed_messages: [] };
			}
			return persistTurnForScope(scope, targetThreadId, role, content, extras);
		},
		[scope],
	);

	const rehydrateAgentSession = useCallback<
		UseAiThreadMessagesResult["rehydrateAgentSession"]
	>(async (targetThreadId, seedMessages, options) => {
		await rehydrateAgentSessionForScope(
			options.scope,
			targetThreadId,
			seedMessages,
			{ baseRevision: options.baseRevision },
		);
	}, []);

	return useMemo(
		() => ({
			messages,
			isLoading: Boolean(threadId) && !hydrated,
			appendMessage,
			updateMessage,
			clearMessages,
			markThreadHydrated: markHydrated,
			persistTurn,
			rehydrateAgentSession,
		}),
		[
			messages,
			threadId,
			hydrated,
			appendMessage,
			updateMessage,
			clearMessages,
			markHydrated,
			persistTurn,
			rehydrateAgentSession,
		],
	);
}
