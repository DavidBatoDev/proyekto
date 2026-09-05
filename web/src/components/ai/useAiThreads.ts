import type { UseQueryResult } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAiSessionsList, useCreateAiSession } from "@/hooks/useAiSessions";
import { aiAgentService } from "@/services/ai-agent.service";
import type { AiSession } from "@/services/ai-sessions.service";
import { useActiveAiThread, useAiThreadsStore } from "@/stores/aiThreadsStore";
import { aiRunController } from "./runController";
import { type AiSessionScope, aiScopeKey, toAgentScope } from "./scope";
import {
	readAgentStateSnapshot,
	useThreadMessagesStore,
} from "./useAiThreadMessages";

// =============================================================================
// Thread selection for one scope: the persisted active thread, the sessions
// list, the reconcile effect, and the create / ensure helpers the run
// controller needs. Lifted from the old roadmap panel; every ordering note
// below is load-bearing.
// =============================================================================

export interface UseAiThreadsOptions {
	baseRevision?: number;
}

export interface UseAiThreadsResult {
	activeThreadId: string | null;
	threadsList: UseQueryResult<AiSession[]>;
	/** Trigger text for the thread menu: title, "Untitled", or "New thread". */
	activeThreadLabel: string;
	selectThread: (threadId: string) => void;
	/** Resolve (or create) the durable thread before the first send. */
	ensureThread: () => Promise<string>;
	/** Idempotent agent-session warm-up (best-effort). */
	ensureAgentSession: (threadId: string) => Promise<void>;
	/** "New thread": create the row, switch to it, warm the agent in the background. */
	createNewThread: () => Promise<void>;
}

export const NEW_THREAD_LABEL = "New thread";
export const UNTITLED_THREAD_LABEL = "Untitled";

