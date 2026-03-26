import { useEffect, useMemo, useState } from "react";
import type { AgentPreviewPayload } from "@/services/roadmap-agent.service";

export type RoadmapAiChatRole = "user" | "assistant";

export interface RoadmapAiChatMessage {
  id: string;
  role: RoadmapAiChatRole;
  content: string;
  timestamp: string;
  parseMode?: string;
  intentType?: "smalltalk" | "question" | "roadmap_edit" | "unclear";
  responseMode?: "chat" | "edit_plan";
  preview?: AgentPreviewPayload;
}

interface RoadmapAiAssistantPersistedState {
  isOpen: boolean;
  sessionId: string | null;
  messages: RoadmapAiChatMessage[];
  latestPreview: AgentPreviewPayload | null;
  previewAvailable: boolean;
  previewRecommended: boolean;
  stagedOperationsVersion: number;
}

interface UseRoadmapAiAssistantSessionResult {
  isOpen: boolean;
  sessionId: string | null;
  messages: RoadmapAiChatMessage[];
  latestPreview: AgentPreviewPayload | null;
  previewAvailable: boolean;
  previewRecommended: boolean;
  stagedOperationsVersion: number;
  setIsOpen: (value: boolean) => void;
  setSessionId: (value: string | null) => void;
  setLatestPreview: (value: AgentPreviewPayload | null) => void;
  setPreviewState: (value: {
    previewAvailable: boolean;
    previewRecommended: boolean;
    stagedOperationsVersion: number;
  }) => void;
  appendMessage: (message: RoadmapAiChatMessage) => void;
  clearMessages: () => void;
}

const STORAGE_PREFIX = "roadmap.ai.assistant.v1";

const DEFAULT_STATE: RoadmapAiAssistantPersistedState = {
  isOpen: false,
  sessionId: null,
  messages: [],
  latestPreview: null,
  previewAvailable: false,
  previewRecommended: false,
  stagedOperationsVersion: 0,
};

const parseStoredState = (
  rawValue: string | null,
): RoadmapAiAssistantPersistedState => {
  if (!rawValue) return DEFAULT_STATE;
  try {
    const parsed = JSON.parse(rawValue) as Partial<RoadmapAiAssistantPersistedState>;
    return {
      isOpen: Boolean(parsed.isOpen),
      sessionId:
        typeof parsed.sessionId === "string" && parsed.sessionId.length > 0
          ? parsed.sessionId
          : null,
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      latestPreview: parsed.latestPreview ?? null,
      previewAvailable: Boolean(parsed.previewAvailable),
      previewRecommended: Boolean(parsed.previewRecommended),
      stagedOperationsVersion:
        typeof parsed.stagedOperationsVersion === "number"
          ? parsed.stagedOperationsVersion
          : 0,
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
    sessionId: state.sessionId,
    messages: state.messages,
    latestPreview: state.latestPreview,
    previewAvailable: state.previewAvailable,
    previewRecommended: state.previewRecommended,
    stagedOperationsVersion: state.stagedOperationsVersion,
    setIsOpen: (value) => {
      setState((prev) => ({ ...prev, isOpen: value }));
    },
    setSessionId: (value) => {
      setState((prev) => ({ ...prev, sessionId: value }));
    },
    setLatestPreview: (value) => {
      setState((prev) => ({ ...prev, latestPreview: value }));
    },
    setPreviewState: (value) => {
      setState((prev) => ({
        ...prev,
        previewAvailable: value.previewAvailable,
        previewRecommended: value.previewRecommended,
        stagedOperationsVersion: value.stagedOperationsVersion,
      }));
    },
    appendMessage: (message) => {
      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, message],
      }));
    },
    clearMessages: () => {
      setState((prev) => ({
        ...prev,
        messages: [],
        latestPreview: null,
        previewAvailable: false,
        previewRecommended: false,
        stagedOperationsVersion: 0,
      }));
    },
  };
}
