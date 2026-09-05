import { useMemo } from "react";
import { create } from "zustand";
import type { AiActivityTimeline } from "@/components/ai/types";
import type {
	AgentRunNext,
	AgentRunPhase,
	AgentRunStatus,
} from "@/services/ai-agent.service";

// =============================================================================
// Non-persisted run state, one slice per thread, written by the singleton run
// controller and read by every mounted panel. The dashboard mounts the rail
// and the fullscreen overlay at the same time, so a send started in one must
// be visible — and un-duplicable — in the other; and a run keeps advancing
// after the user navigates away because nothing here lives in a component.
//
// This store never imports `roadmapStore` (kit boundary).
// =============================================================================

export interface AiRunCommitsProgress {
	done: number;
	total: number;
}

export interface AiRunStreamingPreview {
	traceId: string;
	turn: number;
	text: string;
}

export interface AiRunResumable {
	runId: string;
	traceId: string;
}

export interface AiRunState {
	threadId: string;
	scopeKey: string;
	/** An HTTP leg is in flight OR the loop is between legs. */
	isSending: boolean;
	runId: string | null;
	traceId: string | null;
	phase: AgentRunPhase | null;
	status: AgentRunStatus | null;
	next: AgentRunNext | null;
	/** HTTP legs so far in this run (send = 1). */
	legIndex: number;
	commitsProgress: AiRunCommitsProgress | null;
	liveActivity: AiActivityTimeline | null;
	liveActivityExpanded: boolean;
	liveActivityHostMessageId: string | null;
	streamingPreview: AiRunStreamingPreview | null;
	tracePollingFailed: boolean;
	errorMessage: string | null;
	/** A continue leg failed at the transport level; the user may Resume. */
	resumable: AiRunResumable | null;
	cancelRequested: boolean;
	activityExpandedByMessageId: Record<string, boolean>;
}

export type AiRunStatePatch = Partial<Omit<AiRunState, "threadId">>;

export interface AiRunStoreState {
	runsByThread: Record<string, AiRunState>;
	/**
	 * `send()` is keyed by thread id, but the first send in a scope has to
	 * create the thread first (a network round-trip). This flag covers that
	 * window so the double-send guard holds before a thread id exists;
	 * `useAiRunState` ORs it into `isSending`.
	 */
	startingByScope: Record<string, boolean>;
	getRun: (threadId: string) => AiRunState | undefined;
	/** Create the idle slice for a thread if it is missing; returns it. */
	ensureRun: (threadId: string, scopeKey: string) => AiRunState;
	/** Merge a patch; creates the slice when it is missing. */
	patchRun: (threadId: string, patch: AiRunStatePatch) => void;
	resetRun: (threadId: string) => void;
	setStarting: (scopeKey: string, starting: boolean) => void;
	setActivityExpanded: (
		threadId: string,
		messageId: string,
		expanded: boolean,
	) => void;
}

export function createInitialAiRunState(
	threadId: string,
	scopeKey: string,
): AiRunState {
	return {
		threadId,
		scopeKey,
		isSending: false,
		runId: null,
		traceId: null,
		phase: null,
		status: null,
		next: null,
		legIndex: 0,
		commitsProgress: null,
		liveActivity: null,
		liveActivityExpanded: false,
		liveActivityHostMessageId: null,
		streamingPreview: null,
		tracePollingFailed: false,
		errorMessage: null,
		resumable: null,
		cancelRequested: false,
		activityExpandedByMessageId: {},
	};
}

export const useAiRunStore = create<AiRunStoreState>()((set, get) => ({
	runsByThread: {},
	startingByScope: {},

	getRun: (threadId) => get().runsByThread[threadId],

	ensureRun: (threadId, scopeKey) => {
		const existing = get().runsByThread[threadId];
		if (existing) return existing;
		const created = createInitialAiRunState(threadId, scopeKey);
		set((state) => ({
			runsByThread: { ...state.runsByThread, [threadId]: created },
		}));
		return created;
	},

	patchRun: (threadId, patch) =>
		set((state) => {
			const current =
				state.runsByThread[threadId] ??
				createInitialAiRunState(threadId, patch.scopeKey ?? "");
			return {
				runsByThread: {
					...state.runsByThread,
					[threadId]: { ...current, ...patch, threadId },
				},
			};
		}),

	resetRun: (threadId) =>
		set((state) => {
			if (!(threadId in state.runsByThread)) return state;
			const next = { ...state.runsByThread };
			delete next[threadId];
			return { runsByThread: next };
		}),

	setStarting: (scopeKey, starting) =>
		set((state) => {
			const current = Boolean(state.startingByScope[scopeKey]);
			if (current === starting) return state;
			const next = { ...state.startingByScope };
			if (starting) next[scopeKey] = true;
			else delete next[scopeKey];
			return { startingByScope: next };
		}),

	setActivityExpanded: (threadId, messageId, expanded) =>
		set((state) => {
			const current = state.runsByThread[threadId];
			if (!current) return state;
			if (current.activityExpandedByMessageId[messageId] === expanded) {
				return state;
			}
			return {
				runsByThread: {
					...state.runsByThread,
					[threadId]: {
						...current,
						activityExpandedByMessageId: {
							...current.activityExpandedByMessageId,
							[messageId]: expanded,
						},
					},
				},
			};
		}),
}));

const NO_THREAD_ID = "";

/**
 * The run slice for a thread, with `startingByScope[scopeKey]` folded into
 * `isSending` so a composer is disabled during thread creation too. Returns a
 * stable idle slice when the thread has no run yet (or no thread exists).
 *
 * Both selectors return primitives/stable references, so no `useShallow`.
 */
export function useAiRunState(
	threadId: string | null | undefined,
	scopeKey: string | null | undefined,
): AiRunState {
	const run = useAiRunStore((s) =>
		threadId ? s.runsByThread[threadId] : undefined,
	);
	const starting = useAiRunStore((s) =>
		scopeKey ? Boolean(s.startingByScope[scopeKey]) : false,
	);
	return useMemo(() => {
		const base =
			run ?? createInitialAiRunState(threadId ?? NO_THREAD_ID, scopeKey ?? "");
		if (!starting || base.isSending) return base;
		return { ...base, isSending: true };
	}, [run, starting, threadId, scopeKey]);
}

/** Non-React read for the controller: is anything in flight for the thread? */
export function isAiThreadBusy(threadId: string): boolean {
	return Boolean(useAiRunStore.getState().runsByThread[threadId]?.isSending);
}
