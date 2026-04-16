import {
  cloneElement,
  isValidElement,
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Bot,
  Check,
  ChevronDown,
  Eye,
  FolderOpen,
  Loader2,
  Paperclip,
  Send,
  TriangleAlert,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { RoadmapView } from "../views/roadmap/RoadmapView";
import { useRoadmapStore } from "@/stores/roadmapStore";
import { projectKeys } from "@/queries/project";
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
  type AgentOperation,
  type AgentMessageResponse,
  type AgentCommitPayload,
  type AgentRoadmapCommitArtifact,
  type AgentTraceEvent,
  type AgentTraceEventsResponse,
  RoadmapAgentServiceError,
  isAgentTimeoutError,
} from "@/services/roadmap-agent.service";
import {
  ArtifactSnapshotNormalizationError,
  normalizeArtifactCandidateSnapshot,
} from "@/services/roadmap-artifact-adapter";
import { useToast } from "@/hooks/useToast";
import { RoadmapAiActivityTimelineView } from "./RoadmapAiActivityTimeline";
import {
  buildCuratedToolRequestedMessage,
  buildCuratedToolResultMessage,
  buildFriendlyMinimalToolLabel,
  extractTraceToolName,
} from "./roadmapAiToolMessaging";
import {
  useRoadmapAiAssistantSession,
  type RoadmapAiActivityTimeline,
  type RoadmapAiActivityStep,
  type RoadmapAiActivityDetailMode,
  type RoadmapAiActivityPresentationMode,
  type RoadmapAiChatAttachment,
  type RoadmapAiChatMessage,
  type RoadmapAiCommitLifecycle,
  type RoadmapAiCommitImpactedItem,
  type RoadmapAiCommitImpactedItemKind,
} from "./useRoadmapAiAssistantSession";
import { RoadmapAiThreadList } from "./RoadmapAiThreadList";
import {
  useRoadmapAiThreadsStore,
  useActiveRoadmapAiThread,
} from "@/stores/roadmapAiThreadsStore";
import {
  useCreateRoadmapAiSession,
  useRoadmapAiSessionsList,
} from "@/hooks/useRoadmapAiSessions";

interface RoadmapAiAssistantPanelProps {
  projectId: string;
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
    commitLifecycle?: RoadmapAiCommitLifecycle;
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
  commitLifecycle: options?.commitLifecycle,
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

const TRACE_POLL_INTERVAL_MS = 400;
const TRACE_POLL_LIMIT = 50;
const TRACE_POLL_TIMEOUT_MS = 90_000;
const TRACE_NOT_READY_GRACE_MS = 10_000;
const PROGRESS_DETAIL_MODE: RoadmapAiActivityDetailMode = "structured";
const DEFAULT_PROGRESS_PRESENTATION_MODE: RoadmapAiActivityPresentationMode =
  "curated";

export const parseProgressPresentationMode = (
  value: unknown,
): RoadmapAiActivityPresentationMode => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (normalized === "friendly_minimal") return "friendly_minimal";
  if (normalized === "curated") return "curated";
  return DEFAULT_PROGRESS_PRESENTATION_MODE;
};

export const PROGRESS_PRESENTATION_MODE = parseProgressPresentationMode(
  import.meta.env.VITE_AI_PROGRESS_PRESENTATION_MODE,
);

interface PollLoopState {
  traceId: string;
  sessionId: string;
  afterSeq: number;
  startedAtMs: number;
  cancelled: boolean;
  timerId: number | null;
  pollingFailed: boolean;
}

const SHARED_HIDDEN_ACTIVITY_EVENTS = new Set<string>([
  "message_received",
  "actor_context_loaded",
  "intent_classified",
  "route_selected",
  "session_staged_state",
  "message_completed",
  "provider_success",
]);

const FRIENDLY_MINIMAL_EXTRA_HIDDEN_ACTIVITY_EVENTS = new Set<string>([
  "provider_attempt",
]);

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const toStringValue = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const COMMIT_IMPACT_KIND_ORDER: RoadmapAiCommitImpactedItemKind[] = [
  "created",
  "modified",
  "deleted",
];

const COMMIT_IMPACT_KIND_PRIORITY: Record<
  RoadmapAiCommitImpactedItemKind,
  number
> = {
  created: 2,
  modified: 1,
  deleted: 3,
};

const COMMIT_IMPACT_KIND_LABEL: Record<
  RoadmapAiCommitImpactedItemKind,
  string
> = {
  created: "Created",
  modified: "Modified",
  deleted: "Deleted",
};

const isRoadmapNodeType = (
  value: unknown,
): value is RoadmapAiCommitImpactedItem["nodeType"] => {
  return (
    value === "roadmap" ||
    value === "epic" ||
    value === "feature" ||
    value === "task"
  );
};

const normalizeChangeType = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return normalized || null;
};

const mapChangeTypeToImpactKind = (
  changeType: string | null,
): RoadmapAiCommitImpactedItemKind => {
  if (changeType === "NODE_ADDED") return "created";
  if (changeType === "NODE_REMOVED") return "deleted";
  return "modified";
};

export const parseCommitImpactedItemsFromOperations = (
  operations: AgentOperation[] | undefined,
): RoadmapAiCommitImpactedItem[] => {
  if (!Array.isArray(operations)) return [];

  const parsed = operations.flatMap((operation) => {
    const op = toStringValue(operation.op)?.toLowerCase();
    if (!op) return [];

    let nodeTypeCandidate = toStringValue(operation.node_type)?.toLowerCase();
    if (!nodeTypeCandidate) {
      if (op === "add_epic") nodeTypeCandidate = "epic";
      if (op === "add_feature") nodeTypeCandidate = "feature";
      if (op === "add_task") nodeTypeCandidate = "task";
    }
    if (!isRoadmapNodeType(nodeTypeCandidate)) return [];

    const operationData = toRecord(operation.data);
    const operationPatch = toRecord(operation.patch);
    const nodeId =
      toStringValue(operation.node_id) || toStringValue(operationData?.id);
    if (!nodeId) return [];

    let kind: RoadmapAiCommitImpactedItemKind = "modified";
    if (op === "add_epic" || op === "add_feature" || op === "add_task") {
      kind = "created";
    } else if (op === "delete_node") {
      kind = "deleted";
    }

    let changeType: string | undefined;
    if (op === "add_epic" || op === "add_feature" || op === "add_task") {
      changeType = "NODE_ADDED";
    } else if (op === "delete_node") {
      changeType = "NODE_REMOVED";
    } else if (op === "move_node") {
      changeType = "NODE_MOVED";
    } else if (op === "mark_status") {
      changeType = "STATUS_CHANGED";
    } else if (op === "shift_dates") {
      changeType = "DATE_CHANGED";
    } else if (op === "update_node") {
      changeType = "NODE_UPDATED";
    }

    return [
      {
        nodeId,
        nodeType: nodeTypeCandidate,
        title: pickCommitItemTitle(operationPatch, operationData),
        kind,
        changeType,
      },
    ];
  });

  return mergeCommitImpactedItems(parsed);
};

const pickCommitItemTitle = (...sources: unknown[]): string | undefined => {
  for (const source of sources) {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      continue;
    }
    const record = source as Record<string, unknown>;
    const candidate =
      toStringValue(record.title) ||
      toStringValue(record.name) ||
      toStringValue(record.node_title);
    if (candidate) return candidate;
  }
  return undefined;
};

