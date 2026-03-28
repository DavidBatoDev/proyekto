import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Boxes, Minimize2, Send, Sparkles, TriangleAlert } from "lucide-react";
import { useRoadmapStore } from "@/stores/roadmapStore";
import type { Roadmap, RoadmapEpic } from "@/types/roadmap";
import type { ArtifactSemanticDiffSummary, RoadmapArtifactPreview } from "@/types/roadmapArtifact";
import roadmapAgentService, {
  type AgentMessageResponse,
  type AgentPreviewPayload,
  type AgentRoadmapPreviewArtifact,
} from "@/services/roadmap-agent.service";
import { useRoadmapAiAssistantSession, type RoadmapAiChatMessage } from "./useRoadmapAiAssistantSession";

interface TryAiFloatingAssistantProps {
  roadmapId: string;
  baseRevision?: number;
  roadmapSnapshot?: Roadmap | null;
  epicsSnapshot?: RoadmapEpic[];
  bottomOffsetPx?: number;
  rightOffsetPx?: number;
  onOpenChange?: (isOpen: boolean) => void;
}

const DEFAULT_DIFF_SUMMARY: ArtifactSemanticDiffSummary = {
  node_added: 0,
  node_removed: 0,
  node_moved: 0,
  status_changed: 0,
  date_changed: 0,
  dependency_changed: 0,
};

const buildAssistantMessage = (
  content: string,
  parseMode: string,
  options?: {
    intentType?: "smalltalk" | "question" | "roadmap_edit" | "unclear";
    responseMode?: "chat" | "edit_plan";
    artifacts?: RoadmapArtifactPreview[];
  },
): RoadmapAiChatMessage => ({
  id: crypto.randomUUID(),
  role: "assistant",
  content,
  timestamp: new Date().toISOString(),
  parseMode,
  intentType: options?.intentType,
  responseMode: options?.responseMode,
  artifacts: options?.artifacts,
});

const toDiffSummary = (summary: Record<string, number> | undefined): ArtifactSemanticDiffSummary => ({
  node_added: Number(summary?.node_added ?? 0),
  node_removed: Number(summary?.node_removed ?? 0),
  node_moved: Number(summary?.node_moved ?? 0),
  status_changed: Number(summary?.status_changed ?? 0),
  date_changed: Number(summary?.date_changed ?? 0),
  dependency_changed: Number(summary?.dependency_changed ?? 0),
});

const resolveCandidateSnapshot = (
  candidateSnapshot: Record<string, unknown> | undefined,
  fallbackRoadmap: Roadmap | null,
): Roadmap => {
  if (candidateSnapshot && typeof candidateSnapshot === "object") {
    return candidateSnapshot as unknown as Roadmap;
  }
  if (fallbackRoadmap) return fallbackRoadmap;
  throw new Error("Artifact preview is missing candidate roadmap snapshot.");
};

const mapPreviewToArtifact = (
  roadmapId: string,
  payload: AgentPreviewPayload,
  metadata?: AgentRoadmapPreviewArtifact,
  fallbackRoadmap?: Roadmap | null,
): RoadmapArtifactPreview => {
  return {
    artifactId: metadata?.artifact_id || payload.preview_id,
    title: metadata?.title || "AI Artifact Preview",
    summary: metadata?.summary || "Generated preview from AI operations.",
    createdAt: metadata?.created_at || new Date().toISOString(),
    baseRoadmapId: roadmapId,
    baseRevision: metadata?.base_revision,
    candidateSnapshot: resolveCandidateSnapshot(payload.candidate_snapshot, fallbackRoadmap || null),
    semanticDiffSummary: toDiffSummary(payload.semantic_diff?.summary),
    validationIssues: (payload.validation_issues || []).map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      path: issue.path,
      message: issue.message,
    })),
    status: "draft",
  };
};

