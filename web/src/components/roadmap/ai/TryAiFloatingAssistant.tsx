import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  FileSearch,
  Loader2,
  Minimize2,
  Send,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import roadmapAgentService, {
  type AgentRoadmapPreviewArtifact,
  type AgentPreviewPayload,
  RoadmapAgentServiceError,
} from "@/services/roadmap-agent.service";
import {
  useRoadmapAiAssistantSession,
  type RoadmapAiChatMessage,
} from "./useRoadmapAiAssistantSession";

interface TryAiFloatingAssistantProps {
  roadmapId: string;
  baseRevision?: number;
  bottomOffsetPx?: number;
  rightOffsetPx?: number;
  onOpenChange?: (isOpen: boolean) => void;
}

const formatPreviewKey = (key: string) =>
  key
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const buildAssistantMessage = (
  content: string,
  parseMode: string,
  options?: {
    intentType?: "smalltalk" | "question" | "roadmap_edit" | "unclear";
    responseMode?: "chat" | "edit_plan";
    artifacts?: AgentRoadmapPreviewArtifact[];
    preview?: AgentPreviewPayload;
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
  preview: options?.preview,
});

export function TryAiFloatingAssistant({
  roadmapId,
  baseRevision,
  bottomOffsetPx = 20,
  rightOffsetPx = 20,
  onOpenChange,
}: TryAiFloatingAssistantProps) {
  const {
    isOpen,
    sessionId,
    messages,
    previewAvailable,
    previewRecommended,
    stagedOperationsVersion,
    setIsOpen,
    setSessionId,
    appendMessage,
    setLatestPreview,
    setPreviewState,
  } = useRoadmapAiAssistantSession(roadmapId);

  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const messageCountLabel = useMemo(() => {
    const count = messages.length;
    if (!count) return "New";
    if (count > 99) return "99+";
    return `${count}`;
  }, [messages.length]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, isSending, isPreviewing]);

  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  const createFreshSession = async () => {
    const session = await roadmapAgentService.createSession({
      roadmap_id: roadmapId,
      base_revision: baseRevision,
    });
    setSessionId(session.session_id);
    setPreviewState({
      previewAvailable: false,
      previewRecommended: false,
      stagedOperationsVersion: 0,
    });
    setLatestPreview(null);
    return session.session_id;
  };

  const ensureSession = async () => {
    if (sessionId) return sessionId;
    return createFreshSession();
  };

  const handleSend = async () => {
    const trimmedMessage = input.trim();
    if (!trimmedMessage || isSending || isPreviewing) return;

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
      let activeSessionId = await ensureSession();
      let messageResponse;

      try {
        messageResponse = await roadmapAgentService.sendMessage(activeSessionId, {
          message: trimmedMessage,
          auto_preview: true,
        });
      } catch (error) {
        if (
          error instanceof RoadmapAgentServiceError &&
          error.statusCode === 404
        ) {
          activeSessionId = await createFreshSession();
          messageResponse = await roadmapAgentService.sendMessage(
            activeSessionId,
            {
              message: trimmedMessage,
              auto_preview: true,
            },
          );
        } else {
          throw error;
        }
      }

      setPreviewState({
        previewAvailable: messageResponse.preview_available,
        previewRecommended: messageResponse.preview_recommended,
        stagedOperationsVersion: messageResponse.staged_operations_version,
      });

      appendMessage(
        buildAssistantMessage(messageResponse.assistant_message, messageResponse.parse_mode, {
          intentType: messageResponse.intent_type,
          responseMode: messageResponse.response_mode,
          artifacts: messageResponse.artifacts,
        }),
      );
    } catch (error) {
      const readableError =
        error instanceof Error
          ? error.message
          : "I hit a network error while contacting the AI agent.";
      setErrorMessage(readableError);

      appendMessage(
        buildAssistantMessage(
          "I couldn't complete this request. Please try again in a moment.",
          "error",
        ),
      );
    } finally {
      setIsSending(false);
    }
  };

  const handlePreview = async () => {
    if (isPreviewing || isSending) return;
    if (!sessionId || !previewAvailable) {
      setErrorMessage("No staged roadmap edits to preview yet. Ask for an edit first.");
      return;
    }

    setErrorMessage(null);
    setIsPreviewing(true);

    try {
      const previewResponse = await roadmapAgentService.previewSession(sessionId, {
        base_revision: baseRevision,
      });

      setLatestPreview(previewResponse.preview);
      appendMessage(
        buildAssistantMessage(
          "Preview is ready. Review the semantic diff and validation issues below.",
          "manual_preview",
          {
            intentType: "roadmap_edit",
            responseMode: "edit_plan",
            preview: previewResponse.preview,
          },
        ),
      );
    } catch (error) {
      if (error instanceof RoadmapAgentServiceError && error.statusCode === 404) {
        await createFreshSession();
        setErrorMessage(
          "Your AI session expired. Send the roadmap edit request again, then run Preview.",
        );
        return;
      }

      const readableError =
        error instanceof Error
          ? error.message
          : "Failed to generate preview. Please try again.";
      setErrorMessage(readableError);
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleOpenArtifact = async (artifact: AgentRoadmapPreviewArtifact) => {
    if (!sessionId) {
      setErrorMessage("Session missing. Send a message again before opening preview.");
      return;
    }
    setErrorMessage(null);
    setIsPreviewing(true);
    try {
      const artifactPreview = await roadmapAgentService.getArtifactPreview(
        sessionId,
        artifact.artifact_id,
      );
      setLatestPreview(artifactPreview.preview);
      appendMessage(
        buildAssistantMessage(
          `Opened ${artifact.title}. Review semantic diff and validation details.`,
          "artifact_preview",
          {
            intentType: "roadmap_edit",
            responseMode: "edit_plan",
            preview: artifactPreview.preview,
          },
        ),
      );
    } catch (error) {
      const readableError =
        error instanceof Error
          ? error.message
          : "Failed to open preview artifact.";
      setErrorMessage(readableError);
    } finally {
      setIsPreviewing(false);
    }
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
          style={{
            bottom: bottomOffsetPx,
            right: rightOffsetPx,
          }}
          aria-label="AI Assistant Panel"
        >
          <header className="px-4 py-3 border-b border-gray-200 bg-white flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#ff9933]" />
                Try AI Assistant
              </p>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Chat-first mode. Edit requests return preview artifacts.
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
                <p className="text-sm text-gray-700 font-medium">Chat naturally or request roadmap edits</p>
                <p className="text-xs text-gray-500 mt-1">
                  Example: "Hi" or "Move feature 123 under epic 456".
                </p>
              </div>
            ) : (
              messages.map((message) => {
                const preview = message.preview;
                const summaryEntries = Object.entries(
                  preview?.semantic_diff?.summary ?? {},
                ).filter(([, value]) => value > 0);
                const issues = preview?.validation_issues ?? [];
                const errorIssues = issues.filter(
                  (issue) => issue.severity === "error",
                ).length;
                const warningIssues = issues.filter(
                  (issue) => issue.severity === "warning",
                ).length;
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
                            key={artifact.artifact_id}
                            className="rounded-lg border border-orange-200 bg-orange-50/60 p-2.5"
                          >
                            <p className="text-[11px] font-semibold text-orange-700">
                              {artifact.title}
                            </p>
                            <p className="text-[10px] text-orange-700/90 mt-0.5">
                              {artifact.summary}
                            </p>
                            <div className="mt-1.5 text-[10px] text-orange-800/90">
                              Issues: {artifact.validation_issue_count}
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleOpenArtifact(artifact)}
                              className="mt-2 h-7 px-2.5 rounded-md border border-orange-300 bg-white text-[10px] font-semibold text-orange-700 hover:bg-orange-100"
                            >
                              Open Preview
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {preview && (
                      <div className="mt-2.5 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
                        <p className="text-[11px] font-semibold text-gray-700 mb-1.5">
                          Preview Summary
                        </p>

                        {summaryEntries.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {summaryEntries.map(([key, value]) => (
                              <span
                                key={`${message.id}-${key}`}
                                className="text-[10px] rounded-full border border-gray-300 px-2 py-0.5 text-gray-700 bg-white"
                              >
                                {formatPreviewKey(key)}: {value}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[10px] text-gray-500 mb-2">
                            No semantic changes detected.
                          </p>
                        )}

                        <div className="text-[10px] text-gray-600 flex items-center gap-2 mb-1.5">
                          <span>Errors: {errorIssues}</span>
                          <span>Warnings: {warningIssues}</span>
                        </div>

                        {issues.length > 0 && (
                          <ul className="space-y-1">
                            {issues.slice(0, 3).map((issue, index) => (
                              <li
                                key={`${message.id}-issue-${index}`}
                                className={`text-[10px] px-2 py-1 rounded border ${
                                  issue.severity === "error"
                                    ? "border-red-200 bg-red-50 text-red-700"
                                    : "border-amber-200 bg-amber-50 text-amber-700"
                                }`}
                              >
                                {issue.code}: {issue.message}
                              </li>
                            ))}
                            {issues.length > 3 && (
                              <li className="text-[10px] text-gray-500">
                                +{issues.length - 3} more issues
                              </li>
                            )}
                          </ul>
                        )}
                      </div>
                    )}
                  </article>
                );
              })
            )}

            {isSending && (
              <div className="rounded-xl px-3 py-2.5 border border-gray-200 bg-white mr-4 text-xs text-gray-600 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Thinking...
              </div>
            )}

            {isPreviewing && (
              <div className="rounded-xl px-3 py-2.5 border border-gray-200 bg-white mr-4 text-xs text-gray-600 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Generating preview...
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
              <button
                type="button"
                onClick={() => void handlePreview()}
                disabled={!sessionId || !previewAvailable || isSending || isPreviewing}
                className="h-9 px-3 rounded-xl border border-gray-300 bg-white text-xs text-gray-700 inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                title="Run roadmap preview"
              >
                <FileSearch className="w-3.5 h-3.5" />
                {isPreviewing
                  ? "Generating..."
                  : previewRecommended
                    ? "Preview Changes"
                    : "Preview"}
              </button>
              <span className="text-[10px] text-gray-500">
                {previewAvailable
                  ? `Staged edits ready (v${stagedOperationsVersion})`
                  : "No staged edits yet"}
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
                disabled={isSending || isPreviewing}
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={isSending || isPreviewing || !input.trim()}
                className="h-10 w-10 rounded-xl bg-[#ff9933] text-white inline-flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#ff880f] transition-colors"
                title="Send message"
              >
                {isSending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
          </footer>
        </section>
      )}

      {!isOpen && (
        <button
          type="button"
          className="fixed z-[90] inline-flex items-center gap-2 rounded-full bg-[#ff9933] text-white px-4 py-2.5 shadow-lg hover:bg-[#ff880f] transition-colors"
          style={{
            bottom: bottomOffsetPx,
            right: rightOffsetPx,
          }}
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