const mergeCommitImpactedItems = (
  ...groups: Array<RoadmapAiCommitImpactedItem[] | undefined>
): RoadmapAiCommitImpactedItem[] => {
  const merged = new Map<string, RoadmapAiCommitImpactedItem>();
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const item of group) {
      if (!item?.nodeId || !isRoadmapNodeType(item.nodeType)) continue;
      const key = `${item.nodeType}:${item.nodeId}`;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, item);
        continue;
      }

      const existingPriority = COMMIT_IMPACT_KIND_PRIORITY[existing.kind] ?? 0;
      const nextPriority = COMMIT_IMPACT_KIND_PRIORITY[item.kind] ?? 0;
      if (nextPriority > existingPriority) {
        merged.set(key, {
          ...existing,
          ...item,
          title: item.title || existing.title,
          changeType: item.changeType || existing.changeType,
        });
        continue;
      }

      if (!existing.title && item.title) {
        merged.set(key, {
          ...existing,
          title: item.title,
        });
      }
    }
  }

  return [...merged.values()];
};

const toCommitImpactedItemsFromArtifact = (
  artifact: RoadmapArtifactPreview,
): RoadmapAiCommitImpactedItem[] => {
  return (artifact.semanticDiffChanges ?? []).flatMap((change) => {
    const nodeType = change.node?.type;
    const nodeId = toStringValue(change.node?.id);
    if (!nodeId || !isRoadmapNodeType(nodeType)) {
      return [];
    }

    const changeType = normalizeChangeType(change.type);
    return [
      {
        nodeId,
        nodeType,
        title: pickCommitItemTitle(change.to, change.from),
        kind: mapChangeTypeToImpactKind(changeType),
        changeType: changeType ?? undefined,
      },
    ];
  });
};

const toAppliedArtifactImpactedItems = (
  artifacts: RoadmapArtifactPreview[],
): RoadmapAiCommitImpactedItem[] => {
  const appliedArtifacts = artifacts.filter(
    (artifact) => artifact.status === "applied",
  );
  return mergeCommitImpactedItems(
    ...appliedArtifacts.map((artifact) =>
      toCommitImpactedItemsFromArtifact(artifact),
    ),
  );
};

export const parseCommitImpactedItemsFromTraceDetails = (
  details: Record<string, unknown> | undefined,
): RoadmapAiCommitImpactedItem[] => {
  const rawItems = details?.impacted_items;
  if (!Array.isArray(rawItems)) return [];

  const parsed = rawItems.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const nodeId =
      toStringValue(record.node_id) || toStringValue(record.nodeId);
    const nodeTypeCandidate =
      toStringValue(record.node_type) || toStringValue(record.nodeType);
    const nodeType = nodeTypeCandidate?.toLowerCase();
    if (!nodeId || !isRoadmapNodeType(nodeType)) {
      return [];
    }

    const changeType =
      normalizeChangeType(record.change_type) ||
      normalizeChangeType(record.changeType);
    const impactCandidate =
      toStringValue(record.impact)?.toLowerCase() ||
      toStringValue(record.kind)?.toLowerCase();
    const kind: RoadmapAiCommitImpactedItemKind =
      impactCandidate === "created" ||
      impactCandidate === "modified" ||
      impactCandidate === "deleted"
        ? impactCandidate
        : mapChangeTypeToImpactKind(changeType);

    return [
      {
        nodeId,
        nodeType,
        title: pickCommitItemTitle(record),
        kind,
        changeType: changeType ?? undefined,
      },
    ];
  });

  return mergeCommitImpactedItems(parsed);
};

const resolveCommitLifecycleFromTimeline = (
  timeline: RoadmapAiActivityTimeline,
  artifacts: RoadmapArtifactPreview[],
): RoadmapAiCommitLifecycle | null => {
  const completionStep = [...timeline.steps]
    .reverse()
    .find(
      (step) =>
        step.event === "auto_commit_async_completed" ||
        step.event === "auto_commit_async_failed",
    );

  if (completionStep?.event === "auto_commit_async_failed") {
    return {
      state: "failed",
      impactedItems: [],
      updatedAt: completionStep.ts,
    };
  }

  if (completionStep?.event === "auto_commit_async_completed") {
    const fromTrace = parseCommitImpactedItemsFromTraceDetails(
      completionStep.details,
    );
    const mergedItems = mergeCommitImpactedItems(
      fromTrace,
      toAppliedArtifactImpactedItems(artifacts),
    );
    return {
      state: "committed",
      impactedItems: mergedItems,
      updatedAt: completionStep.ts,
    };
  }

  const artifactItems = toAppliedArtifactImpactedItems(artifacts);
  if (artifactItems.length > 0) {
    return {
      state: "committed",
      impactedItems: artifactItems,
      updatedAt: timeline.completedAt || new Date().toISOString(),
    };
  }

  // When the server told us auto-commit was enqueued but we haven't yet
  // seen a terminal auto_commit_* event, keep the UI in "committing" so
  // the user doesn't see a spurious "did not finish" toast while the
  // backend is still working. Slow commits (10s+ on Vercel cold starts)
  // legitimately race past the poll deadline; the caller will reconcile
  // against the roadmap itself once the terminal event eventually lands.
  const messageCompletedStep = [...timeline.steps]
    .reverse()
    .find((step) => step.event === "message_completed");
  const autoCommitEnqueued = Boolean(
    messageCompletedStep?.details &&
      (messageCompletedStep.details as { auto_commit_async_enqueued?: unknown })
        .auto_commit_async_enqueued,
  );
  if (autoCommitEnqueued) {
    return {
      state: "committing",
      impactedItems: [],
      updatedAt:
        messageCompletedStep?.ts ||
        timeline.completedAt ||
        new Date().toISOString(),
    };
  }

  return null;
};

const groupCommitImpactedItems = (
  items: RoadmapAiCommitImpactedItem[],
): Record<RoadmapAiCommitImpactedItemKind, RoadmapAiCommitImpactedItem[]> => {
  const grouped: Record<
    RoadmapAiCommitImpactedItemKind,
    RoadmapAiCommitImpactedItem[]
  > = {
    created: [],
    modified: [],
    deleted: [],
  };

  for (const item of items) {
    grouped[item.kind].push(item);
  }

  for (const kind of COMMIT_IMPACT_KIND_ORDER) {
    grouped[kind].sort((a, b) => {
      const aTitle = (a.title || "").toLowerCase();
      const bTitle = (b.title || "").toLowerCase();
      if (aTitle && bTitle && aTitle !== bTitle) {
        return aTitle.localeCompare(bTitle);
      }
      if (a.nodeType !== b.nodeType) {
        return a.nodeType.localeCompare(b.nodeType);
      }
      return a.nodeId.localeCompare(b.nodeId);
    });
  }

  return grouped;
};

const getCommitLifecycleLabel = (
  state: RoadmapAiCommitLifecycle["state"],
): string => {
  if (state === "committed") return "Committed changes";
  if (state === "failed") return "Commit did not complete";
  return "Committing changes";
};

const parseCountFromUnknown = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.floor(parsed));
    }
  }
  return null;
};

const parseCountFromText = (text: string, key: string): number | null => {
  const escapedKey = key.replace("_", "[_\\s]");
  const match = text.match(new RegExp(`${escapedKey}\\s*[:=]\\s*(\\d+)`, "i"));
  if (!match?.[1]) return null;
  return Number.parseInt(match[1], 10);
};

const isActivityEventHidden = (
  event: string,
  presentationMode: RoadmapAiActivityPresentationMode,
): boolean => {
  if (SHARED_HIDDEN_ACTIVITY_EVENTS.has(event)) return true;
  if (presentationMode === "friendly_minimal") {
    return FRIENDLY_MINIMAL_EXTRA_HIDDEN_ACTIVITY_EVENTS.has(event);
  }
  return false;
};

