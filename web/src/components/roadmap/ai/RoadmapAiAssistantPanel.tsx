import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Boxes,
  Check,
  Eye,
  FolderOpen,
  Paperclip,
  Send,
  TriangleAlert,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useRoadmapStore } from "@/stores/roadmapStore";
import type { Roadmap, RoadmapEpic } from "@/types/roadmap";
import type {
  ArtifactSemanticDiffChange,
  ArtifactSemanticDiffSummary,
  RoadmapArtifactPreview,
} from "@/types/roadmapArtifact";
import roadmapAgentService, {
  type AgentMessageResponse,
  type AgentPreviewPayload,
  type AgentRoadmapPreviewArtifact,
  isAgentTimeoutError,
  RoadmapAgentServiceError,
} from "@/services/roadmap-agent.service";
import {
  ArtifactSnapshotNormalizationError,
  normalizeArtifactCandidateSnapshot,
} from "@/services/roadmap-artifact-adapter";
import { useToast } from "@/hooks/useToast";
import {
  useRoadmapAiAssistantSession,
  type RoadmapAiChatAttachment,
  type RoadmapAiChatMessage,
} from "./useRoadmapAiAssistantSession";

interface RoadmapAiAssistantPanelProps {
  roadmapId: string;
  baseRevision?: number;
  roadmapSnapshot?: Roadmap | null;
  epicsSnapshot?: RoadmapEpic[];
  isVisible?: boolean;
}

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

const toDiffSummary = (
  summary: Record<string, number> | undefined,
): ArtifactSemanticDiffSummary => ({
  node_added: Number(summary?.node_added ?? summary?.NODE_ADDED ?? 0),
  node_removed: Number(summary?.node_removed ?? summary?.NODE_REMOVED ?? 0),
  node_moved: Number(summary?.node_moved ?? summary?.NODE_MOVED ?? 0),
  status_changed: Number(
    summary?.status_changed ?? summary?.STATUS_CHANGED ?? 0,
  ),
  date_changed: Number(summary?.date_changed ?? summary?.DATE_CHANGED ?? 0),
  dependency_changed: Number(
    summary?.dependency_changed ?? summary?.DEPENDENCY_CHANGED ?? 0,
  ),
});

const toDiffChanges = (changes: unknown): ArtifactSemanticDiffChange[] => {
  if (!Array.isArray(changes)) return [];
  return changes.flatMap((change) => {
    if (!change || typeof change !== "object" || Array.isArray(change))
      return [];
    const record = change as Record<string, unknown>;
    const node = record.node;
    if (!node || typeof node !== "object" || Array.isArray(node)) return [];
    const nodeRecord = node as Record<string, unknown>;
    if (
      typeof nodeRecord.id !== "string" ||
      typeof nodeRecord.type !== "string"
    )
      return [];
    return [
      {
        type: typeof record.type === "string" ? record.type : "UNKNOWN",
        node: {
          type: nodeRecord.type as ArtifactSemanticDiffChange["node"]["type"],
          id: nodeRecord.id,
        },
        from:
          record.from &&
          typeof record.from === "object" &&
          !Array.isArray(record.from)
            ? (record.from as Record<string, unknown>)
            : undefined,
        to:
          record.to &&
          typeof record.to === "object" &&
          !Array.isArray(record.to)
            ? (record.to as Record<string, unknown>)
            : undefined,
      },
    ];
  });
};

const mapPreviewToArtifact = (
  roadmapId: string,
  payload: AgentPreviewPayload,
  metadata?: AgentRoadmapPreviewArtifact,
  fallbackRoadmap?: Roadmap | null,
): RoadmapArtifactPreview => {
  const normalizedSnapshot = normalizeArtifactCandidateSnapshot({
    candidateSnapshot: payload.candidate_snapshot,
    baseUpdatedAt: payload.base_updated_at,
    fallbackRoadmap: fallbackRoadmap || null,
  });
  return {
    artifactId: metadata?.artifact_id || payload.preview_id,
    title: metadata?.title || "AI Artifact Preview",
    summary: metadata?.summary || "Generated preview from AI operations.",
    createdAt: metadata?.created_at || new Date().toISOString(),
    baseRoadmapId: roadmapId,
    baseRevision: metadata?.base_revision,
    candidateSnapshot: normalizedSnapshot,
    semanticDiffSummary: toDiffSummary(payload.semantic_diff?.summary),
    semanticDiffChanges: toDiffChanges(payload.semantic_diff?.changes),
    validationIssues: (payload.validation_issues || []).map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      path: issue.path,
      message: issue.message,
    })),
    status: "draft",
  };
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

