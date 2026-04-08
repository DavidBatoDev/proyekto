import {
  cloneElement,
  isValidElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
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
  type AgentCommitPayload,
  type AgentRoadmapCommitArtifact,
  isAgentTimeoutError,
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

const BRACKET_TAG_PATTERN = /\[([^\[\]\n]{1,120})\]/g;

const renderBracketTagText = (text: string): ReactNode => {
  BRACKET_TAG_PATTERN.lastIndex = 0;
  if (!BRACKET_TAG_PATTERN.test(text)) return text;
  BRACKET_TAG_PATTERN.lastIndex = 0;

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = BRACKET_TAG_PATTERN.exec(text)) !== null) {
    const [fullMatch, label] = match;
    const start = match.index;
    const end = start + fullMatch.length;

    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start));
    }

    parts.push(
      <span
        key={`assistant-tag-${start}-${end}`}
        className="mx-0.5 inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium leading-none text-slate-700"
      >
        {label}
      </span>,
    );

    lastIndex = end;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
};

const renderBracketTagsInNode = (node: ReactNode): ReactNode => {
  if (typeof node === "string") return renderBracketTagText(node);
  if (Array.isArray(node)) {
    return node.map((child) => renderBracketTagsInNode(child));
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    if (node.props.children === undefined) return node;
    return cloneElement(
      node,
      undefined,
      renderBracketTagsInNode(node.props.children),
    );
  }
  return node;
};

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