const extractResultCounts = (step: {
  summary: string;
  details?: Record<string, unknown>;
}): {
  tasksCount: number | null;
  matchesCount: number | null;
  operationsCount: number | null;
  childrenCount: number | null;
} => {
  const resultSummary = toRecord(step.details?.result_summary);
  const tasksCount =
    parseCountFromUnknown(resultSummary?.tasks_count) ??
    parseCountFromText(step.summary, "tasks_count");
  const matchesCount =
    parseCountFromUnknown(resultSummary?.matches_count) ??
    parseCountFromText(step.summary, "matches_count");
  const operationsCount =
    parseCountFromUnknown(resultSummary?.operations_count) ??
    parseCountFromText(step.summary, "operations_count");
  const childrenCount =
    parseCountFromUnknown(resultSummary?.children_count) ??
    parseCountFromText(step.summary, "children_count");

  return {
    tasksCount,
    matchesCount,
    operationsCount,
    childrenCount,
  };
};

const buildFriendlyResultSummary = (counts: {
  tasksCount: number | null;
  matchesCount: number | null;
  operationsCount: number | null;
  childrenCount: number | null;
}): string => {
  const parts: string[] = [];
  if (counts.tasksCount != null) {
    parts.push(`Processed ${counts.tasksCount} tasks`);
  }
  if (counts.matchesCount != null) {
    parts.push(`Found ${counts.matchesCount} matches`);
  }
  if (counts.operationsCount != null) {
    parts.push(`Prepared ${counts.operationsCount} changes`);
  }
  if (counts.childrenCount != null) {
    parts.push(`Found ${counts.childrenCount} related items`);
  }
  if (parts.length === 0) {
    return "Completed this step.";
  }
  return `${parts.join(". ")}.`;
};

type RawActivityStep = {
  seq: number;
  ts: string;
  event: string;
  title: string;
  status: "running" | "success" | "error";
  summary: string;
  details?: Record<string, unknown>;
  titleList?: RoadmapAiActivityStep["titleList"];
};

const getIntentSummary = (rawStep: RawActivityStep): string => {
  const details = toRecord(rawStep.details);
  const intentType =
    typeof details?.intent_type === "string"
      ? details.intent_type.trim().toLowerCase()
      : "";
  if (intentType === "roadmap_edit") {
    return "I understood this as a roadmap edit request and started preparing concrete changes.";
  }
  if (intentType === "roadmap_query") {
    return "I understood this as a roadmap question and started gathering the right context.";
  }
  return "I am interpreting your request so I can choose the right execution path.";
};

const getRouteSummary = (rawStep: RawActivityStep): string => {
  const details = toRecord(rawStep.details);
  const responseMode =
    typeof details?.response_mode === "string"
      ? details.response_mode.trim().toLowerCase()
      : "";
  if (responseMode === "edit_plan") {
    return "I selected the edit workflow so I can prepare a safe set of roadmap changes.";
  }
  if (responseMode === "chat") {
    return "I selected a direct response path and am preparing the answer.";
  }
  return "I selected the best available path to handle your request safely.";
};

const getProviderAttemptSummary = (rawStep: RawActivityStep): string => {
  const details = toRecord(rawStep.details);
  const phase =
    typeof details?.phase === "string"
      ? details.phase.trim().toLowerCase()
      : "";
  if (phase === "edit_plan") {
    return "I am planning the roadmap updates now and validating each step before execution.";
  }
  if (phase === "chat") {
    return "I am composing the response and checking it against your request context.";
  }
  return "I am working through the next planning step for your request.";
};

const normalizeActivityStep = (
  rawStep: RawActivityStep,
  presentationMode: RoadmapAiActivityPresentationMode = PROGRESS_PRESENTATION_MODE,
): RoadmapAiActivityStep | null => {
  const normalizedEvent = String(rawStep.event || "")
    .trim()
    .toLowerCase();
  if (!normalizedEvent) return null;
  if (isActivityEventHidden(normalizedEvent, presentationMode)) {
    return null;
  }
  const baseStep = {
    seq: rawStep.seq,
    ts: rawStep.ts,
    event: normalizedEvent,
    status: rawStep.status,
    details: rawStep.details,
    titleList: rawStep.titleList,
  } as const;

  if (normalizedEvent === "intent_classified") {
    return {
      ...baseStep,
      title: "Understanding your request",
      summary: getIntentSummary(rawStep),
    };
  }

  if (normalizedEvent === "route_selected") {
    return {
      ...baseStep,
      title: "Choosing an approach",
      summary: getRouteSummary(rawStep),
    };
  }

  if (normalizedEvent === "provider_attempt") {
    return {
      ...baseStep,
      status: "running",
      title: "Planning the next steps",
      summary: getProviderAttemptSummary(rawStep),
    };
  }

  if (normalizedEvent === "planner_summary") {
    const details = toRecord(rawStep.details);
    const summaryText = toStringValue(details?.summary_text);
    return {
      ...baseStep,
      status: rawStep.status === "error" ? "error" : "success",
      title:
        presentationMode === "curated"
          ? "Gearing up your plan"
          : "Planning summary",
      summary:
        summaryText ||
        (presentationMode === "curated"
          ? "I prepared a concise planning summary before applying your roadmap changes."
          : "Prepared a planning summary."),
    };
  }

  if (normalizedEvent === "provider_failure") {
    return {
      ...baseStep,
      status: "error",
      title:
        presentationMode === "curated"
          ? "Recovering from a temporary issue"
          : "Temporary processing issue",
      summary:
        presentationMode === "curated"
          ? "I hit a temporary issue while planning, then switched to a safer recovery path to keep your request moving."
          : "We hit a temporary issue while handling your request.",
    };
  }

  if (normalizedEvent === "tool_call_requested") {
    const toolName = extractTraceToolName(rawStep);
    if (presentationMode === "curated") {
      const toolMessage = buildCuratedToolRequestedMessage(toolName, rawStep);
      return {
        ...baseStep,
        title: toolMessage.title,
        summary: toolMessage.summary,
      };
    }
    const label = buildFriendlyMinimalToolLabel(toolName);
    return {
      ...baseStep,
      title: label.requested,
      summary: "Working on this step now.",
    };
  }

  if (normalizedEvent === "tool_call_result") {
    const toolName = extractTraceToolName(rawStep);
    if (rawStep.status === "error") {
      const label = buildFriendlyMinimalToolLabel(toolName);
      return {
        ...baseStep,
        status: "error",
        title: label.requested,
        summary: "A step failed; retrying.",
      };
    }
    if (presentationMode === "curated") {
      const toolMessage = buildCuratedToolResultMessage(toolName, rawStep);
      return {
        ...baseStep,
        title: toolMessage.title,
        summary: toolMessage.summary,
        titleList: toolMessage.titleList,
      };
    }
    const label = buildFriendlyMinimalToolLabel(toolName);
    return {
      ...baseStep,
      title: label.completed,
      summary: buildFriendlyResultSummary(extractResultCounts(rawStep)),
    };
  }

  if (normalizedEvent === "plan_generated") {
    const operationsCount =
      parseCountFromUnknown(rawStep.details?.operations_count) ??
      parseCountFromText(rawStep.summary, "operations_count");
    return {
      ...baseStep,
      title:
        presentationMode === "curated"
          ? "Finalizing your change plan"
          : "Preparing your roadmap changes",
      summary:
        presentationMode === "curated"
          ? operationsCount != null
            ? `I prepared ${operationsCount} roadmap changes and validated the plan before applying.`
            : "I finalized your roadmap change plan and prepared it for application."
          : operationsCount != null
            ? `Prepared ${operationsCount} changes.`
            : "Prepared your roadmap changes.",
    };
  }

  if (normalizedEvent === "auto_commit_async_completed") {
    return {
      ...baseStep,
      status: "success",
      title: "Applied your changes",
      summary:
        presentationMode === "curated"
          ? "I applied your roadmap changes successfully and completed this run."
          : "Your roadmap changes were applied successfully.",
    };
  }

  if (normalizedEvent === "auto_commit_async_failed") {
    const details = toRecord(rawStep.details);
    const autoCommitErrorMessage = toStringValue(
      details?.auto_commit_error_message,
    );
    const invalidOperation = toRecord(details?.auto_commit_invalid_operation);
    const invalidReason = toStringValue(invalidOperation?.reason);
    const hasStatusValidationIssue =
      (autoCommitErrorMessage ?? "")
        .toLowerCase()
        .includes("validation error") &&
      (invalidReason === "mark_status.status_invalid" ||
        autoCommitErrorMessage?.toLowerCase().includes("status"));
    return {
      ...baseStep,
      status: "error",
      title: "Could not apply changes automatically",
      summary:
        presentationMode === "curated"
          ? hasStatusValidationIssue
            ? "Your change plan is ready, but one or more updates used an invalid status value. Use one of: todo, in progress, in review, done, or blocked."
            : "Your change plan is ready, but automatic apply did not finish. You can still review and apply it manually."
          : "Your changes are ready, but auto-apply did not complete.",
    };
  }

  return null;
};

