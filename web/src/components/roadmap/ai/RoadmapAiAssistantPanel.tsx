import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  Eye,
  FolderOpen,
  Paperclip,
  Send,
  TriangleAlert,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { RoadmapView } from "../views/roadmap/RoadmapView";
import { useRoadmapStore } from "@/stores/roadmapStore";
import type {
  Roadmap,
  RoadmapEpic,
  RoadmapFeature,
  RoadmapTask,
} from "@/types/roadmap";
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

const sortByReferenceOrder = <T extends { id: string; position?: number }>(
  items: T[],
  referenceOrder: Map<string, number>,
): T[] => {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aRef = referenceOrder.get(a.item.id);
      const bRef = referenceOrder.get(b.item.id);
      const aHasRef = typeof aRef === "number";
      const bHasRef = typeof bRef === "number";

      if (aHasRef && bHasRef && aRef !== bRef) return aRef - bRef;
      if (aHasRef !== bHasRef) return aHasRef ? -1 : 1;

      const aPos =
        typeof a.item.position === "number"
          ? a.item.position
          : Number.MAX_SAFE_INTEGER;
      const bPos =
        typeof b.item.position === "number"
          ? b.item.position
          : Number.MAX_SAFE_INTEGER;
      if (aPos !== bPos) return aPos - bPos;

      return a.index - b.index;
    })
    .map((entry) => entry.item);
};

const sortByPosition = <T extends { position?: number }>(items: T[]): T[] => {
  return [...items].sort((a, b) => {
    const aPos =
      typeof a.position === "number" ? a.position : Number.MAX_SAFE_INTEGER;
    const bPos =
      typeof b.position === "number" ? b.position : Number.MAX_SAFE_INTEGER;
    return aPos - bPos;
  });
};

const alignSnapshotOrderingWithFallback = (
  snapshot: Roadmap,
  fallbackRoadmap?: Roadmap | null,
): Roadmap => {
  if (!fallbackRoadmap?.epics?.length || !snapshot.epics?.length) {
    return snapshot;
  }

  const fallbackEpics = sortByPosition(fallbackRoadmap.epics);
  const fallbackEpicOrder = new Map(
    fallbackEpics.map((epic, index) => [epic.id, index]),
  );
  const fallbackEpicById = new Map(
    fallbackEpics.map((epic) => [epic.id, epic]),
  );

  const orderedEpics = sortByReferenceOrder(
    snapshot.epics,
    fallbackEpicOrder,
  ).map((epic, epicIndex) => {
    const fallbackEpic = fallbackEpicById.get(epic.id);
    const fallbackFeatures = sortByPosition(fallbackEpic?.features ?? []);
    const fallbackFeatureOrder = new Map(
      fallbackFeatures.map((feature, index) => [feature.id, index]),
    );
    const fallbackFeatureById = new Map(
      fallbackFeatures.map((feature) => [feature.id, feature]),
    );

    const orderedFeatures = sortByReferenceOrder(
      epic.features ?? [],
      fallbackFeatureOrder,
    ).map((feature, featureIndex) => {
      const fallbackFeature = fallbackFeatureById.get(feature.id);
      const fallbackTasks = sortByPosition(fallbackFeature?.tasks ?? []);
      const fallbackTaskOrder = new Map(
        fallbackTasks.map((task, index) => [task.id, index]),
      );
      const orderedTasks = sortByReferenceOrder(
        feature.tasks ?? [],
        fallbackTaskOrder,
      ).map((task, taskIndex) => ({ ...task, position: taskIndex }));

      return {
        ...feature,
        position: featureIndex,
        tasks: orderedTasks,
      };
    });

    return {
      ...epic,
      position: epicIndex,
      features: orderedFeatures,
    };
  });

  return {
    ...snapshot,
    epics: orderedEpics,
  };
};

const hasSameStructureIds = (
  snapshot: Roadmap,
  fallbackRoadmap?: Roadmap | null,
): boolean => {
  if (!fallbackRoadmap?.epics?.length || !snapshot.epics?.length) {
    return false;
  }

  const snapshotEpicIds = new Set(
    (snapshot.epics ?? []).map((epic) => epic.id),
  );
  const fallbackEpicIds = new Set(
    (fallbackRoadmap.epics ?? []).map((epic) => epic.id),
  );
  if (snapshotEpicIds.size !== fallbackEpicIds.size) return false;
  for (const epicId of snapshotEpicIds) {
    if (!fallbackEpicIds.has(epicId)) return false;
  }

  const fallbackEpicById = new Map(
    (fallbackRoadmap.epics ?? []).map((epic) => [epic.id, epic]),
  );

  for (const snapshotEpic of snapshot.epics ?? []) {
    const fallbackEpic = fallbackEpicById.get(snapshotEpic.id);
    if (!fallbackEpic) return false;

    const snapshotFeatureIds = new Set(
      (snapshotEpic.features ?? []).map((feature) => feature.id),
    );
    const fallbackFeatureIds = new Set(
      (fallbackEpic.features ?? []).map((feature) => feature.id),
    );
    if (snapshotFeatureIds.size !== fallbackFeatureIds.size) return false;
    for (const featureId of snapshotFeatureIds) {
      if (!fallbackFeatureIds.has(featureId)) return false;
    }

    const fallbackFeatureById = new Map(
      (fallbackEpic.features ?? []).map((feature) => [feature.id, feature]),
    );

    for (const snapshotFeature of snapshotEpic.features ?? []) {
      const fallbackFeature = fallbackFeatureById.get(snapshotFeature.id);
      if (!fallbackFeature) return false;

      const snapshotTaskIds = new Set(
        (snapshotFeature.tasks ?? []).map((task) => task.id),
      );
      const fallbackTaskIds = new Set(
        (fallbackFeature.tasks ?? []).map((task) => task.id),
      );
      if (snapshotTaskIds.size !== fallbackTaskIds.size) return false;
      for (const taskId of snapshotTaskIds) {
        if (!fallbackTaskIds.has(taskId)) return false;
      }
    }
  }

  return true;
};