const mapCommitToArtifact = (
  roadmapId: string,
  payload: AgentCommitPayload,
  metadata?: AgentRoadmapCommitArtifact,
  fallbackRoadmap?: Roadmap | null,
): RoadmapArtifactPreview => {
  const semanticDiffSummary = toDiffSummary(payload.semantic_diff?.summary);
  const normalizedSnapshot = normalizeArtifactCandidateSnapshot({
    candidateSnapshot: payload.candidate_snapshot,
    baseUpdatedAt: undefined,
    fallbackRoadmap: fallbackRoadmap || null,
  });
  const candidateSnapshot = hasSameStructureIds(
    normalizedSnapshot,
    fallbackRoadmap,
  )
    ? alignSnapshotOrderingWithFallback(normalizedSnapshot, fallbackRoadmap)
    : normalizedSnapshot;

  return {
    artifactId:
      metadata?.artifact_id || payload.change_id || crypto.randomUUID(),
    changeId: metadata?.change_id,
    title: metadata?.title || "AI Commit Artifact",
    summary:
      metadata?.summary || "Generated commit snapshot from AI operations.",
    createdAt: metadata?.created_at || new Date().toISOString(),
    baseRoadmapId: roadmapId,
    baseRevision: metadata?.base_revision,
    candidateSnapshot,
    semanticDiffSummary,
    semanticDiffChanges: toDiffChanges(payload.semantic_diff?.changes),
    validationIssues: [],
    status: metadata?.status || "draft",
  };
};

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
  const [applyingArtifactIds, setApplyingArtifactIds] = useState<Set<string>>(
    () => new Set<string>(),
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
  const loadRoadmap = useRoadmapStore((state) => state.loadRoadmap);
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
    for (const artifactMeta of response.artifacts || []) {
      if (artifactMeta.inline_commit) {
        hydrated.push(
          mapCommitToArtifact(
            roadmapId,
            artifactMeta.inline_commit,
            artifactMeta,
            currentRoadmap,
          ),
        );
        continue;
      }
      console.warn(
        "[RoadmapAiAssistantPanel] commit artifact missing inline payload",
        {
          trace_id: response.debug_trace_id || null,
          session_id: activeSessionId,
          artifact_id: artifactMeta.artifact_id,
        },
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
          for (const artifact of artifacts) {
            if (artifact.status === "applied") {
              applyArtifactSnapshot(artifact.artifactId);
            }
          }
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

  const handleApplyArtifact = async (
    messageId: string,
    artifact: RoadmapArtifactPreview,
  ) => {
    if (artifact.status === "applied") {
      toast.info("This artifact is already applied.");
      return;
    }
    if (applyingArtifactIds.has(artifact.artifactId)) {
      return;
    }

    const activeSessionId = sessionId;
    if (!activeSessionId) {
      toast.error(
        "Missing AI session. Send a message first, then apply again.",
      );
      return;
    }

    setApplyingArtifactIds((prev) => {
      const next = new Set(prev);
      next.add(artifact.artifactId);
      return next;
    });

    try {
      const result = await roadmapAgentService.commitSession(
        activeSessionId,
        {},
      );
      const committedChangeId =
        typeof result.commit?.change_id === "string"
          ? (result.commit.change_id as string)
          : undefined;
      applyArtifactSnapshot(artifact.artifactId);
      await loadRoadmap(roadmapId, { force: true });
      updateMessage(messageId, (message) => ({
        ...message,
        artifacts: (message.artifacts ?? []).map((entry) =>
          entry.artifactId === artifact.artifactId
            ? {
                ...entry,
                status: "applied",
                changeId: committedChangeId || entry.changeId,
              }
            : entry,
        ),
      }));
      toast.success(`${artifact.title} applied to roadmap`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to apply artifact.";
      toast.error(message);
    } finally {
      setApplyingArtifactIds((prev) => {
        const next = new Set(prev);
        next.delete(artifact.artifactId);
        return next;
      });
    }
  };

  const handleDiscardArtifact = async (
    messageId: string,
    artifact: RoadmapArtifactPreview,
  ) => {
    if (!artifact.changeId) {
      toast.error("This artifact is missing a committed change id.");
      return;
    }
    if (applyingArtifactIds.has(artifact.artifactId)) {
      return;
    }
    if (!sessionId) {
      toast.error("Missing AI session. Send a message first, then retry.");
      return;
    }

    setApplyingArtifactIds((prev) => {
      const next = new Set(prev);
      next.add(artifact.artifactId);
      return next;
    });

    try {
      await roadmapAgentService.discardSession(sessionId, {
        change_id: artifact.changeId,
      });
      await loadRoadmap(roadmapId, { force: true });
      updateMessage(messageId, (message) => ({
        ...message,
        artifacts: (message.artifacts ?? []).map((entry) =>
          entry.changeId === artifact.changeId
            ? { ...entry, status: "discarded" }
            : entry,
        ),
      }));
      toast.success("Committed AI change discarded.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to discard commit.";
      toast.error(message);
    } finally {
      setApplyingArtifactIds((prev) => {
        const next = new Set(prev);
        next.delete(artifact.artifactId);
        return next;
      });
    }
  };

  const handleReapplyArtifact = async (
    messageId: string,
    artifact: RoadmapArtifactPreview,
  ) => {
    if (!artifact.changeId) {
      toast.error("This artifact is missing a committed change id.");
      return;
    }
    if (applyingArtifactIds.has(artifact.artifactId)) {
      return;
    }
    if (!sessionId) {
      toast.error("Missing AI session. Send a message first, then retry.");
      return;
    }

    setApplyingArtifactIds((prev) => {
      const next = new Set(prev);
      next.add(artifact.artifactId);
      return next;
    });

    try {
      await roadmapAgentService.rollbackSession(sessionId, {
        change_id: artifact.changeId,
      });
      await loadRoadmap(roadmapId, { force: true });
      updateMessage(messageId, (message) => ({
        ...message,
        artifacts: (message.artifacts ?? []).map((entry) =>
          entry.changeId === artifact.changeId
            ? { ...entry, status: "applied" }
            : entry,
        ),
      }));
      toast.success("Discarded AI change reapplied.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to reapply change.";
      toast.error(message);
    } finally {
      setApplyingArtifactIds((prev) => {
        const next = new Set(prev);
        next.delete(artifact.artifactId);
        return next;
      });
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
                            {renderBracketTagsInNode(children)}
                          </p>
                        ),
                        ul: ({ children }) => (
                          <ul className="mb-2 list-disc pl-4 space-y-1">
                            {renderBracketTagsInNode(children)}
                          </ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="mb-2 list-decimal pl-4 space-y-1">
                            {renderBracketTagsInNode(children)}
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
                      const isArtifactDraft = artifact.status === "draft";
                      const isArtifactApplied = artifact.status === "applied";
                      const isArtifactDiscarded =
                        artifact.status === "discarded";
                      const isApplyingArtifact = applyingArtifactIds.has(
                        artifact.artifactId,
                      );
                      const applyDisabled =
                        !isArtifactDraft || isApplyingArtifact;
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
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-[11px] font-semibold text-orange-700">
                              {artifact.title}
                            </p>
                            <span
                              className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                isArtifactApplied
                                  ? "border border-green-300 bg-green-50 text-green-700"
                                  : isArtifactDiscarded
                                    ? "border border-gray-300 bg-gray-100 text-gray-700"
                                    : "border border-orange-300 bg-white text-orange-700"
                              }`}
                            >
                              {isArtifactApplied
                                ? "Applied"
                                : isArtifactDiscarded
                                  ? "Discarded"
                                  : "Draft"}
                            </span>
                          </div>
                          <p className="text-[10px] text-orange-700/90 mt-0.5">
                            {artifact.summary}
                          </p>
                          <div className="mt-1.5 text-[10px] text-orange-800/90">
                            Validation issues:{" "}
                            {artifact.validationIssues.length}
                          </div>
                          {isArtifactApplied && (
                            <p className="mt-1 text-[10px] font-medium text-green-700">
                              Already applied to roadmap.
                            </p>
                          )}
                          {isArtifactDiscarded && (
                            <p className="mt-1 text-[10px] font-medium text-gray-700">
                              Discarded. You can reapply this committed change.
                            </p>
                          )}

                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {isArtifactDraft && (
                              <button
                                type="button"
                                onClick={() => {
                                  void handleApplyArtifact(
                                    message.id,
                                    artifact,
                                  );
                                }}
                                disabled={applyDisabled}
                                className="h-7 px-2.5 rounded-md border border-orange-300 bg-white text-[10px] font-semibold text-orange-700 hover:bg-orange-100 inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-white"
                              >
                                <Check className="w-3.5 h-3.5" />
                                {isApplyingArtifact ? "Applying..." : "Apply"}
                              </button>
                            )}

                            {isArtifactApplied && (
                              <button
                                type="button"
                                onClick={() => {
                                  void handleDiscardArtifact(
                                    message.id,
                                    artifact,
                                  );
                                }}
                                disabled={isApplyingArtifact}
                                className="h-7 px-2.5 rounded-md border border-red-300 bg-white text-[10px] font-semibold text-red-700 hover:bg-red-50 inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <X className="w-3.5 h-3.5" />
                                {isApplyingArtifact
                                  ? "Discarding..."
                                  : "Discard"}
                              </button>
                            )}

                            {isArtifactDiscarded && (
                              <button
                                type="button"
                                onClick={() => {
                                  void handleReapplyArtifact(
                                    message.id,
                                    artifact,
                                  );
                                }}
                                disabled={isApplyingArtifact}
                                className="h-7 px-2.5 rounded-md border border-green-300 bg-white text-[10px] font-semibold text-green-700 hover:bg-green-50 inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <Check className="w-3.5 h-3.5" />
                                {isApplyingArtifact
                                  ? "Reapplying..."
                                  : "Reapply"}
                              </button>
                            )}

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