export const mergeTimelineSteps = (
  existingSteps: RoadmapAiActivityStep[],
  incomingEvents: AgentTraceEvent[],
  presentationMode: RoadmapAiActivityPresentationMode = PROGRESS_PRESENTATION_MODE,
): RoadmapAiActivityStep[] => {
  const deduped = new Map<number, RoadmapAiActivityStep>();
  for (const step of existingSteps) {
    const normalized = normalizeActivityStep(
      {
        seq: step.seq,
        ts: step.ts,
        event: step.event,
        title: step.title,
        status: step.status,
        summary: step.summary,
        details: step.details,
        titleList: step.titleList,
      },
      presentationMode,
    );
    if (normalized) {
      deduped.set(normalized.seq, normalized);
    }
  }
  for (const event of incomingEvents) {
    const normalized = normalizeActivityStep(
      {
        seq: event.seq,
        ts: event.ts,
        event: event.event,
        title: event.title,
        status: event.status,
        summary: event.summary,
        details: event.details,
      },
      presentationMode,
    );
    if (normalized) {
      deduped.set(normalized.seq, normalized);
    }
  }
  return [...deduped.values()].sort((a, b) => a.seq - b.seq);
};

export const toTimelineFromTraceResponse = (
  detailMode: RoadmapAiActivityDetailMode,
  traceId: string,
  response: AgentTraceEventsResponse,
  previousTimeline?: RoadmapAiActivityTimeline | null,
  presentationMode: RoadmapAiActivityPresentationMode = PROGRESS_PRESENTATION_MODE,
): RoadmapAiActivityTimeline => {
  const messageCompletedElapsedMs = [...response.events].reverse().find(
    (event) =>
      String(event.event || "")
        .trim()
        .toLowerCase() === "message_completed",
  )?.details?.elapsed_ms;
  const normalizedMessageCompletedElapsedMs = parseCountFromUnknown(
    messageCompletedElapsedMs,
  );

  return {
    traceId,
    startedAt: response.started_at || previousTimeline?.startedAt,
    completedAt: response.completed_at || previousTimeline?.completedAt,
    // Keep elapsed time anchored to message completion so auto-commit time is excluded.
    elapsedMs:
      normalizedMessageCompletedElapsedMs ??
      previousTimeline?.elapsedMs ??
      (typeof response.elapsed_ms === "number"
        ? response.elapsed_ms
        : undefined),
    done: response.done,
    detailMode,
    presentationMode,
    steps: mergeTimelineSteps(
      previousTimeline?.steps ?? [],
      response.events,
      presentationMode,
    ),
  };
};

export const normalizeTimelineForDisplay = (
  timeline?: RoadmapAiActivityTimeline | null,
  presentationMode: RoadmapAiActivityPresentationMode = PROGRESS_PRESENTATION_MODE,
): RoadmapAiActivityTimeline | null => {
  if (!timeline) return null;
  const normalizedSteps = timeline.steps
    .map((step) =>
      normalizeActivityStep(
        {
          seq: step.seq,
          ts: step.ts,
          event: step.event,
          title: step.title,
          status: step.status,
          summary: step.summary,
          details: step.details,
          titleList: step.titleList,
        },
        presentationMode,
      ),
    )
    .filter((step): step is RoadmapAiActivityStep => step != null);
  return {
    ...timeline,
    detailMode: PROGRESS_DETAIL_MODE,
    presentationMode,
    steps: normalizedSteps,
  };
};

const computeElapsedMs = (
  startedAt?: string,
  completedAt?: string,
): number | undefined => {
  if (!startedAt || !completedAt) return undefined;
  const startedMs = Date.parse(startedAt);
  const completedMs = Date.parse(completedAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(completedMs)) {
    return undefined;
  }
  return Math.max(0, Math.round(completedMs - startedMs));
};

export const ensureTimelineCompleted = (
  timeline: RoadmapAiActivityTimeline,
  completedAtIso = new Date().toISOString(),
): RoadmapAiActivityTimeline => {
  const completedAt = timeline.completedAt || completedAtIso;
  return {
    ...timeline,
    done: true,
    completedAt,
    elapsedMs:
      typeof timeline.elapsedMs === "number"
        ? timeline.elapsedMs
        : computeElapsedMs(timeline.startedAt, completedAt),
  };
};

export const getDefaultTimelineExpanded = (
  timelineDone: boolean,
  explicitValue?: boolean,
): boolean => {
  if (typeof explicitValue === "boolean") {
    return explicitValue;
  }
  return !timelineDone;
};

export const shouldRenderThinkingFallback = (
  isSending: boolean,
  hasLiveActivity: boolean,
  tracePollingFailed: boolean,
): boolean => isSending && (!hasLiveActivity || tracePollingFailed);

const isTraceNotReadyError = (error: unknown): boolean => {
  if (error instanceof RoadmapAgentServiceError) {
    return error.statusCode === 404;
  }
  if (error instanceof Error) {
    return /trace_events_not_found|404/i.test(error.message);
  }
  return false;
};

function SkeletonBlock({
  className,
  style,
}: {
  className: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`rounded-md bg-gray-200 animate-pulse ${className}`}
      style={style}
    />
  );
}

const SKELETON_ROWS: Array<{ role: "user" | "assistant"; lines: number[] }> = [
  { role: "assistant", lines: [75, 55, 40] },
  { role: "user",      lines: [60] },
  { role: "assistant", lines: [85, 65] },
  { role: "user",      lines: [50] },
  { role: "assistant", lines: [80, 60, 45, 30] },
];

function ThreadHistorySkeleton() {
  return (
    <div className="space-y-3">
      {SKELETON_ROWS.map((row, i) =>
        row.role === "user" ? (
          <div key={i} className="ml-8 mr-0">
            <div className="rounded-lg px-3.5 py-2.5 border border-orange-100 bg-orange-50/60 space-y-2">
              <SkeletonBlock className="h-2.5 bg-orange-200/70" style={{ width: `${row.lines[0]}%` }} />
            </div>
          </div>
        ) : (
          <div key={i} className="ml-0 mr-4 px-0 py-1.5 space-y-2">
            <div className="flex items-center gap-1.5 mb-1">
              <SkeletonBlock className="h-2 w-12 bg-blue-200/60" />
            </div>
            {row.lines.map((w, j) => (
              <SkeletonBlock
                key={j}
                className="h-2.5"
                style={{ width: `${w}%` }}
              />
            ))}
          </div>
        ),
      )}
    </div>
  );
}

