import { useCallback, useEffect, useMemo, useRef } from "react";
import { type AiRunState, useAiRunState } from "@/stores/aiRunStore";
import { useUser } from "@/stores/authStore";
import { aiRunController, type RunHooks } from "./runController";
import { type AiSessionScope, aiScopeKey } from "./scope";
import type { AiMentionSpan } from "./types";
import type { UseAiThreadMessagesResult } from "./useAiThreadMessages";
import type { UseAiThreadsResult } from "./useAiThreads";

// =============================================================================
// Thin binding between a thread and the singleton run controller: the run
// slice for the active thread, `send` / `cancel` / `resume` dispatchers, and
// the realtime push subscription for the signed-in user (guests poll only).
// =============================================================================

export interface UseAiAssistantRunInput {
	scope: AiSessionScope | null;
	threadId: string | null;
	ensureThread: UseAiThreadsResult["ensureThread"];
	ensureAgentSession: UseAiThreadsResult["ensureAgentSession"];
	persistTurn: UseAiThreadMessagesResult["persistTurn"];
	rehydrateAgentSession: UseAiThreadMessagesResult["rehydrateAgentSession"];
	baseRevision?: number;
	onCommits?: RunHooks["onCommits"];
	onTraceEvents?: RunHooks["onTraceEvents"];
}

export interface AiSendRequest {
	/** Bubble + DB text for sentinel sends. */
	displayLabel?: string;
	refs?: AiMentionSpan[];
}

export interface UseAiAssistantRunResult {
	run: AiRunState;
	send: (content: string, options?: AiSendRequest) => Promise<void>;
	cancel: () => void;
	resume: () => void;
}

export function useAiAssistantRun(
	input: UseAiAssistantRunInput,
): UseAiAssistantRunResult {
	const { scope, threadId } = input;
	const scopeKey = scope ? aiScopeKey(scope) : null;
	const run = useAiRunState(threadId, scopeKey);
	const user = useUser();
	const userId = user?.id ?? null;

	// Guarded inside the controller (flag, transport, guest); refcounted so the
	// dashboard's two mounts share one socket and StrictMode double effects
	// are harmless.
	useEffect(() => aiRunController.attachPush(userId), [userId]);

	// The controller captures these once per run; read the latest at call time.
	const latest = useRef(input);
	latest.current = input;

	const send = useCallback(
		async (content: string, options: AiSendRequest = {}) => {
			const current = latest.current;
			if (!current.scope) return;
			await aiRunController.send({
				scope: current.scope,
				threadId: current.threadId,
				ensureThread: current.ensureThread,
				content,
				displayLabel: options.displayLabel,
				refs: options.refs ?? [],
				baseRevision: current.baseRevision,
				persist: {
					persistTurn: current.persistTurn,
					rehydrateAgentSession: current.rehydrateAgentSession,
					ensureAgentSession: current.ensureAgentSession,
				},
				hooks: {
					onCommits: current.onCommits,
					onTraceEvents: current.onTraceEvents,
				},
			});
		},
		[],
	);

	const cancel = useCallback(() => {
		const current = latest.current.threadId;
		if (!current) return;
		void aiRunController.cancel(current);
	}, []);

	const resume = useCallback(() => {
		const current = latest.current.threadId;
		if (!current) return;
		void aiRunController.resume(current);
	}, []);

	return useMemo(
		() => ({ run, send, cancel, resume }),
		[run, send, cancel, resume],
	);
}