export function useAiThreads(
	scope: AiSessionScope | null,
	options: UseAiThreadsOptions = {},
): UseAiThreadsResult {
	const { baseRevision } = options;
	const scopeKey = scope ? aiScopeKey(scope) : null;
	const activeThreadId = useActiveAiThread(scopeKey);
	const setActiveThread = useAiThreadsStore((s) => s.setActiveThread);
	const markHydrated = useThreadMessagesStore((s) => s.markHydrated);
	const createAiSession = useCreateAiSession(scope);
	const threadsList = useAiSessionsList(scope, { archived: false });

	// A thread we just created via "New thread" that may not be in the cached
	// list yet (the backend caches the authed sessions GET, so the post-create
	// refetch can briefly return a stale list). The reconcile effect must not
	// evict it, or the UI bounces back to the previously-active thread.
	const justCreatedThreadRef = useRef<string | null>(null);
	const agentSessionsInitializedRef = useRef<Set<string>>(new Set());
	// Latest values for the async helpers the controller calls mid-send.
	const activeThreadIdRef = useRef(activeThreadId);
	activeThreadIdRef.current = activeThreadId;
	const scopeRef = useRef(scope);
	scopeRef.current = scope;
	const baseRevisionRef = useRef(baseRevision);
	baseRevisionRef.current = baseRevision;

	// Auto-select the most recent active thread on mount if none is selected —
	// the pop menu can still flip between threads later. Also reconciles a
	// stale persisted `activeThreadId` (from localStorage) against the current
	// server list so we don't hydrate a thread the user doesn't own anymore.
	useEffect(() => {
		if (!scopeKey) return;
		const threads = threadsList.data;
		if (!threads) return;
		// While the list is refetching (e.g. immediately after createAiSession
		// invalidates the query), the cached data is stale. Skip reconciliation
		// so an explicitly-set activeThreadId (from createNewThread) isn't
		// overwritten by "ID not found in stale list -> reset to first thread".
		if (threadsList.isFetching) return;
		if (activeThreadId) {
			const stillExists = threads.some((t) => t.id === activeThreadId);
			if (stillExists) {
				justCreatedThreadRef.current = null;
				return;
			}
			// Don't evict a thread we just created that hasn't appeared in the
			// (possibly stale/cached) list yet -- otherwise the UI bounces back to
			// the previous thread immediately after switching. Cleared above once
			// the thread shows up in the list.
			if (justCreatedThreadRef.current === activeThreadId) return;
			// The thread is gone (deleted, or a stale localStorage id): stop any
			// run stream it still owns before moving on.
			aiRunController.teardownThread(activeThreadId);
			if (threads.length > 0) {
				setActiveThread(scopeKey, threads[0].id);
			} else {
				setActiveThread(scopeKey, null);
			}
			return;
		}
		if (threads.length === 0) return;
		setActiveThread(scopeKey, threads[0].id);
	}, [
		activeThreadId,
		threadsList.data,
		threadsList.isFetching,
		scopeKey,
		setActiveThread,
	]);

	const selectThread = useCallback(
		(threadId: string) => {
			if (!scopeKey || threadId === activeThreadIdRef.current) return;
			setActiveThread(scopeKey, threadId);
		},
		[scopeKey, setActiveThread],
	);

	// Resolve the durable thread first so the optimistic user bubble can be
	// attached to a concrete id before any agent warm-up or model work begins.
	const ensureThread = useCallback(async (): Promise<string> => {
		const current = activeThreadIdRef.current;
		if (current) return current;
		const currentScope = scopeRef.current;
		if (!currentScope) {
			throw new Error("AI session scope is not resolved yet");
		}
		const dbRow = await createAiSession.mutateAsync({});
		// Mark hydrated BEFORE setActiveThread so the hook's hydration effect
		// short-circuits on its first run with the new threadId. Otherwise the
		// effect fetches an empty DB result and overwrites the user message the
		// controller is about to append.
		markHydrated(dbRow.id);
		justCreatedThreadRef.current = dbRow.id;
		setActiveThread(aiScopeKey(currentScope), dbRow.id);
		return dbRow.id;
	}, [createAiSession, markHydrated, setActiveThread]);

	const ensureAgentSession = useCallback(
		async (threadId: string): Promise<void> => {
			if (agentSessionsInitializedRef.current.has(threadId)) return;
			const currentScope = scopeRef.current;
			if (!currentScope) return;
			try {
				const agentState = await readAgentStateSnapshot(currentScope, threadId);
				await aiAgentService.createSession({
					session_id: threadId,
					scope: toAgentScope(currentScope),
					base_revision: baseRevisionRef.current,
					metadata: agentState,
				});
				agentSessionsInitializedRef.current.add(threadId);
			} catch (err) {
				// Non-fatal — sendMessage will either use the live session or
				// trigger the SESSION_NOT_FOUND rehydration path.
				console.warn("[useAiThreads] agent createSession precheck failed", err);
			}
		},
		[],
	);

	const createNewThread = useCallback(async (): Promise<void> => {
		const currentScope = scopeRef.current;
		if (!currentScope) return;
		const row = await createAiSession.mutateAsync({});
		// Switch to the new thread the moment its DB row exists. The redirect
		// must NOT block on the agent's Redis-session warm-up: at
		// min-instances=0 the agent can cold-start (or fail), and awaiting it
		// here would hang the UI on a blank new thread with no error -- which is
		// exactly the "New thread does nothing" bug. The send path
		// (ensureAgentSession) lazily creates/rehydrates the agent session on
		// the first message anyway, so warming it now is best-effort.
		justCreatedThreadRef.current = row.id;
		markHydrated(row.id);
		setActiveThread(aiScopeKey(currentScope), row.id);
		void aiAgentService
			.createSession({
				session_id: row.id,
				scope: toAgentScope(currentScope),
				base_revision: baseRevisionRef.current,
			})
			.then(() => {
				agentSessionsInitializedRef.current.add(row.id);
			})
			.catch((err) => {
				console.warn("[useAiThreads] agent createSession warm-up failed", err);
			});
	}, [createAiSession, markHydrated, setActiveThread]);

	const activeThreadLabel = useMemo(() => {
		if (!activeThreadId) return NEW_THREAD_LABEL;
		const thread = threadsList.data?.find((t) => t.id === activeThreadId);
		const title = thread?.title?.trim();
		return title && title.length > 0 ? title : UNTITLED_THREAD_LABEL;
	}, [activeThreadId, threadsList.data]);

	return useMemo(
		() => ({
			activeThreadId,
			threadsList,
			activeThreadLabel,
			selectThread,
			ensureThread,
			ensureAgentSession,
			createNewThread,
		}),
		[
			activeThreadId,
			threadsList,
			activeThreadLabel,
			selectThread,
			ensureThread,
			ensureAgentSession,
			createNewThread,
		],
	);
}
