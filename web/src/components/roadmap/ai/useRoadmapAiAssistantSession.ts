import { useEffect, useMemo, useState } from "react";
import type { RoadmapArtifactPreview } from "@/types/roadmapArtifact";

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
  nodeType: "roadmap" | "epic" | "feature" | "task";
  title?: string;
  kind: RoadmapAiCommitImpactedItemKind;
  changeType?: string;
}

export interface RoadmapAiCommitLifecycle {
  state: RoadmapAiCommitLifecycleState;
  impactedItems: RoadmapAiCommitImpactedItem[];
  updatedAt: string;
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
  responseMode?: "chat" | "edit_plan";
  artifacts?: RoadmapArtifactPreview[];
  attachments?: RoadmapAiChatAttachment[];
  activityTimeline?: RoadmapAiActivityTimeline;
  commitLifecycle?: RoadmapAiCommitLifecycle;
}

interface RoadmapAiAssistantPersistedState {
  isOpen: boolean;
  messages: RoadmapAiChatMessage[];
}

interface UseRoadmapAiAssistantSessionResult {
  isOpen: boolean;
  messages: RoadmapAiChatMessage[];
  setIsOpen: (value: boolean) => void;
  appendMessage: (message: RoadmapAiChatMessage) => void;
  updateMessage: (
    messageId: string,
    updater: (message: RoadmapAiChatMessage) => RoadmapAiChatMessage,
  ) => void;
  clearMessages: () => void;
}

const STORAGE_PREFIX = "roadmap.ai.assistant.v1";

const DEFAULT_STATE: RoadmapAiAssistantPersistedState = {
  isOpen: false,
  messages: [],
};

const parseStoredState = (
  rawValue: string | null,
): RoadmapAiAssistantPersistedState => {
  if (!rawValue) return DEFAULT_STATE;
  try {
    const parsed = JSON.parse(
      rawValue,
    ) as Partial<RoadmapAiAssistantPersistedState>;
    return {
      isOpen: Boolean(parsed.isOpen),
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    };
  } catch {
    return DEFAULT_STATE;
  }
};

export function useRoadmapAiAssistantSession(
  roadmapId: string,
): UseRoadmapAiAssistantSessionResult {
  const storageKey = useMemo(
    () => `${STORAGE_PREFIX}:${roadmapId}`,
    [roadmapId],
  );

  const [state, setState] = useState<RoadmapAiAssistantPersistedState>(() => {
    if (typeof window === "undefined") return DEFAULT_STATE;
    return parseStoredState(window.sessionStorage.getItem(storageKey));
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    setState(parseStoredState(window.sessionStorage.getItem(storageKey)));
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(storageKey, JSON.stringify(state));
  }, [storageKey, state]);

  return {
    isOpen: state.isOpen,
    messages: state.messages,
    setIsOpen: (value) => {
      setState((prev) => ({ ...prev, isOpen: value }));
    },
    appendMessage: (message) => {
      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, message],
      }));
    },
    updateMessage: (messageId, updater) => {
      setState((prev) => ({
        ...prev,
        messages: prev.messages.map((message) =>
          message.id === messageId ? updater(message) : message,
        ),
      }));
    },
    clearMessages: () => {
      setState((prev) => ({
        ...prev,
        messages: [],
      }));
    },
  };
}