const mapPreviewToArtifact = (
  roadmapId: string,
  payload: AgentPreviewPayload,
  metadata?: AgentRoadmapPreviewArtifact,
  fallbackRoadmap?: Roadmap | null,
): RoadmapArtifactPreview => {
  const semanticDiffSummary = toDiffSummary(payload.semantic_diff?.summary);
  const normalizedSnapshot = normalizeArtifactCandidateSnapshot({
    candidateSnapshot: payload.candidate_snapshot,
    baseUpdatedAt: payload.base_updated_at,
    fallbackRoadmap: fallbackRoadmap || null,
  });
  const candidateSnapshot = hasSameStructureIds(
    normalizedSnapshot,
    fallbackRoadmap,
  )
    ? alignSnapshotOrderingWithFallback(normalizedSnapshot, fallbackRoadmap)
    : normalizedSnapshot;

  return {
    artifactId: metadata?.artifact_id || payload.preview_id,
    previewId: metadata?.preview_id || payload.preview_id,
    title: metadata?.title || "AI Artifact Preview",
    summary: metadata?.summary || "Generated preview from AI operations.",
    createdAt: metadata?.created_at || new Date().toISOString(),
    baseRoadmapId: roadmapId,
    baseRevision: metadata?.base_revision,
    candidateSnapshot,
    semanticDiffSummary,
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

const noopUpdateEpic = (_epic: RoadmapEpic) => {};
const noopDeleteEpic = (_epicId: string) => {};
const noopUpdateFeature = (_feature: RoadmapFeature) => {};
const noopDeleteFeature = (_featureId: string) => {};
const noopUpdateTask = (_task: RoadmapTask) => {};

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

  const handleApplyArtifact = async (artifact: RoadmapArtifactPreview) => {
    const activeSessionId = sessionId;
    if (!activeSessionId) {
      toast.error("Missing AI session. Send a message first, then apply again.");
      return;
    }

    try {
      await roadmapAgentService.commitSession(activeSessionId, {
        preview_id: artifact.previewId,
      });
      applyArtifactSnapshot(artifact.artifactId);
      toast.success(`${artifact.title} applied to roadmap`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to apply artifact.";
      toast.error(message);
    }
  };

  const toggleArtifactPreview = (artifactId: string) => {
    setPreviewArtifactId((prev) => (prev === artifactId ? null : artifactId));
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
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3 bg-gray-50/40 relative [scrollbar-width:thin] [scrollbar-color:rgba(156,163,175,0.5)_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-400 [&::-webkit-scrollbar-thumb]:rounded-full hover:[scrollbar-color:rgba(107,114,128,0.7)_transparent] hover:[&::-webkit-scrollbar-thumb]:bg-gray-500">
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
                className={
                  message.role === "user"
                    ? "rounded-lg px-3.5 py-2.5 border border-orange-300 bg-orange-50 ml-8 mr-0 shadow-sm"
                    : "px-0 py-1.5 border-0 bg-transparent ml-0 mr-4"
                }
              >
                {message.role === "user" && (
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[11px] font-semibold text-orange-700">
                      You
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {new Date(message.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                )}
                {message.role === "assistant" && (
                  <div className="flex items-center justify-between gap-2 mb-1 text-[10px] text-gray-500">
                    <span>Assistant</span>
                    <span>
                      {new Date(message.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                )}
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
                    {artifacts.map((artifact) => {
                      const inlinePreviewSnapshot = hasSameStructureIds(
                        artifact.candidateSnapshot,
                        currentRoadmap,
                      )
                        ? alignSnapshotOrderingWithFallback(
                            artifact.candidateSnapshot,
                            currentRoadmap,
                          )
                        : artifact.candidateSnapshot;

                      return (
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
                            Validation issues:{" "}
                            {artifact.validationIssues.length}
                          </div>

                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                void handleApplyArtifact(artifact);
                              }}
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
                              Open in Tabs
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

                          <AnimatePresence>
                            {previewArtifactId === artifact.artifactId && (
                              <motion.div
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 8 }}
                                transition={{ duration: 0.24, ease: "easeOut" }}
                                className="mt-2 h-72 overflow-hidden rounded-md border border-gray-200"
                              >
                                <RoadmapView
                                  roadmap={inlinePreviewSnapshot}
                                  epics={inlinePreviewSnapshot.epics || []}
                                  showMiniMap={false}
                                  minZoom={0.1}
                                  onUpdateEpic={noopUpdateEpic}
                                  onDeleteEpic={noopDeleteEpic}
                                  onUpdateFeature={noopUpdateFeature}
                                  onDeleteFeature={noopDeleteFeature}
                                  onUpdateTask={noopUpdateTask}
                                />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
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