export function TryAiFloatingAssistant({
  roadmapId,
  baseRevision,
  roadmapSnapshot,
  bottomOffsetPx = 20,
  rightOffsetPx = 20,
  onOpenChange,
}: TryAiFloatingAssistantProps) {
  const { isOpen, messages, setIsOpen, appendMessage } = useRoadmapAiAssistantSession(roadmapId);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const roadmapFromStore = useRoadmapStore((state) => state.roadmap);
  const openArtifactTab = useRoadmapStore((state) => state.openArtifactTab);
  const currentRoadmap = roadmapSnapshot ?? roadmapFromStore ?? null;

  const messageCountLabel = useMemo(() => {
    const count = messages.length;
    if (!count) return "New";
    if (count > 99) return "99+";
    return `${count}`;
  }, [messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, isSending]);

  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  const ensureSession = async (): Promise<string> => {
    if (sessionId) return sessionId;
    const created = await roadmapAgentService.createSession({
      roadmap_id: roadmapId,
      base_revision: baseRevision,
    });
    setSessionId(created.session_id);
    return created.session_id;
  };

  const hydrateArtifacts = async (
    activeSessionId: string,
    response: AgentMessageResponse,
  ): Promise<RoadmapArtifactPreview[]> => {
    const hydrated: RoadmapArtifactPreview[] = [];

    for (const artifactMeta of response.artifacts || []) {
      const artifactDetail = await roadmapAgentService.getArtifactPreview(
        activeSessionId,
        artifactMeta.artifact_id,
      );
      hydrated.push(
        mapPreviewToArtifact(
          roadmapId,
          artifactDetail.preview,
          artifactDetail.artifact,
          currentRoadmap,
        ),
      );
    }

    if (hydrated.length === 0 && response.response_mode === "edit_plan" && response.preview_available) {
      const previewResponse = await roadmapAgentService.previewSession(activeSessionId, {
        base_revision: baseRevision,
      });
      hydrated.push(mapPreviewToArtifact(roadmapId, previewResponse.preview, undefined, currentRoadmap));
    }

    return hydrated;
  };

  const handleSend = async () => {
    const trimmedMessage = input.trim();
    if (!trimmedMessage || isSending) return;

    setInput("");
    setErrorMessage(null);
    appendMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: trimmedMessage,
      timestamp: new Date().toISOString(),
    });

    setIsSending(true);
    try {
      const activeSessionId = await ensureSession();
      const response = await roadmapAgentService.sendMessage(activeSessionId, {
        message: trimmedMessage,
        auto_preview: true,
      });

      const artifacts = await hydrateArtifacts(activeSessionId, response);
      appendMessage(
        buildAssistantMessage(
          response.assistant_message || "I analyzed your request.",
          response.parse_mode || "agent_response",
          {
            intentType: response.intent_type,
            responseMode: response.response_mode,
            artifacts,
          },
        ),
      );
    } catch (error) {
      const readableError = error instanceof Error ? error.message : "Failed to reach AI agent service.";
      setErrorMessage(readableError);
      appendMessage(
        buildAssistantMessage(
          "I couldn't complete that request. Please try again.",
          "agent_error",
        ),
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleOpenArtifact = (artifact: RoadmapArtifactPreview) => {
    openArtifactTab(artifact);
    appendMessage(
      buildAssistantMessage(`Opened ${artifact.title} in Artifact tab.`, "artifact_opened"),
    );
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  return (
    <>
      {isOpen && (
        <section
          className="fixed z-[90] w-[380px] max-w-[calc(100vw-24px)] h-[540px] bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
          style={{ bottom: bottomOffsetPx, right: rightOffsetPx }}
          aria-label="AI Assistant Panel"
        >
          <header className="px-4 py-3 border-b border-gray-200 bg-white flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#ff9933]" />
                Try AI Assistant
              </p>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Connected to roadmap agent API
              </p>
            </div>
            <button
              type="button"
              className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100"
              title="Minimize AI assistant"
              onClick={() => setIsOpen(false)}
            >
              <Minimize2 className="w-4 h-4" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-gray-50/40">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-4">
                <Bot className="w-8 h-8 text-gray-400 mb-2" />
                <p className="text-sm text-gray-700 font-medium">
                  Ask questions or request roadmap edits
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Example: "add an epic for onboarding improvements"
                </p>
              </div>
            ) : (
              messages.map((message) => {
                const artifacts = message.artifacts ?? [];
                return (
                  <article
                    key={message.id}
                    className={`rounded-xl px-3 py-2.5 border ${
                      message.role === "user"
                        ? "bg-white border-orange-200 ml-8"
                        : "bg-white border-gray-200 mr-4"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span
                        className={`text-[11px] font-semibold ${
                          message.role === "user" ? "text-orange-600" : "text-gray-700"
                        }`}
                      >
                        {message.role === "user" ? "You" : "Assistant"}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {new Date(message.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="text-xs text-gray-800 whitespace-pre-wrap leading-relaxed">
                      {message.content}
                    </p>

                    {artifacts.length > 0 && (
                      <div className="mt-2.5 space-y-2">
                        {artifacts.map((artifact) => (
                          <div
                            key={artifact.artifactId}
                            className="rounded-lg border border-orange-200 bg-orange-50/60 p-2.5"
                          >
                            <p className="text-[11px] font-semibold text-orange-700">
                              {artifact.title}
                            </p>
                            <p className="text-[10px] text-orange-700/90 mt-0.5">
                              {artifact.summary}
                            </p>
                            <div className="mt-1.5 text-[10px] text-orange-800/90">
                              Validation issues: {artifact.validationIssues.length}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleOpenArtifact(artifact)}
                              className="mt-2 h-7 px-2.5 rounded-md border border-orange-300 bg-white text-[10px] font-semibold text-orange-700 hover:bg-orange-100 inline-flex items-center gap-1.5"
                            >
                              <Boxes className="w-3.5 h-3.5" />
                              Open Artifact Tab
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })
            )}

            {isSending && (
              <div className="rounded-xl px-3 py-2.5 border border-gray-200 bg-white mr-4 text-xs text-gray-600">
                Thinking...
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <footer className="border-t border-gray-200 bg-white px-3 py-3">
            {errorMessage && (
              <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-700 flex items-start gap-1.5">
                <TriangleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[10px] text-gray-500">
                Agent endpoint: {import.meta.env.VITE_AGENT_API_URL || "http://localhost:8010"}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Chat or request roadmap edits..."
                className="flex-1 h-10 rounded-xl border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-300"
                disabled={isSending}
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={isSending || !input.trim()}
                className="h-10 w-10 rounded-xl bg-[#ff9933] text-white inline-flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#ff880f] transition-colors"
                title="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </footer>
        </section>
      )}

      {!isOpen && (
        <button
          type="button"
          className="fixed z-[90] inline-flex items-center gap-2 rounded-full bg-[#ff9933] text-white px-4 py-2.5 shadow-lg hover:bg-[#ff880f] transition-colors"
          style={{ bottom: bottomOffsetPx, right: rightOffsetPx }}
          onClick={() => setIsOpen(true)}
          aria-label="Open AI assistant"
        >
          <Sparkles className="w-4 h-4" />
          <span className="text-sm font-semibold">Try AI</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/20">
            {messageCountLabel}
          </span>
        </button>
      )}
    </>
  );
}