interface PendingAttachment {
  id: string;
  file: File;
}

const formatAttachmentSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
};

export function RoadmapAiAssistantPanel({
  roadmapId,
  baseRevision,
  roadmapSnapshot,
  isVisible = true,
}: RoadmapAiAssistantPanelProps) {
  const { messages, appendMessage, updateMessage } =
    useRoadmapAiAssistantSession(roadmapId);
  const toast = useToast();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [previewArtifactId, setPreviewArtifactId] = useState<string | null>(
    null,
  );
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const roadmapFromStore = useRoadmapStore((state) => state.roadmap);
  const openArtifactTab = useRoadmapStore((state) => state.openArtifactTab);
  const applyArtifactSnapshot = useRoadmapStore(
    (state) => state.applyArtifactSnapshot,
  );
  const currentRoadmap = roadmapSnapshot ?? roadmapFromStore ?? null;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages.length, isSending]);

  useEffect(() => {
    if (!composerRef.current) return;
    composerRef.current.style.height = "0px";
    const nextHeight = Math.min(composerRef.current.scrollHeight, 160);
    composerRef.current.style.height = `${nextHeight}px`;
  }, [input]);

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
    let fallbackPreviewPayload: AgentPreviewPayload | null = null;

    const fetchArtifactDetailWithRecovery = async (
      artifactMeta: AgentRoadmapPreviewArtifact,
    ) => {
      try {
        return await roadmapAgentService.getArtifactPreview(
          activeSessionId,
          artifactMeta.artifact_id,
        );
      } catch (firstError) {
        const isNotFound =
          firstError instanceof RoadmapAgentServiceError &&
          firstError.statusCode === 404;
        if (!isNotFound) {
          console.warn(
            "[RoadmapAiAssistantPanel] artifact hydration request failed",
            {
              trace_id: response.debug_trace_id || null,
              session_id: activeSessionId,
              artifact_id: artifactMeta.artifact_id,
              preview_id: artifactMeta.preview_id,
              error:
                firstError instanceof Error
                  ? firstError.message
                  : String(firstError),
            },
          );
          throw firstError;
        }

        await delay(250);

        try {
          return await roadmapAgentService.getArtifactPreview(
            activeSessionId,
            artifactMeta.artifact_id,
          );
        } catch (retryError) {
          const retryNotFound =
            retryError instanceof RoadmapAgentServiceError &&
            retryError.statusCode === 404;
          if (!retryNotFound) throw retryError;

          if (fallbackPreviewPayload === null) {
            try {
              const previewResponse = await roadmapAgentService.previewSession(
                activeSessionId,
                {
                  base_revision: baseRevision,
                },
              );
              fallbackPreviewPayload = previewResponse.preview;
            } catch (fallbackError) {
              console.warn(
                "[RoadmapAiAssistantPanel] artifact hydration fallback failed",
                {
                  trace_id: response.debug_trace_id || null,
                  session_id: activeSessionId,
                  artifact_id: artifactMeta.artifact_id,
                  preview_id: artifactMeta.preview_id,
                  error:
                    fallbackError instanceof Error
                      ? fallbackError.message
                      : String(fallbackError),
                },
              );
              throw fallbackError;
            }
          }

          return {
            artifact: artifactMeta,
            preview: fallbackPreviewPayload,
          };
        }
      }
    };

    for (const artifactMeta of response.artifacts || []) {
      if (artifactMeta.inline_preview) {
        hydrated.push(
          mapPreviewToArtifact(
            roadmapId,
            artifactMeta.inline_preview,
            artifactMeta,
            currentRoadmap,
          ),
        );
        continue;
      }
      const artifactDetail =
        await fetchArtifactDetailWithRecovery(artifactMeta);
      hydrated.push(
        mapPreviewToArtifact(
          roadmapId,
          artifactDetail.preview,
          artifactDetail.artifact,
          currentRoadmap,
        ),
      );
    }

    if (
      hydrated.length === 0 &&
      response.response_mode === "edit_plan" &&
      response.preview_available
    ) {
      const previewResponse = await roadmapAgentService.previewSession(
        activeSessionId,
        {
          base_revision: baseRevision,
        },
      );
      hydrated.push(
        mapPreviewToArtifact(
          roadmapId,
          previewResponse.preview,
          undefined,
          currentRoadmap,
        ),
      );
    }

    return hydrated;
  };

  const handleSend = async () => {
    const trimmedMessage = input.trim();
    if ((!trimmedMessage && attachments.length === 0) || isSending) return;

    const attachmentMetadata: RoadmapAiChatAttachment[] = attachments.map(
      ({ id, file }) => ({
        id,
        name: file.name,
        size: file.size,
        type: file.type || undefined,
      }),
    );

    const attachmentContext =
      attachmentMetadata.length > 0
        ? `\n\nAttached files:\n${attachmentMetadata
            .map(
              (file) => `- ${file.name} (${formatAttachmentSize(file.size)})`,
            )
            .join("\n")}`
        : "";
    const agentMessage = `${trimmedMessage || "Please review the attached files."}${attachmentContext}`;

    setInput("");
    setAttachments([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setErrorMessage(null);
    appendMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: trimmedMessage || "Attached files",
      timestamp: new Date().toISOString(),
      attachments: attachmentMetadata,
    });

    setIsSending(true);
    let activeSessionId: string | null = null;
    try {
      activeSessionId = await ensureSession();
      const response = await roadmapAgentService.sendMessage(activeSessionId, {
        message: agentMessage,
        auto_preview: true,
      });

      const assistantId = crypto.randomUUID();
      appendMessage({
        ...buildAssistantMessage(
          response.assistant_message || "I analyzed your request.",
          response.parse_mode || "agent_response",
          {
            intentType: response.intent_type,
            responseMode: response.response_mode,
            artifacts: [],
          },
        ),
        id: assistantId,
      });

      try {
        const artifacts = await hydrateArtifacts(activeSessionId, response);
        if (artifacts.length > 0) {
          updateMessage(assistantId, (message) => ({
            ...message,
            artifacts,
          }));
        }
      } catch (artifactError) {
        const isNormalizationError =
          artifactError instanceof ArtifactSnapshotNormalizationError;
        const artifactErrorText =
          artifactError instanceof Error
            ? artifactError.message
            : "Unable to load artifact preview.";
        console.warn("[RoadmapAiAssistantPanel] artifact hydration failed", {
          trace_id: response.debug_trace_id || null,
          session_id: activeSessionId,
          error: artifactErrorText,
          error_code: isNormalizationError ? artifactError.code : null,
          error_path: isNormalizationError ? artifactError.path : null,
        });
        toast.warning(`Artifact preview unavailable: ${artifactErrorText}`);
      }
    } catch (error) {
      const timeoutError = isAgentTimeoutError(error);
      const timeoutMessage =
        "AI response is taking longer than expected. Please wait or retry.";
      const readableError =
        error instanceof Error
          ? error.message
          : "Failed to reach AI agent service.";
      const userFacingMessage = timeoutError ? timeoutMessage : readableError;
      setErrorMessage(userFacingMessage);
      if (timeoutError) {
        console.warn("[RoadmapAiAssistantPanel] send_message_timeout", {
          session_id: activeSessionId,
          roadmap_id: roadmapId,
          error: readableError,
        });
      }
      appendMessage(
        buildAssistantMessage(
          timeoutError
            ? timeoutMessage
            : "I couldn't complete that request. Please try again.",
          "agent_error",
        ),
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleOpenArtifact = (artifact: RoadmapArtifactPreview) => {
    openArtifactTab(artifact);
  };

  const handleApplyArtifact = (artifact: RoadmapArtifactPreview) => {
    applyArtifactSnapshot(artifact.artifactId);
    toast.success(`${artifact.title} applied to roadmap`);
  };

  const toggleArtifactPreview = (artifactId: string) => {
    setPreviewArtifactId((prev) => (prev === artifactId ? null : artifactId));
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const handleComposerKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const handleAddAttachment = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length === 0) return;

    setAttachments((prev) => {
      const existingKeys = new Set(
        prev.map((entry) => `${entry.file.name}:${entry.file.size}`),
      );
      const next = [...prev];
      for (const file of selectedFiles) {
        const key = `${file.name}:${file.size}`;
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        next.push({ id: crypto.randomUUID(), file });
      }
      return next;
    });
  };

  const removeAttachment = (attachmentId: string) => {
    setAttachments((prev) => prev.filter((entry) => entry.id !== attachmentId));
  };

  if (!isVisible) {
    return null;
  }

  return (
    <section
      className="h-full w-full bg-white border-l border-gray-200 overflow-hidden flex flex-col"
      aria-label="AI Assistant Panel"
    >
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3 bg-gray-50/40">
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
                      message.role === "user"
                        ? "text-orange-600"
                        : "text-gray-700"
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
                {message.content ? (
                  <div className="text-xs text-gray-800 leading-relaxed">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: ({ children }) => (
                          <p className="mb-2 last:mb-0 whitespace-pre-wrap">
                            {children}
                          </p>
                        ),
                        ul: ({ children }) => (
                          <ul className="mb-2 list-disc pl-4 space-y-1">
                            {children}
                          </ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="mb-2 list-decimal pl-4 space-y-1">
                            {children}
                          </ol>
                        ),
                        code: ({ children }) => (
                          <code className="rounded bg-gray-100 px-1 py-0.5 text-[11px]">
                            {children}
                          </code>
                        ),
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  </div>
                ) : null}

                {(message.attachments?.length ?? 0) > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {message.attachments?.map((attachment) => (
                      <span
                        key={attachment.id}
                        className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-gray-50 px-2 py-1 text-[10px] text-gray-600"
                      >
                        <Paperclip className="h-3 w-3" />
                        <span className="max-w-[140px] truncate">
                          {attachment.name}
                        </span>
                        <span className="text-gray-400">
                          {formatAttachmentSize(attachment.size)}
                        </span>
                      </span>
                    ))}
                  </div>
                )}

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

                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleApplyArtifact(artifact)}
                            className="h-7 px-2.5 rounded-md border border-orange-300 bg-white text-[10px] font-semibold text-orange-700 hover:bg-orange-100 inline-flex items-center gap-1.5"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Apply
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenArtifact(artifact)}
                            className="h-7 px-2.5 rounded-md border border-orange-300 bg-white text-[10px] font-semibold text-orange-700 hover:bg-orange-100 inline-flex items-center gap-1.5"
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                            Open
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              toggleArtifactPreview(artifact.artifactId)
                            }
                            className="h-7 px-2.5 rounded-md border border-orange-300 bg-white text-[10px] font-semibold text-orange-700 hover:bg-orange-100 inline-flex items-center gap-1.5"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Preview
                          </button>
                        </div>

                        {previewArtifactId === artifact.artifactId && (
                          <div className="mt-2 rounded-md border border-orange-200 bg-white p-2 text-[10px] text-gray-700 space-y-1">
                            <p className="font-semibold text-orange-700">
                              Semantic Changes
                            </p>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                              <span>
                                Added: {artifact.semanticDiffSummary.node_added}
                              </span>
                              <span>
                                Removed:{" "}
                                {artifact.semanticDiffSummary.node_removed}
                              </span>
                              <span>
                                Moved: {artifact.semanticDiffSummary.node_moved}
                              </span>
                              <span>
                                Status:{" "}
                                {artifact.semanticDiffSummary.status_changed}
                              </span>
                              <span>
                                Date:{" "}
                                {artifact.semanticDiffSummary.date_changed}
                              </span>
                              <span>
                                Dependency:{" "}
                                {
                                  artifact.semanticDiffSummary
                                    .dependency_changed
                                }
                              </span>
                            </div>
                          </div>
                        )}
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
            Agent endpoint:{" "}
            {import.meta.env.VITE_AGENT_API_URL || "http://localhost:8010"}
          </span>
        </div>

        {(attachments.length > 0 || !isSending) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((attachment) => (
              <span
                key={attachment.id}
                className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2 py-1 text-[10px] text-orange-700"
              >
                <Paperclip className="h-3 w-3" />
                <span className="max-w-[130px] truncate">
                  {attachment.file.name}
                </span>
                <span className="text-orange-500">
                  {formatAttachmentSize(attachment.file.size)}
                </span>
                <button
                  type="button"
                  onClick={() => removeAttachment(attachment.id)}
                  className="rounded-full p-0.5 hover:bg-orange-100"
                  aria-label={`Remove ${attachment.file.name}`}
                  disabled={isSending}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleAddAttachment}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSending}
            className="h-10 w-10 rounded-xl border border-gray-300 text-gray-600 inline-flex items-center justify-center hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Add attachment"
            aria-label="Add attachment"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          <textarea
            ref={composerRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Chat or request roadmap edits..."
            className="flex-1 min-h-10 max-h-40 rounded-xl border border-gray-300 px-3 py-2 text-sm resize-none overflow-y-auto no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-300"
            disabled={isSending}
            rows={1}
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={isSending || (!input.trim() && attachments.length === 0)}
            className="h-10 w-10 rounded-xl bg-[#ff9933] text-white inline-flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#ff880f] transition-colors"
            title="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </footer>
    </section>
  );
}
