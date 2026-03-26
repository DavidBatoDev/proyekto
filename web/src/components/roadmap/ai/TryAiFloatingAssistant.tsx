import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Loader2, Minimize2, Send, Sparkles, TriangleAlert } from "lucide-react";
import roadmapAgentService, {
  type AgentPreviewPayload,
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
  preview?: AgentPreviewPayload,
): RoadmapAiChatMessage => ({
  id: crypto.randomUUID(),
  role: "assistant",
  content,
  timestamp: new Date().toISOString(),
  parseMode,
  preview,
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
    setIsOpen,
    setSessionId,
    appendMessage,
    setLatestPreview,
  } = useRoadmapAiAssistantSession(roadmapId);

  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
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
  }, [messages.length, isSending]);

  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

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
      let activeSessionId = sessionId;

      if (!activeSessionId) {
        const session = await roadmapAgentService.createSession({
          roadmap_id: roadmapId,
          base_revision: baseRevision,
        });
        activeSessionId = session.session_id;
        setSessionId(activeSessionId);
      }

      const messageResponse = await roadmapAgentService.sendMessage(
        activeSessionId,
        {
          message: trimmedMessage,
        },
      );

      const previewResponse = await roadmapAgentService.previewSession(
        activeSessionId,
        {
          base_revision: baseRevision,
        },
      );

      setLatestPreview(previewResponse.preview);

      appendMessage(
        buildAssistantMessage(
          messageResponse.assistant_message,
          messageResponse.parse_mode,
          previewResponse.preview,
        ),
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
                Preview-only mode. Commits are disabled in this phase.
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
                <p className="text-sm text-gray-700 font-medium">Start with a roadmap instruction</p>
                <p className="text-xs text-gray-500 mt-1">
                  Example: "Move feature 123 under epic 456 and mark task 789 done".
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
                Thinking and building preview...
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

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Ask AI to edit your roadmap..."
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

