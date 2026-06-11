import { useCallback, useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import roadmapAgentService from "@/services/roadmap-agent.service";
import {
  RoadmapAiSessionsServiceError,
  roadmapAiSessionsService,
  type AppendRoadmapAiMessagePayload,
  type RoadmapAiMessage,
} from "@/services/roadmap-ai-sessions.service";
import { useRoadmapAiThreadsStore } from "@/stores/roadmapAiThreadsStore";

// =============================================================================
// Public types (unchanged shape — imported by the panel, activity timeline
// renderer, and tool-messaging helpers).
// =============================================================================

export type RoadmapAiChatRole = "user" | "assistant";

export interface RoadmapAiChatAttachment {
  id: string;
  name: string;
  size: number;
  type?: string;
}

export type RoadmapAiActivityStepStatus = "running" | "success" | "error";
export type RoadmapAiActivityDetailMode = "verbose" | "structured";
export type RoadmapAiActivityPresentationMode = "curated" | "friendly_minimal";

export interface RoadmapAiActivityStepTitleList {
  items: string[];
  shownCount: number;
  totalCount: number;
  hasMore: boolean;
}

export interface RoadmapAiActivityStep {
  seq: number;
  ts: string;
  event: string;
  title: string;
  status: RoadmapAiActivityStepStatus;
  summary: string;
  details?: Record<string, unknown>;
  titleList?: RoadmapAiActivityStepTitleList;
}

export interface RoadmapAiActivityTimeline {
  traceId: string;
  startedAt?: string;
  completedAt?: string;
  elapsedMs?: number;
  done: boolean;
  detailMode: RoadmapAiActivityDetailMode;
  presentationMode?: RoadmapAiActivityPresentationMode;
  steps: RoadmapAiActivityStep[];
}

export type RoadmapAiCommitLifecycleState =
  | "committing"
  | "committed"
  | "failed";

export type RoadmapAiCommitImpactedItemKind =
  | "created"
  | "modified"
  | "deleted";

export interface RoadmapAiCommitImpactedItem {
  nodeId: string;
  nodeType: "roadmap" | "epic" | "feature" | "task" | "milestone";
  title?: string;
  kind: RoadmapAiCommitImpactedItemKind;
  changeType?: string;
}

export interface RoadmapAiCommitLifecycle {
  state: RoadmapAiCommitLifecycleState;
  impactedItems: RoadmapAiCommitImpactedItem[];
  updatedAt: string;
  /** Why the commit failed (state === "failed"); shown under the status row. */
  errorMessage?: string;
}

export interface RoadmapAiChatMessage {
  id: string;
  role: RoadmapAiChatRole;
  content: string;
  timestamp: string;
  parseMode?: string;
  intentType?:
    | "smalltalk"
    | "general_question"
    | "roadmap_query"
    | "roadmap_plan"
    | "roadmap_edit"
    | "confirm_action"
    | "question"
    | "unclear";
  responseMode?: "chat" | "edit_plan" | "plan_proposal";
  planProposal?: import("@/services/roadmap-agent.service").AgentPlanProposal;
  clarifier?: import("@/services/roadmap-agent.service").AgentClarifierCard;
  attachments?: RoadmapAiChatAttachment[];
  activityTimeline?: RoadmapAiActivityTimeline;
  commitLifecycle?: RoadmapAiCommitLifecycle;
}

// =============================================================================
// In-memory message store (Zustand). This is working state for the panel —
// the DB is the source of truth. On thread switch we hydrate from backend and
// seed this store; all live appendMessage/updateMessage calls operate here so
// the panel's stateful UX (live activity trace, optimistic artifacts, commit
// lifecycle) keeps working without touching the network.
// =============================================================================

interface ThreadMessagesState {
  messagesByThread: Record<string, RoadmapAiChatMessage[]>;
  hydratedThreads: Record<string, boolean>;
  setThreadMessages: (
    threadId: string,
    messages: RoadmapAiChatMessage[],
  ) => void;
  markHydrated: (threadId: string) => void;
  clearThread: (threadId: string) => void;
  appendToThread: (threadId: string, message: RoadmapAiChatMessage) => void;
  updateInThread: (
    threadId: string,
    messageId: string,
    updater: (message: RoadmapAiChatMessage) => RoadmapAiChatMessage,
  ) => void;
}

const useThreadMessagesStore = create<ThreadMessagesState>((set) => ({
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

// Map a persisted DB row back to the rich client message shape. Client-only
// fields (activity timeline, attachments, inline roadmap artifact objects)
// don't round-trip — they're ephemeral UI state; the DB keeps the commit
// lifecycle + artifact metadata so past threads still look complete.
function dbRowToClientMessage(row: RoadmapAiMessage): RoadmapAiChatMessage {
  const base: RoadmapAiChatMessage = {
    id: row.id,
    role: row.role === "system" ? "assistant" : row.role,
    content: row.content,
    timestamp: row.created_at,
    parseMode: row.parse_mode ?? undefined,
    intentType: (row.intent_type ??
      undefined) as RoadmapAiChatMessage["intentType"],
    responseMode: (row.response_mode ??
      undefined) as RoadmapAiChatMessage["responseMode"],
  };
  if (row.activity_timeline && typeof row.activity_timeline === "object") {
    base.activityTimeline =
      row.activity_timeline as unknown as RoadmapAiActivityTimeline;
  }
  if (row.commit_lifecycle && typeof row.commit_lifecycle === "object") {
    base.commitLifecycle =
      row.commit_lifecycle as unknown as RoadmapAiCommitLifecycle;
  }
  const metadataPlan = (row.metadata as Record<string, unknown> | null)?.plan_proposal;
  if (metadataPlan && typeof metadataPlan === "object") {
    base.planProposal = metadataPlan as RoadmapAiChatMessage["planProposal"];
  }
  const metadataClarifier = (row.metadata as Record<string, unknown> | null)?.clarifier;
  if (metadataClarifier && typeof metadataClarifier === "object") {
    base.clarifier = metadataClarifier as RoadmapAiChatMessage["clarifier"];
  }
  return base;
}

// =============================================================================
// Hook
// =============================================================================

export interface UseRoadmapAiAssistantSessionResult {
  messages: RoadmapAiChatMessage[];
  isLoading: boolean;
  appendMessage: (message: RoadmapAiChatMessage) => void;
  updateMessage: (
    messageId: string,
    updater: (message: RoadmapAiChatMessage) => RoadmapAiChatMessage,
  ) => void;
  clearMessages: () => void;
  // Called after creating a brand-new thread so the hydration effect skips
  // the DB fetch (the DB is empty for a new row). Without this, the effect
  // fires after `setActiveThread`, fetches `[]`, and overwrites the user's
  // freshly-appended first message.
  markThreadHydrated: (threadId: string) => void;
  // Persist a completed turn to the backend. Returns the seed_messages the
  // agent should fall back on if its Redis session has expired.
  persistTurn: (
    role: "user" | "assistant",
    content: string,
    extras?: {
      intentType?: string;
      responseMode?: "chat" | "edit_plan" | "plan_proposal";
      parseMode?: string;
      activityTimeline?: Record<string, unknown>;
      commitLifecycle?: Record<string, unknown>;
      tokens?: number;
      metadata?: Record<string, unknown>;
    },
  ) => Promise<{ seed_messages: Array<{ role: string; content: string }> }>;
  // On Redis-miss (agent sendMessage returns 404), replay the given
  // seed_messages into the agent's session so the next send succeeds.
  rehydrateAgentSession: (
    seedMessages: Array<{ role: string; content: string }>,
    options: { roadmapId: string; baseRevision?: number },
  ) => Promise<void>;
}

export function useRoadmapAiAssistantSession(
  roadmapId: string,
  threadId: string | null,
): UseRoadmapAiAssistantSessionResult {
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
  const setActiveThreadInStore = useRoadmapAiThreadsStore(
    (s) => s.setActiveThread,
  );
  const clearDraftInput = useRoadmapAiThreadsStore((s) => s.clearDraftInput);

  // Resolve the current thread id at call time. The prop reflects the last
  // committed render, but the panel's first-message flow calls `setActiveThread`
  // (zustand, synchronous) and then immediately calls `appendMessage` /
  // `persistTurn` — before React has had a chance to re-render this hook with
  // the new threadId. Without this fallback, those writes silently drop
  // because the closed-over `threadId` is still null, which surfaces as the
  // user's message and the AI response both disappearing on the first turn
  // in a brand-new thread.
  const resolveThreadId = useCallback((): string | null => {
    if (threadId) return threadId;
    return (
      useRoadmapAiThreadsStore.getState().activeThreadIdByRoadmap[roadmapId] ??
      null
    );
  }, [threadId, roadmapId]);

  useEffect(() => {
    if (!threadId || !roadmapId) return;
    if (hydrated) return;
    if (loadingRef.current) return;

    // If messages were already written to this thread's in-memory slot (e.g.
    // handleSend called appendMessage before this effect fired for a freshly
    // created thread), skip the DB fetch — the DB is empty for a brand-new
    // session and fetching would overwrite the optimistic user message with [].
    // On a real page reload the in-memory store is reset, so this guard is a
    // no-op and normal hydration proceeds.
    const preloaded = useThreadMessagesStore.getState().messagesByThread[threadId];
    if (preloaded && preloaded.length > 0) {
      markHydrated(threadId);
      return;
    }

    loadingRef.current = true;
    (async () => {
      try {
        const rows = await roadmapAiSessionsService.listMessages(
          roadmapId,
          threadId,
          { limit: 100 },
        );
        const clientMessages = rows.map(dbRowToClientMessage);
        setThreadMessages(threadId, clientMessages);
        markHydrated(threadId);
      } catch (err) {
        // Stale `activeThreadId` persisted in localStorage can point at a DB
        // row the user doesn't own (or that never made it to the DB due to
        // an earlier failure). Drop it silently so the panel auto-selects a
        // real thread or creates a new one on first message.
        if (
          err instanceof RoadmapAiSessionsServiceError &&
          err.statusCode === 404
        ) {
          console.debug(
            "[useRoadmapAiAssistantSession] stale activeThreadId — clearing",
            { roadmapId, threadId },
          );
          // Mark hydrated so a remounted component (e.g. HMR) doesn't
          // re-fire this effect before setActiveThreadInStore propagates.
          markHydrated(threadId);
          clearDraftInput(threadId);
          setActiveThreadInStore(roadmapId, null);
        } else {
          console.error(
            "[useRoadmapAiAssistantSession] failed to hydrate thread",
            err,
          );
        }
      } finally {
        loadingRef.current = false;
      }
    })();
  }, [
    roadmapId,
    threadId,
    hydrated,
    setThreadMessages,
    markHydrated,
    setActiveThreadInStore,
    clearDraftInput,
  ]);

  const appendMessage = useCallback(
    (message: RoadmapAiChatMessage) => {
      const tid = resolveThreadId();
      if (!tid) return;
      appendToThread(tid, message);
    },
    [resolveThreadId, appendToThread],
  );

  const updateMessage = useCallback(
    (
      messageId: string,
      updater: (message: RoadmapAiChatMessage) => RoadmapAiChatMessage,
    ) => {
      const tid = resolveThreadId();
      if (!tid) return;
      updateInThread(tid, messageId, updater);
    },
    [resolveThreadId, updateInThread],
  );

  const clearMessages = useCallback(() => {
    const tid = resolveThreadId();
    if (!tid) return;
    clearThread(tid);
  }, [resolveThreadId, clearThread]);

  const persistTurn = useCallback<
    UseRoadmapAiAssistantSessionResult["persistTurn"]
  >(
    async (role, content, extras) => {
      const tid = resolveThreadId();
      if (!tid || !roadmapId) {
        return { seed_messages: [] };
      }
      const payload: AppendRoadmapAiMessagePayload = {
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
      const result = await roadmapAiSessionsService.appendMessage(
        roadmapId,
        tid,
        payload,
      );
      return { seed_messages: result.seed_messages };
    },
    [roadmapId, resolveThreadId],
  );

  const rehydrateAgentSession = useCallback<
    UseRoadmapAiAssistantSessionResult["rehydrateAgentSession"]
  >(
    async (seedMessages, options) => {
      const tid = resolveThreadId();
      if (!tid) return;
      await roadmapAgentService.createSession({
        session_id: tid,
        roadmap_id: options.roadmapId,
        base_revision: options.baseRevision,
        seed_messages: seedMessages,
      });
    },
    [resolveThreadId],
  );

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

const EMPTY_MESSAGES: RoadmapAiChatMessage[] = [];