export function RoadmapAiAssistantPanel({
  projectId,
  roadmapId,
  baseRevision,
  roadmapSnapshot,
  isVisible = true,
}: RoadmapAiAssistantPanelProps) {
  const queryClient = useQueryClient();
  const activeThreadId = useActiveRoadmapAiThread(roadmapId);
  const setActiveThread = useRoadmapAiThreadsStore((s) => s.setActiveThread);
  const {
    messages,
    isLoading: isThreadLoading,
    appendMessage,
    updateMessage,
    persistTurn,
    rehydrateAgentSession,
  } = useRoadmapAiAssistantSession(roadmapId, activeThreadId);
  const createAiSession = useCreateRoadmapAiSession(roadmapId);
  const threadsList = useRoadmapAiSessionsList(roadmapId, { archived: false });
  const [isThreadMenuOpen, setIsThreadMenuOpen] = useState(false);
  const agentSessionsInitializedRef = useRef<Set<string>>(new Set());
  const toast = useToast();
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
  const [liveActivity, setLiveActivity] =
    useState<RoadmapAiActivityTimeline | null>(null);
  const [liveActivityExpanded, setLiveActivityExpanded] = useState(true);
  const [liveActivityHostMessageId, setLiveActivityHostMessageId] = useState<
    string | null
  >(null);
  const [tracePollingFailed, setTracePollingFailed] = useState(false);
  const [activityExpandedByMessageId, setActivityExpandedByMessageId] =
    useState<Record<string, boolean>>({});
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const pollLoopRef = useRef<PollLoopState | null>(null);
  const liveActivityRef = useRef<RoadmapAiActivityTimeline | null>(null);
  const autoCommitRefreshSeqByTraceRef = useRef<Record<string, number>>({});

  const roadmapFromStore = useRoadmapStore((state) => state.roadmap);
  const canvasViewMode = useRoadmapStore((state) => state.canvasViewMode);
  const openArtifactTab = useRoadmapStore((state) => state.openArtifactTab);
  const applyArtifactSnapshot = useRoadmapStore(
    (state) => state.applyArtifactSnapshot,
  );
  const loadRoadmap = useRoadmapStore((state) => state.loadRoadmap);
  const currentRoadmap = roadmapSnapshot ?? roadmapFromStore ?? null;
  const roadmapLinkView =
    canvasViewMode === "milestones" ? "timelineView" : "roadmapView";

  const refreshRoadmapAfterAutoCommit = async () => {
    await queryClient.invalidateQueries({
      queryKey: projectKeys.roadmapFull(roadmapId),
      exact: true,
    });
    await queryClient.refetchQueries({
      queryKey: projectKeys.roadmapFull(roadmapId),
      exact: true,
      type: "active",
    });
    await loadRoadmap(roadmapId, { force: true });
  };

  const maybeRefreshRoadmapFromTraceEvents = async (
    traceId: string,
    events: AgentTraceEvent[],
  ) => {
    const completionSeq = events
      .filter((event) => event.event === "auto_commit_async_completed")
      .reduce<
        number | null
      >((max, event) => (max == null || event.seq > max ? event.seq : max), null);
    if (completionSeq == null) return;

    const alreadyRefreshedSeq =
      autoCommitRefreshSeqByTraceRef.current[traceId] ?? 0;
    if (completionSeq <= alreadyRefreshedSeq) return;
    autoCommitRefreshSeqByTraceRef.current[traceId] = completionSeq;

    try {
      await refreshRoadmapAfterAutoCommit();
    } catch (error) {
      console.warn(
        "[RoadmapAiAssistantPanel] roadmap_refresh_after_auto_commit_failed",
        {
          trace_id: traceId,
          roadmap_id: roadmapId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages.length, isSending, liveActivity?.steps.length]);

  useEffect(() => {
    if (!composerRef.current) return;
    composerRef.current.style.height = "0px";
    const nextHeight = Math.min(composerRef.current.scrollHeight, 160);
    composerRef.current.style.height = `${nextHeight}px`;
  }, [input]);

  useEffect(() => {
    liveActivityRef.current = liveActivity;
  }, [liveActivity]);

  useEffect(() => {
    return () => {
      const currentLoop = pollLoopRef.current;
      if (currentLoop?.timerId != null) {
        window.clearTimeout(currentLoop.timerId);
      }
      if (currentLoop) {
        currentLoop.cancelled = true;
      }
    };
  }, []);

  // Reset ephemeral UI state when the active thread changes, so live trace
  // events, toasts, and pending artifacts from the previous thread don't
  // leak into the new one. Also abort any in-flight poll loop.
  useEffect(() => {
    const currentLoop = pollLoopRef.current;
    if (currentLoop?.timerId != null) {
      window.clearTimeout(currentLoop.timerId);
    }
    if (currentLoop) {
      currentLoop.cancelled = true;
    }
    pollLoopRef.current = null;
    setLiveActivity(null);
    setLiveActivityExpanded(true);
    setLiveActivityHostMessageId(null);
    setErrorMessage(null);
    setTracePollingFailed(false);
    setPreviewArtifactId(null);
    setActivityExpandedByMessageId({});
    autoCommitRefreshSeqByTraceRef.current = {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId]);

  // Auto-select the most recent active thread on mount if none is selected —
  // the pop menu can still flip between threads later. Also reconciles a
  // stale persisted `activeThreadId` (from localStorage) against the current
  // server list so we don't hydrate a thread the user doesn't own anymore.
  useEffect(() => {
    const threads = threadsList.data;
    if (!threads) return;
    // While the list is refetching (e.g. immediately after createAiSession
    // invalidates the query), the cached data is stale. Skip reconciliation
    // so an explicitly-set activeThreadId (from handleCreateNewThread) isn't
    // overwritten by "ID not found in stale list → reset to first thread".
    if (threadsList.isFetching) return;
    if (activeThreadId) {
      const stillExists = threads.some((t) => t.id === activeThreadId);
      if (stillExists) return;
      if (threads.length > 0) {
        setActiveThread(roadmapId, threads[0].id);
      } else {
        setActiveThread(roadmapId, null);
      }
      return;
    }
    if (threads.length === 0) return;
    setActiveThread(roadmapId, threads[0].id);
  }, [activeThreadId, threadsList.data, threadsList.isFetching, roadmapId, setActiveThread]);

  // Returns the active thread id, creating a brand-new DB row + agent Redis
  // session if none exists. On Redis-TTL expiry of an existing thread, the
  // send-message path rehydrates via `rehydrateAgentSession` on 404 rather
  // than calling this.
  const ensureThread = async (): Promise<string> => {
    if (activeThreadId) {
      // Guarantee the agent has a Redis session for this thread — first hit
      // after a cold browser load, the DB row exists but Redis may not.
      if (!agentSessionsInitializedRef.current.has(activeThreadId)) {
        try {
          await roadmapAgentService.createSession({
            session_id: activeThreadId,
            roadmap_id: roadmapId,
            base_revision: baseRevision,
          });
          agentSessionsInitializedRef.current.add(activeThreadId);
        } catch (err) {
          // Non-fatal — the send call below will surface any real error.
          console.warn(
            "[RoadmapAiAssistantPanel] agent createSession precheck failed",
            err,
          );
        }
      }
      return activeThreadId;
    }
    const dbRow = await createAiSession.mutateAsync({});
    await roadmapAgentService.createSession({
      session_id: dbRow.id,
      roadmap_id: roadmapId,
      base_revision: baseRevision,
    });
    agentSessionsInitializedRef.current.add(dbRow.id);
    setActiveThread(roadmapId, dbRow.id);
    return dbRow.id;
  };

  // Detect 404-from-agent (Redis miss) and recreate the session with the
  // last N messages from the DB so the planner has context before retry.
  const rehydrateAndRetry = async <T,>(
    threadId: string,
    seedMessages: Array<{ role: string; content: string }>,
    op: () => Promise<T>,
  ): Promise<T> => {
    try {
      return await op();
    } catch (err) {
      const isNotFound =
        err instanceof RoadmapAgentServiceError && err.statusCode === 404;
      if (!isNotFound) throw err;
      await rehydrateAgentSession(seedMessages, { roadmapId, baseRevision });
      agentSessionsInitializedRef.current.add(threadId);
      return op();
    }
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

  const progressDetailMode: RoadmapAiActivityDetailMode = PROGRESS_DETAIL_MODE;
  const progressPresentationMode: RoadmapAiActivityPresentationMode =
    PROGRESS_PRESENTATION_MODE;

  const stopActivePollLoop = () => {
    const loop = pollLoopRef.current;
    if (!loop) return;
    loop.cancelled = true;
    if (loop.timerId != null) {
      window.clearTimeout(loop.timerId);
    }
    pollLoopRef.current = null;
  };

  const pollTraceEvents = async (loop: PollLoopState): Promise<void> => {
    if (loop.cancelled) return;
    if (Date.now() - loop.startedAtMs > TRACE_POLL_TIMEOUT_MS) {
      loop.pollingFailed = true;
      setTracePollingFailed(true);
      return;
    }

    try {
      const response = await roadmapAgentService.getTraceEvents(
        loop.sessionId,
        loop.traceId,
        {
          afterSeq: loop.afterSeq,
          limit: TRACE_POLL_LIMIT,
          detail: progressDetailMode,
        },
      );
      if (loop.cancelled) return;
      loop.afterSeq = Math.max(loop.afterSeq, response.next_seq);
      setLiveActivity((prev) =>
        toTimelineFromTraceResponse(
          progressDetailMode,
          loop.traceId,
          response,
          prev,
          progressPresentationMode,
        ),
      );
      await maybeRefreshRoadmapFromTraceEvents(loop.traceId, response.events);
      if (response.done) {
        return;
      }
      loop.timerId = window.setTimeout(() => {
        void pollTraceEvents(loop);
      }, TRACE_POLL_INTERVAL_MS);
    } catch (error) {
      if (loop.cancelled) return;
      const elapsedSinceStartMs = Date.now() - loop.startedAtMs;
      if (
        isTraceNotReadyError(error) &&
        elapsedSinceStartMs < TRACE_NOT_READY_GRACE_MS
      ) {
        loop.timerId = window.setTimeout(() => {
          void pollTraceEvents(loop);
        }, TRACE_POLL_INTERVAL_MS);
        return;
      }
      loop.pollingFailed = true;
      setTracePollingFailed(true);
      console.warn("[RoadmapAiAssistantPanel] trace_poll_failed", {
        session_id: loop.sessionId,
        trace_id: loop.traceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const startTracePolling = (activeSessionId: string, traceId: string) => {
    stopActivePollLoop();
    const startedAt = new Date().toISOString();
    const loop: PollLoopState = {
      traceId,
      sessionId: activeSessionId,
      afterSeq: 0,
      startedAtMs: Date.now(),
      cancelled: false,
      timerId: null,
      pollingFailed: false,
    };
    pollLoopRef.current = loop;
    setTracePollingFailed(false);
    setLiveActivityExpanded(true);
    setLiveActivityHostMessageId(null);
    setLiveActivity({
      traceId,
      startedAt,
      done: false,
      detailMode: progressDetailMode,
      presentationMode: progressPresentationMode,
      steps: [],
    });
    void pollTraceEvents(loop);
  };

  const finalizeTraceTimeline = (
    assistantMessageId: string,
    traceId: string,
  ) => {
    const loop = pollLoopRef.current;
    if (!loop || loop.traceId !== traceId) {
      const existingTimeline = liveActivityRef.current;
      if (existingTimeline && existingTimeline.traceId === traceId) {
        const completedTimeline = ensureTimelineCompleted(existingTimeline);
        updateMessage(assistantMessageId, (message) => {
          const resolvedCommitLifecycleRaw = resolveCommitLifecycleFromTimeline(
            completedTimeline,
            message.artifacts ?? [],
          );
          const resolvedCommitLifecycle =
            resolvedCommitLifecycleRaw?.state === "committed" &&
            resolvedCommitLifecycleRaw.impactedItems.length === 0 &&
            (message.commitLifecycle?.impactedItems.length ?? 0) > 0
              ? {
                  ...resolvedCommitLifecycleRaw,
                  impactedItems: message.commitLifecycle?.impactedItems ?? [],
                }
              : resolvedCommitLifecycleRaw;
          const fallbackCommitLifecycle =
            !resolvedCommitLifecycle &&
            message.commitLifecycle?.state === "committing"
              ? {
                  ...message.commitLifecycle,
                  state: "failed" as const,
                  updatedAt:
                    completedTimeline.completedAt || new Date().toISOString(),
                }
              : message.commitLifecycle;
          return {
            ...message,
            activityTimeline: completedTimeline,
            commitLifecycle: resolvedCommitLifecycle ?? fallbackCommitLifecycle,
          };
        });
        setActivityExpandedByMessageId((prev) => ({
          ...prev,
          [assistantMessageId]: false,
        }));
      }
      setLiveActivity(null);
      setLiveActivityExpanded(false);
      setLiveActivityHostMessageId(null);
      return;
    }

    const finish = async () => {
      // 30s accommodates slow Vercel cold-start commits (observed 10-15s).
      // The backend sets `trace.done=true` on auto_commit_async_completed
      // or auto_commit_async_failed, so we usually break well before this
      // deadline. When we do hit it, `resolveCommitLifecycleFromTimeline`
      // keeps the UI in "committing" (not "failed") for enqueued-but-not-yet-
      // completed commits — avoids a false-negative toast.
      const deadline = Date.now() + 30_000;
      // Track the latest computed timeline locally so the finalize block
      // below doesn't depend on `liveActivityRef.current` being synced.
      // The ref is updated via a useEffect after render, so when the loop
      // breaks synchronously on `response.done`, the ref still holds the
      // previous iteration's timeline — missing the just-arrived
      // auto_commit_async_completed event. That stale read triggers the
      // `commitLifecycle: 'failed'` fallback even when the commit actually
      // succeeded.
      let latestTimeline: RoadmapAiActivityTimeline | null =
        liveActivityRef.current;
      while (!loop.cancelled && Date.now() < deadline) {
        if (loop.pollingFailed) break;
        try {
          const response = await roadmapAgentService.getTraceEvents(
            loop.sessionId,
            loop.traceId,
            {
              afterSeq: loop.afterSeq,
              limit: TRACE_POLL_LIMIT,
              detail: progressDetailMode,
            },
          );
          if (loop.cancelled) return;
          loop.afterSeq = Math.max(loop.afterSeq, response.next_seq);
          setLiveActivity((prev) => {
            const next = toTimelineFromTraceResponse(
              progressDetailMode,
              loop.traceId,
              response,
              prev,
              progressPresentationMode,
            );
            latestTimeline = next;
            return next;
          });
          await maybeRefreshRoadmapFromTraceEvents(
            loop.traceId,
            response.events,
          );
          if (response.done) break;
        } catch (error) {
          if (
            isTraceNotReadyError(error) &&
            Date.now() - loop.startedAtMs < TRACE_NOT_READY_GRACE_MS
          ) {
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, TRACE_POLL_INTERVAL_MS);
            });
            continue;
          }
          loop.pollingFailed = true;
          setTracePollingFailed(true);
          break;
        }
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, TRACE_POLL_INTERVAL_MS);
        });
      }

      if (loop.timerId != null) {
        window.clearTimeout(loop.timerId);
      }
      loop.cancelled = true;
      if (pollLoopRef.current === loop) {
        pollLoopRef.current = null;
      }

      const timeline = latestTimeline ?? liveActivityRef.current;
      if (
        timeline &&
        timeline.traceId === traceId &&
        timeline.steps.length > 0
      ) {
        const completedTimeline = ensureTimelineCompleted(timeline);
        updateMessage(assistantMessageId, (message) => {
          const resolvedCommitLifecycleRaw = resolveCommitLifecycleFromTimeline(
            completedTimeline,
            message.artifacts ?? [],
          );
          const resolvedCommitLifecycle =
            resolvedCommitLifecycleRaw?.state === "committed" &&
            resolvedCommitLifecycleRaw.impactedItems.length === 0 &&
            (message.commitLifecycle?.impactedItems.length ?? 0) > 0
              ? {
                  ...resolvedCommitLifecycleRaw,
                  impactedItems: message.commitLifecycle?.impactedItems ?? [],
                }
              : resolvedCommitLifecycleRaw;
          const fallbackCommitLifecycle =
            !resolvedCommitLifecycle &&
            message.commitLifecycle?.state === "committing"
              ? {
                  ...message.commitLifecycle,
                  state: "failed" as const,
                  updatedAt:
                    completedTimeline.completedAt || new Date().toISOString(),
                }
              : message.commitLifecycle;
          return {
            ...message,
            activityTimeline: completedTimeline,
            commitLifecycle: resolvedCommitLifecycle ?? fallbackCommitLifecycle,
          };
        });
        setActivityExpandedByMessageId((prev) => ({
          ...prev,
          [assistantMessageId]: false,
        }));
      }
      setLiveActivity(null);
      setLiveActivityExpanded(false);
      setLiveActivityHostMessageId(null);
    };

    void finish();
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

    setIsSending(true);
    setTracePollingFailed(false);
    let activeSessionId: string | null = null;
    let traceId: string | null = null;
    let assistantId: string | null = null;
    try {
      // ensureThread must run first — if there is no activeThreadId yet (first
      // message), it creates the DB row and calls setActiveThread so the hook's
      // threadId is non-null before appendMessage fires. Calling appendMessage
      // before this resolves silently drops the message (threadId === null
      // hits the early return in useRoadmapAiAssistantSession).
      activeSessionId = await ensureThread();
      appendMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: trimmedMessage || "Attached files",
        timestamp: new Date().toISOString(),
        attachments: attachmentMetadata,
      });
      traceId = crypto.randomUUID();
      // Persist the user turn BEFORE calling the agent so it survives an
      // agent failure (matches ChatGPT retry UX). The response includes the
      // last N messages we can replay if the agent's Redis session expired.
      const { seed_messages: seedMessagesForRetry } = await persistTurn(
        "user",
        agentMessage,
      );
      startTracePolling(activeSessionId, traceId);

      const boundSessionId = activeSessionId;
      const response = await rehydrateAndRetry(
        boundSessionId,
        seedMessagesForRetry,
        () =>
          roadmapAgentService.sendMessage(
            boundSessionId,
            {
              message: agentMessage,
            },
            {
              traceId: traceId ?? undefined,
            },
          ),
      );
      const effectiveTraceId = response.debug_trace_id || traceId;
      if (effectiveTraceId !== traceId) {
        traceId = effectiveTraceId;
        startTracePolling(activeSessionId, effectiveTraceId);
      }

      setLiveActivity((prev) => {
        if (!prev) return prev;
        if (prev.traceId !== traceId) return prev;
        return ensureTimelineCompleted(prev);
      });

      assistantId = crypto.randomUUID();
      setLiveActivityHostMessageId(assistantId);
      const shouldTrackCommitLifecycle =
        response.response_mode === "edit_plan" &&
        ((response.staged_operations_count ?? 0) > 0 ||
          (response.operations?.length ?? 0) > 0);
      const initialCommitImpactedItems = parseCommitImpactedItemsFromOperations(
        response.operations,
      );
      appendMessage({
        ...buildAssistantMessage(
          response.assistant_message || "I analyzed your request.",
          response.parse_mode || "agent_response",
          {
            intentType: response.intent_type,
            responseMode: response.response_mode,
            artifacts: [],
            commitLifecycle: shouldTrackCommitLifecycle
              ? {
                  state: "committing",
                  impactedItems: initialCommitImpactedItems,
                  updatedAt: new Date().toISOString(),
                }
              : undefined,
          },
        ),
        id: assistantId,
      });

      // Persist the assistant turn to the DB. Fire-and-forget so slow
      // Supabase writes never block artifact hydration or the live trace.
      // Artifact snapshots evolve after this point via updateMessage (live
      // trace, commit lifecycle), but those updates are ephemeral UI state
      // and don't round-trip to the DB — past threads still render fine
      // since the assistant text + intent + response_mode are persisted.
      void persistTurn("assistant", response.assistant_message || "", {
        intentType: response.intent_type,
        responseMode: response.response_mode,
        parseMode: response.parse_mode || "agent_response",
        tokens: undefined,
      }).catch((err) => {
        console.warn(
          "[RoadmapAiAssistantPanel] assistant message persistence failed",
          err,
        );
      });

      try {
        const artifacts = await hydrateArtifacts(activeSessionId, response);
        if (artifacts.length > 0) {
          const commitLifecycleFromArtifacts = artifacts.some(
            (artifact) => artifact.status === "applied",
          )
            ? {
                state: "committed" as const,
                impactedItems: toAppliedArtifactImpactedItems(artifacts),
                updatedAt: new Date().toISOString(),
              }
            : undefined;
          updateMessage(assistantId, (message) => ({
            ...message,
            artifacts,
            commitLifecycle: commitLifecycleFromArtifacts
              ? {
                  ...commitLifecycleFromArtifacts,
                  impactedItems:
                    commitLifecycleFromArtifacts.impactedItems.length > 0
                      ? commitLifecycleFromArtifacts.impactedItems
                      : (message.commitLifecycle?.impactedItems ?? []),
                }
              : message.commitLifecycle,
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
          trace_id: traceId,
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
      stopActivePollLoop();
      setLiveActivity(null);
      setLiveActivityExpanded(false);
      setLiveActivityHostMessageId(null);
    } finally {
      setIsSending(false);
      if (assistantId && traceId) {
        finalizeTraceTimeline(assistantId, traceId);
      }
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

    const activeSessionId = activeThreadId;
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
      updateMessage(messageId, (message) => {
        const nextArtifacts: RoadmapArtifactPreview[] = (
          message.artifacts ?? []
        ).map((entry) =>
          entry.artifactId === artifact.artifactId
            ? {
                ...entry,
                status: "applied" as const,
                changeId: committedChangeId || entry.changeId,
              }
            : entry,
        );
        return {
          ...message,
          artifacts: nextArtifacts,
          commitLifecycle: {
            state: "committed",
            impactedItems: toAppliedArtifactImpactedItems(nextArtifacts),
            updatedAt: new Date().toISOString(),
          },
        };
      });
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
    if (!activeThreadId) {
      toast.error("Missing AI session. Send a message first, then retry.");
      return;
    }

    setApplyingArtifactIds((prev) => {
      const next = new Set(prev);
      next.add(artifact.artifactId);
      return next;
    });

    try {
      await roadmapAgentService.discardSession(activeThreadId, {
        change_id: artifact.changeId,
      });
      await loadRoadmap(roadmapId, { force: true });
      updateMessage(messageId, (message) => {
        const nextArtifacts: RoadmapArtifactPreview[] = (
          message.artifacts ?? []
        ).map((entry) =>
          entry.changeId === artifact.changeId
            ? { ...entry, status: "discarded" as const }
            : entry,
        );
        const impactedItems = toAppliedArtifactImpactedItems(nextArtifacts);
        return {
          ...message,
          artifacts: nextArtifacts,
          commitLifecycle:
            impactedItems.length > 0
              ? {
                  state: "committed",
                  impactedItems,
                  updatedAt: new Date().toISOString(),
                }
              : message.commitLifecycle,
        };
      });
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
    if (!activeThreadId) {
      toast.error("Missing AI session. Send a message first, then retry.");
      return;
    }

    setApplyingArtifactIds((prev) => {
      const next = new Set(prev);
      next.add(artifact.artifactId);
      return next;
    });

    try {
      await roadmapAgentService.rollbackSession(activeThreadId, {
        change_id: artifact.changeId,
      });
      await loadRoadmap(roadmapId, { force: true });
      updateMessage(messageId, (message) => {
        const nextArtifacts: RoadmapArtifactPreview[] = (
          message.artifacts ?? []
        ).map((entry) =>
          entry.changeId === artifact.changeId
            ? { ...entry, status: "applied" as const }
            : entry,
        );
        return {
          ...message,
          artifacts: nextArtifacts,
          commitLifecycle: {
            state: "committed",
            impactedItems: toAppliedArtifactImpactedItems(nextArtifacts),
            updatedAt: new Date().toISOString(),
          },
        };
      });
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

  const isMessageActivityExpanded = (
    messageId: string,
    timeline: RoadmapAiActivityTimeline,
  ): boolean => {
    return getDefaultTimelineExpanded(
      timeline.done,
      activityExpandedByMessageId[messageId],
    );
  };

  const toggleMessageActivity = (
    messageId: string,
    timeline: RoadmapAiActivityTimeline,
  ) => {
    setActivityExpandedByMessageId((prev) => {
      const current =
        typeof prev[messageId] === "boolean" ? prev[messageId] : !timeline.done;
      return {
        ...prev,
        [messageId]: !current,
      };
    });
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

  const displayLiveTimeline = normalizeTimelineForDisplay(
    liveActivity,
    progressPresentationMode,
  );
  const isLiveTimelineAnchoredInMessage = Boolean(
    displayLiveTimeline &&
    liveActivityHostMessageId &&
    messages.some((message) => message.id === liveActivityHostMessageId),
  );

  if (!isVisible) {
    return null;
  }

  const activeThreadLabel = (() => {
    if (!activeThreadId) return "New thread";
    const thread = threadsList.data?.find((t) => t.id === activeThreadId);
    const title = thread?.title?.trim();
    return title && title.length > 0 ? title : "Untitled";
  })();

  const handleSelectThread = (threadId: string) => {
    if (threadId === activeThreadId) return;
    setActiveThread(roadmapId, threadId);
  };

  const handleCreateNewThread = async () => {
    try {
      const row = await createAiSession.mutateAsync({});
      await roadmapAgentService.createSession({
        session_id: row.id,
        roadmap_id: roadmapId,
        base_revision: baseRevision,
      });
      agentSessionsInitializedRef.current.add(row.id);
      setActiveThread(roadmapId, row.id);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create new thread.";
      toast.error(message);
    }
  };

  return (
    <section
      className="h-full w-full bg-white border-l border-gray-200 overflow-hidden flex flex-col"
      aria-label="AI Assistant Panel"
    >
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2 bg-white">
        <div className="flex items-center gap-2 min-w-0">
          <Bot size={14} className="text-blue-500 shrink-0" />
          <span className="text-xs font-semibold text-gray-800">
            AI Assistant
          </span>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsThreadMenuOpen((prev) => !prev)}
            className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
            aria-haspopup="dialog"
            aria-expanded={isThreadMenuOpen}
          >
            <span className="max-w-[140px] truncate">{activeThreadLabel}</span>
            <ChevronDown size={12} />
          </button>
          <AnimatePresence>
            {isThreadMenuOpen && (
              <RoadmapAiThreadList
                roadmapId={roadmapId}
                activeThreadId={activeThreadId}
                onSelectThread={handleSelectThread}
                onCreateNewThread={handleCreateNewThread}
                onClose={() => setIsThreadMenuOpen(false)}
              />
            )}
          </AnimatePresence>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3 bg-gray-50/40 relative [scrollbar-width:thin] [scrollbar-color:rgba(156,163,175,0.5)_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-400 [&::-webkit-scrollbar-thumb]:rounded-full hover:[scrollbar-color:rgba(107,114,128,0.7)_transparent] hover:[&::-webkit-scrollbar-thumb]:bg-gray-500">
        {isThreadLoading ? (
          <ThreadHistorySkeleton />
        ) : messages.length === 0 ? (
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
            const commitLifecycle = message.commitLifecycle;
            const groupedCommitItems = commitLifecycle
              ? groupCommitImpactedItems(commitLifecycle.impactedItems)
              : null;
            const persistedActivityTimeline = normalizeTimelineForDisplay(
              message.activityTimeline,
              progressPresentationMode,
            );
            const isLiveTimelineHostMessage =
              message.role === "assistant" &&
              Boolean(displayLiveTimeline) &&
              message.id === liveActivityHostMessageId;
            const activityTimeline =
              isLiveTimelineHostMessage && displayLiveTimeline
                ? displayLiveTimeline
                : persistedActivityTimeline;
            const shouldCollapseForCommitLifecycle =
              message.role === "assistant" && Boolean(commitLifecycle);
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
                {message.role === "assistant" && activityTimeline && (
                  <div className="mb-2">
                    <RoadmapAiActivityTimelineView
                      timeline={activityTimeline}
                      expanded={
                        shouldCollapseForCommitLifecycle
                          ? (activityExpandedByMessageId[message.id] ?? false)
                          : isLiveTimelineHostMessage && !activityTimeline.done
                            ? true
                            : isMessageActivityExpanded(
                                message.id,
                                activityTimeline,
                              )
                      }
                      onToggle={() => {
                        if (
                          !shouldCollapseForCommitLifecycle &&
                          isLiveTimelineHostMessage &&
                          !activityTimeline.done
                        ) {
                          return;
                        }
                        toggleMessageActivity(message.id, activityTimeline);
                      }}
                    />
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

                {message.role === "assistant" && commitLifecycle && (
                  <div className="mt-2 rounded-md border border-gray-200 bg-white px-2.5 py-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-700">
                      {commitLifecycle.state === "committing" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-orange-500" />
                      ) : commitLifecycle.state === "committed" ? (
                        <Check className="h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <TriangleAlert className="h-3.5 w-3.5 text-red-600" />
                      )}
                      <span>
                        {getCommitLifecycleLabel(commitLifecycle.state)}
                      </span>
                    </div>

                    {commitLifecycle.state === "failed" && (
                      <p className="mt-1 text-[10px] text-red-700">
                        Auto-commit did not finish. You can still review the
                        suggested artifact and apply it manually.
                      </p>
                    )}

                    {commitLifecycle.state === "committed" &&
                      groupedCommitItems &&
                      commitLifecycle.impactedItems.length > 0 && (
                        <div className="mt-1.5 space-y-1.5">
                          {COMMIT_IMPACT_KIND_ORDER.map((kind) => {
                            const items = groupedCommitItems[kind];
                            if (!items.length) return null;
                            return (
                              <div key={`${message.id}-${kind}`}>
                                <p className="text-[10px] font-medium text-gray-700">
                                  {COMMIT_IMPACT_KIND_LABEL[kind]} (
                                  {items.length})
                                </p>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {items.map((item) => (
                                    <Link
                                      key={`${message.id}-${kind}-${item.nodeType}-${item.nodeId}`}
                                      to="/project/$projectId/roadmap/$roadmapId"
                                      params={{ projectId, roadmapId }}
                                      search={{
                                        nodeId: item.nodeId,
                                        view: roadmapLinkView,
                                      }}
                                      className="inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] text-orange-700 hover:bg-orange-100"
                                    >
                                      {item.title ||
                                        `${item.nodeType} ${item.nodeId.slice(0, 8)}`}
                                    </Link>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
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

        {displayLiveTimeline &&
        !tracePollingFailed &&
        !isLiveTimelineAnchoredInMessage ? (
          <div className="mr-4">
            <RoadmapAiActivityTimelineView
              timeline={displayLiveTimeline}
              expanded={displayLiveTimeline.done ? liveActivityExpanded : true}
              onToggle={() => {
                if (!displayLiveTimeline.done) return;
                setLiveActivityExpanded((prev) => !prev);
              }}
            />
          </div>
        ) : shouldRenderThinkingFallback(
            isSending,
            Boolean(liveActivity),
            tracePollingFailed,
          ) ? (
          <div className="rounded-xl px-3 py-2.5 border border-gray-200 bg-white mr-4 text-xs text-gray-600">
            Thinking...
          </div>
        ) : null}

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
