import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  applyNodeChanges,
  type Node,
  type Edge,
  type NodeTypes,
  type ReactFlowInstance,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useDraggable } from "@dnd-kit/core";
import { useRoadmapStore } from "@/stores/roadmapStore";
import { useShallow } from "zustand/react/shallow";
import { GripHorizontal, Layers3, ListTodo } from "lucide-react";
import { EpicWidget, type EpicWidgetData } from "../../widgets/EpicWidget";
import { EpicReorderConfirmModal } from "../../panels/EpicReorderConfirmModal";
import { FeatureReorderConfirmModal } from "../../panels/FeatureReorderConfirmModal";
import { FeatureMoveConfirmModal } from "../../panels/FeatureMoveConfirmModal";
import {
  FeatureWidget,
  type FeatureWidgetData,
} from "../../widgets/FeatureWidget";
import type {
  FeatureStatus,
  Roadmap,
  RoadmapEpic,
  RoadmapFeature,
  RoadmapTask,
} from "@/types/roadmap";
import { deriveFeatureStatus } from "@/utils/featureStatus";
import type { RoadmapPerformanceMode } from "./models/types";
import {
  useRecentAssignees,
  type DockAvatar,
} from "@/hooks/useRecentAssignees";
import { teamTimeService } from "@/services/team-time.service";
import { useUser } from "@/stores/authStore";
import type {
  CollaboratorInfo,
  RemoteCursor,
  RemoteDrag,
} from "@/hooks/useRoadmapCollaboration";
import { CollaborationCursorsOverlay } from "@/components/roadmap/collaboration/CollaborationCursorsOverlay";
import { featureFlags } from "@/config/featureFlags";

const getAvatarInitials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

function ToolbarAssigneeChip({ avatar }: { avatar: DockAvatar }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `dock-avatar-${avatar.userId}`,
    data: {
      type: "assignee",
      userId: avatar.userId,
      displayName: avatar.displayName,
      avatarUrl: avatar.avatarUrl,
    },
  });

  const tooltip = avatar.isSelf
    ? `${avatar.displayName} (you)`
    : avatar.displayName;
  const ringClass = avatar.isSelf ? "ring-orange-400" : "ring-white";

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      title={`Drag to assign ${tooltip}`}
      aria-label={`Drag to assign ${tooltip}`}
      className={`relative shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 transition-opacity cursor-grab active:cursor-grabbing ${isDragging ? "opacity-40" : "opacity-100"
        }`}
    >
      {avatar.avatarUrl ? (
        <img
          src={avatar.avatarUrl}
          alt=""
          draggable={false}
          className={`w-7 h-7 rounded-full object-cover ring-2 ${ringClass} shadow-sm`}
        />
      ) : (
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold bg-linear-to-br from-slate-200 to-slate-300 text-slate-700 ring-2 ${ringClass} shadow-sm`}
        >
          {getAvatarInitials(avatar.displayName)}
        </div>
      )}
    </button>
  );
}

interface RoadmapViewProps {
  roadmap: Roadmap;
  epics: RoadmapEpic[];
  showMiniMap?: boolean;
  minZoom?: number;
  remoteCursors?: RemoteCursor[];
  /** Collaborators present in the room; those with `editingNodeId` set render
   * an "editing" badge on the matching epic/feature/task. */
  editors?: CollaboratorInfo[];
  onTrackCursor?: (x: number, y: number) => void;
  /** Active epic/feature drag by another collaborator (live preview). */
  remoteDrag?: RemoteDrag | null;
  onBroadcastNodeDragStart?: (p: {
    nodeId: string;
    type: "epic" | "feature";
    sourceEpicId?: string;
  }) => void;
  onBroadcastNodeDrag?: (p: {
    nodeId: string;
    type: "epic" | "feature";
    sourceEpicId?: string;
    x: number;
    y: number;
  }) => void;
  onBroadcastNodeDragEnd?: (nodeId: string, committed: boolean) => void;
  onPanStart?: () => void;
  onPanEnd?: () => void;
  onUpdateEpic: (epic: RoadmapEpic) => void;
  onDeleteEpic: (epicId: string) => void;
  onUpdateFeature: (feature: RoadmapFeature) => void;
  onDeleteFeature: (featureId: string) => void;
  onSelectFeature?: (feature: RoadmapFeature) => void;
  onSelectEpic?: (epicId: string) => void;
  onSelectTask?: (task: RoadmapTask) => void;
  onAddEpicBelow?: (epicId: string) => void;
  onAddFeature?: (epicId: string) => void;
  onAddTask?: (featureId: string) => void;
  onEditFeature?: (epicId: string, featureId: string) => void;
  onNavigateToEpic?: (epicId: string) => void;
  onUpdateTask: (task: RoadmapTask) => void;
  focusNodeId?: string | null;
  focusNodeOffsetX?: number;
  focusTaskId?: string | null;
  onFocusComplete?: () => void;
  performanceMode?: RoadmapPerformanceMode;
}

type StructuralEpicNodeData = {
  kind: "epic";
  epic: RoadmapEpic;
};

type StructuralFeatureNodeData = {
  kind: "feature";
  feature: RoadmapFeature & { epic_id: string };
};

type StructuralNodeData = StructuralEpicNodeData | StructuralFeatureNodeData;
type ToolbarItemType = "epic" | "feature" | "task";
const TOOLBAR_DRAG_MIME = "application/x-roadmap-toolbar-item";

const getEdgeColor = (status: FeatureStatus) => {
  switch (status) {
    case "completed":
      return "#22c55e";
    case "in_progress":
      return "#3b82f6";
    case "blocked":
      return "#ef4444";
    case "in_review":
      return "#a855f7";
    default:
      return "#9ca3af";
  }
};

const CANVAS_SKIP_EPIC_REORDER_KEY = "roadmap.canvas.skipEpicReorderConfirm";
const CANVAS_SKIP_FEATURE_REORDER_KEY = "roadmap.canvas.skipFeatureReorderConfirm";
const CANVAS_SKIP_FEATURE_MOVE_KEY = "roadmap.canvas.skipFeatureMoveConfirm";

type PendingCanvasDrag =
  | { kind: "epicReorder"; epicId: string; epicTitle: string; newEpicOrder: string[] }
  | { kind: "featureReorder"; featureId: string; featureTitle: string; epicId: string; newFeatureOrder: string[] }
  | { kind: "featureMove"; featureId: string; featureTitle: string; sourceEpicId: string; targetEpicId: string; targetEpicTitle: string; newTargetFeatureOrder: string[] };

// Custom layout configuration with centered epic positioning among features
const getLayoutedElements = (
  nodes: Node<StructuralNodeData>[],
  edges: Edge[],
  epics: RoadmapEpic[],
) => {
  const epicNodes = nodes.filter((node) => node.type === "epicWidget");
  const featureNodes = nodes.filter((node) => node.type === "featureWidget");

  const EPIC_X = 100;
  const FEATURE_X_OFFSET = 650; // Distance from epic to feature column
  const NODE_WIDTH = 500; // Fixed width for all nodes to simplify layout calculations
  const BASE_EPIC_HEIGHT = 220; // Base height for epics without descriptions or features
  const MAX_EPIC_HEIGHT = 420; // Max height for epics to prevent excessively tall nodes
  const DESCRIPTION_LINE_HEIGHT = 16; // Estimated line height for descriptions to calculate node height based on content
  const DESCRIPTION_CHARS_PER_LINE = 80; // Estimated characters per line for description text to calculate node height
  const BASE_FEATURE_HEIGHT = 150; // Base height for features without descriptions or tasks
  const MAX_FEATURE_HEIGHT = 300; // Max height for features to prevent excessively tall nodes
  const FEATURE_DESCRIPTION_LINE_HEIGHT = 16; // Estimated line height for feature descriptions to calculate node height based on content
  const FEATURE_DESCRIPTION_CHARS_PER_LINE = 70; // Estimated characters per line for feature description text to calculate node height
  const BASE_FEATURE_SPACING = 80; // Fallback spacing
  const MIN_FEATURE_SPACING = 40; // Minimum spacing when there are many features with large descriptions
  const MAX_FEATURE_SPACING = 200; // Maximum spacing when there are few features with small descriptions to prevent excessive gaps
  const FEATURE_SPACING_SCALE = 0.35; // Multiplier applied to average feature height when computing spacing
  const FEATURE_SPACING_BASE = 40; // Flat offset added to scaled height to compute spacing
  const GROUP_GAP_MIN = 120; // Minimum vertical gap between epic groups
  const GROUP_GAP_SCALE = 0.3; // Fraction of groupHeight added as gap between epic groups
  const sortedEpics = [...epics].sort((a, b) => a.position - b.position);
  const featureNodeMap = new Map(featureNodes.map((node) => [node.id, node]));

  const positionedEpicNodes: Node<StructuralNodeData>[] = [];
  const positionedFeatureNodes: Node<StructuralNodeData>[] = [];

  let currentY = 100;

  sortedEpics.forEach((epic) => {
    const epicNode = epicNodes.find((node) => node.id === epic.id);
    if (!epicNode) return;

    const featureIds = (epic.features || [])
      .map((feature) => feature.id)
      .filter((id) => featureNodeMap.has(id));

    const featureCount = featureIds.length;
    const featureHeights = (epic.features || [])
      .filter((feature) => featureIds.includes(feature.id))
      .map((feature) => {
        const featureDescriptionLength = feature.description?.length ?? 0;
        const featureEstimatedLines = Math.ceil(
          featureDescriptionLength / FEATURE_DESCRIPTION_CHARS_PER_LINE,
        );
        const featureEstimatedDescriptionHeight = Math.min(
          featureEstimatedLines * FEATURE_DESCRIPTION_LINE_HEIGHT,
          MAX_FEATURE_HEIGHT - BASE_FEATURE_HEIGHT,
        );
        return Math.min(
          MAX_FEATURE_HEIGHT,
          BASE_FEATURE_HEIGHT + featureEstimatedDescriptionHeight,
        );
      });
    const descriptionLength = epic.description?.length ?? 0;
    const estimatedDescriptionLines = Math.ceil(
      descriptionLength / DESCRIPTION_CHARS_PER_LINE,
    );
    const estimatedDescriptionHeight = Math.min(
      estimatedDescriptionLines * DESCRIPTION_LINE_HEIGHT,
      MAX_EPIC_HEIGHT - BASE_EPIC_HEIGHT,
    );
    const epicHeight = Math.min(
      MAX_EPIC_HEIGHT,
      BASE_EPIC_HEIGHT + estimatedDescriptionHeight,
    );
    const averageFeatureHeight =
      featureHeights.length > 0
        ? featureHeights.reduce((sum, height) => sum + height, 0) /
        featureHeights.length
        : BASE_FEATURE_HEIGHT;
    const featureSpacing =
      featureCount > 1
        ? Math.min(
          MAX_FEATURE_SPACING,
          Math.max(
            MIN_FEATURE_SPACING,
            Math.round(
              averageFeatureHeight * FEATURE_SPACING_SCALE +
              FEATURE_SPACING_BASE,
            ),
          ),
        )
        : 0;
    const totalFeatureHeight =
      featureCount > 0
        ? featureHeights.reduce((sum, height) => sum + height, 0) +
        featureSpacing * (featureCount - 1)
        : 0;
    const groupHeight = Math.max(epicHeight, totalFeatureHeight);
    const groupGap = Math.max(
      GROUP_GAP_MIN,
      Math.round(groupHeight * GROUP_GAP_SCALE),
    );
    const epicCenterY = currentY + groupHeight / 2;
    const epicY = epicCenterY - epicHeight / 2;

    positionedEpicNodes.push({
      ...epicNode,
      width: NODE_WIDTH,
      height: epicHeight,
      position: { x: EPIC_X, y: epicY },
    });

    if (featureCount > 0) {
      let featureTopY = epicCenterY - totalFeatureHeight / 2;
      featureIds.forEach((featureId, index) => {
        const featureNode = featureNodeMap.get(featureId);
        if (!featureNode) return;
        const height = featureHeights[index] ?? BASE_FEATURE_HEIGHT;
        positionedFeatureNodes.push({
          ...featureNode,
          width: NODE_WIDTH,
          height,
          position: { x: EPIC_X + FEATURE_X_OFFSET, y: featureTopY },
        });
        featureTopY += height + featureSpacing;
      });
    }

    currentY += groupHeight + groupGap;
  });

  const positionedFeatureIds = new Set(
    positionedFeatureNodes.map((node) => node.id),
  );
  const orphanFeatureNodes = featureNodes.filter(
    (node) => !positionedFeatureIds.has(node.id),
  );

  orphanFeatureNodes.forEach((node) => {
    positionedFeatureNodes.push({
      ...node,
      width: NODE_WIDTH,
      height: BASE_FEATURE_HEIGHT,
      position: { x: EPIC_X + FEATURE_X_OFFSET, y: currentY },
    });
    currentY += BASE_FEATURE_SPACING;
  });

  const allLayoutedNodes = [...positionedEpicNodes, ...positionedFeatureNodes];

  return { nodes: allLayoutedNodes, edges };
};

export const RoadmapView = ({
  roadmap,
  epics,
  showMiniMap = true,
  minZoom = 0.4,
  remoteCursors = [],
  editors,
  onTrackCursor,
  remoteDrag,
  onBroadcastNodeDragStart,
  onBroadcastNodeDrag,
  onBroadcastNodeDragEnd,
  onPanStart,
  onPanEnd,
  onUpdateEpic,
  onDeleteEpic,
  onUpdateFeature: _onUpdateFeature,
  onDeleteFeature,
  onSelectFeature,
  onSelectEpic,
  onSelectTask,
  onAddEpicBelow,
  onAddFeature,
  onAddTask,
  onEditFeature,
  onNavigateToEpic,
  onUpdateTask,
  focusNodeId,
  focusTaskId,
  onFocusComplete,
  focusNodeOffsetX = 0,
  performanceMode = "normal",
}: RoadmapViewProps) => {
  const user = useUser();
  const DEFAULT_ZOOM = 0.67;
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [pulseNodeFocus, setPulseNodeFocus] = useState<{
    nodeId: string;
    token: number;
  } | null>(null);
  const [pulseTaskFocus, setPulseTaskFocus] = useState<{
    featureId: string;
    taskId: string;
    token: number;
  } | null>(null);
  const [reactFlowInstance, setReactFlowInstance] =
    useState<
      ReactFlowInstance<Node<EpicWidgetData | FeatureWidgetData>, Edge> | null
    >(null);

  const DEFAULT_VIEWPORT_X = -50;
  const DEFAULT_VIEWPORT_Y = 0;
  const MAX_ZOOM = 1.5;
  const runningLogQuery = useQuery({
    queryKey: ["team-time", "running-log", user?.id ?? "anonymous"],
    queryFn: () => teamTimeService.getMyRunningLog(),
    enabled: Boolean(user?.id),
    // Fast 3s poll only while a timer runs (to highlight the active task);
    // lazy 30s heartbeat otherwise, and never poll a hidden tab.
    refetchInterval: (query) => (query.state.data ? 3_000 : 30_000),
    refetchIntervalInBackground: false,
    retry: 1,
  });
  const runningTaskId = runningLogQuery.data?.task_id ?? null;
  const MIN_ZOOM = minZoom;
  const isReducedMotion = performanceMode === "reducedMotion";
  const [toolbarDraggingType, setToolbarDraggingType] =
    useState<ToolbarItemType | null>(null);

  const canEditRoadmap =
    !roadmap.currentUserRole ||
    roadmap.currentUserRole === "owner" ||
    roadmap.currentUserRole === "editor";

  const { reorderEpicsInRoadmap, reorderFeaturesInEpic, moveFeatureBetweenEpics } =
    useRoadmapStore(
      useShallow((s) => ({
        reorderEpicsInRoadmap: s.reorderEpicsInRoadmap,
        reorderFeaturesInEpic: s.reorderFeaturesInEpic,
        moveFeatureBetweenEpics: s.moveFeatureBetweenEpics,
      })),
    );

  // --- Canvas drag state ---
  // workingNodesRef is updated synchronously so onNodesChange can read it in the same event cycle
  const workingNodesRef = useRef<Node[] | null>(null);
  const [workingNodes, setWorkingNodes] = useState<Node[] | null>(null);
  const [dragState, setDragState] = useState<{
    nodeId: string;
    type: "epic" | "feature";
    sourceEpicId?: string;
  } | null>(null);
  const dragStateRef = useRef(dragState);
  dragStateRef.current = dragState;

  const workingEdgesRef = useRef<Edge[] | null>(null);
  const [workingEdges, setWorkingEdges] = useState<Edge[] | null>(null);
  // For epic drag: maps featureId → initial Y offset relative to the dragged epic
  const dragStartFeatureRelativeYsRef = useRef<Map<string, number> | null>(null);

  // --- Remote collaborator drag preview (read-only mirror of their reflow) ---
  const [remoteWorkingNodes, setRemoteWorkingNodes] = useState<Node[] | null>(
    null,
  );
  const [remoteWorkingEdges, setRemoteWorkingEdges] = useState<Edge[] | null>(
    null,
  );
  // Pre-drag snapshot captured when a remote drag begins, mirroring
  // dragStartNodesRef/dragStartFeatureRelativeYsRef for the local drag.
  const remoteDragSnapshotRef = useRef<{
    nodeId: string;
    nodes: Node[];
    relativeYs: Map<string, number> | null;
  } | null>(null);
  // The terminal remote-drag object already handled, so the commit/cancel
  // resolution runs exactly once even as the effect re-fires.
  const handledTerminalRef = useRef<RemoteDrag | null>(null);
  // Original node positions before any drag — used in onNodeDragStop so preview-animated
  // positions of non-dragged nodes don't contaminate the final order calculation
  const dragStartNodesRef = useRef<Node[] | null>(null);

  const [pendingCanvasDrag, setPendingCanvasDrag] = useState<PendingCanvasDrag | null>(null);
  const [isPersistingCanvasDrag, setIsPersistingCanvasDrag] = useState(false);
  const [dontAskEpicReorder, setDontAskEpicReorder] = useState(
    () => sessionStorage.getItem(CANVAS_SKIP_EPIC_REORDER_KEY) === "true",
  );
  const [dontAskFeatureReorder, setDontAskFeatureReorder] = useState(
    () => sessionStorage.getItem(CANVAS_SKIP_FEATURE_REORDER_KEY) === "true",
  );
  const [dontAskFeatureMove, setDontAskFeatureMove] = useState(
    () => sessionStorage.getItem(CANVAS_SKIP_FEATURE_MOVE_KEY) === "true",
  );

  const { avatars: assigneeAvatars } = useRecentAssignees(
    roadmap?.project_id ?? "",
  );

  const nodeTypes: NodeTypes = useMemo(
    () => ({
      epicWidget: EpicWidget,
      featureWidget: FeatureWidget,
    }),
    [],
  );

  // Captures only the properties that affect node positions/heights.
  // Task status/title changes don't affect layout, so this key is stable
  // during those updates — preventing unnecessary full-canvas recalculations.
  const layoutKey = useMemo(
    () =>
      epics
        .map((e) =>
          [
            e.id,
            e.position,
            e.description?.length ?? 0,
            (e.features || [])
              .map(
                (f) =>
                  `${f.id}:${f.position}:${f.description?.length ?? 0}:${(f.tasks || []).length}`,
              )
              .join(","),
          ].join("|"),
        )
        .join(";"),
    [epics],
  );

  const { layoutedNodes, edges, maxTaskCount } = useMemo(() => {
    const orderedEpics = [...epics]
      .sort((a, b) => a.position - b.position)
      .map((epic) => ({
        ...epic,
        features: [...(epic.features || [])]
          .sort((a, b) => a.position - b.position)
          .map((feature) => ({
            ...feature,
            tasks: [...(feature.tasks || [])].sort(
              (a, b) => a.position - b.position,
            ),
          })),
      }));

    let derivedMaxTaskCount = 0;
    const epicNodes: Node<StructuralNodeData>[] = orderedEpics.map((epic) => ({
      id: epic.id,
      type: "epicWidget",
      data: {
        kind: "epic",
        epic,
      },
      position: { x: 0, y: 0 },
    }));

    const allFeatures = orderedEpics.flatMap((epic) =>
      (epic.features || []).map((feature) => {
        const taskCount = feature.tasks?.length || 0;
        if (taskCount > derivedMaxTaskCount) {
          derivedMaxTaskCount = taskCount;
        }
        return {
          ...feature,
          epic_id: epic.id,
        };
      }),
    );

    const featureNodes: Node<StructuralNodeData>[] = allFeatures.map(
      (feature) => ({
        id: feature.id,
        type: "featureWidget",
        data: {
          kind: "feature",
          feature,
        },
        position: { x: 0, y: 0 },
      }),
    );

    const allNodes = [...epicNodes, ...featureNodes];

    const featureEdges: Edge[] = allFeatures.map((feature) => {
      const derivedStatus = deriveFeatureStatus(feature.tasks);
      return {
        id: `epic-feature-${feature.epic_id}-${feature.id}`,
        source: feature.epic_id,
        sourceHandle: "epic-right",
        target: feature.id,
        type: "simplebezier",
        animated: derivedStatus === "in_progress",
        style: {
          stroke: getEdgeColor(derivedStatus),
          strokeWidth: 2,
        },
      };
    });

    const epicEdges: Edge[] = [];
    for (let i = 0; i < orderedEpics.length - 1; i++) {
      epicEdges.push({
        id: `epic-chain-${orderedEpics[i].id}-${orderedEpics[i + 1].id}`,
        source: orderedEpics[i].id,
        sourceHandle: "epic-bottom",
        target: orderedEpics[i + 1].id,
        targetHandle: "epic-top",
        type: "simplebezier",
        animated: false,
        style: {
          stroke: "#9ca3af",
          strokeWidth: 2,
          strokeDasharray: "5,5",
        },
      });
    }

    const allEdges = [...epicEdges, ...featureEdges];

    const { nodes: positionedNodes, edges: positionedEdges } = getLayoutedElements(
      allNodes,
      allEdges,
      orderedEpics,
    );

    return {
      layoutedNodes: positionedNodes,
      edges: positionedEdges,
      maxTaskCount: derivedMaxTaskCount,
    };
    // layoutKey is a stable string that only changes when structure/positions
    // change — prevents full layout recalculation for task-content-only updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  // "Who is editing what": collapse the collaborator list into a node-id → editors
  // map. Keyed on a small signature so the node memo below only rebuilds when the
  // editing set actually changes — not on every unrelated presence/cursor update.
  const editingSignature = useMemo(
    () =>
      (editors ?? [])
        .filter((e) => e.editingNodeId)
        .map((e) => `${e.userId}:${e.editingNodeId}`)
        .sort()
        .join("|"),
    [editors],
  );
  const editorsByNodeId = useMemo(() => {
    const map = new Map<string, CollaboratorInfo[]>();
    for (const e of editors ?? []) {
      if (!e.editingNodeId) continue;
      const list = map.get(e.editingNodeId);
      if (list) list.push(e);
      else map.set(e.editingNodeId, [e]);
    }
    return map;
    // editingSignature is the meaningful change key (editors identity alone churns).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingSignature]);

  const nodes = useMemo(
    (): Node<EpicWidgetData | FeatureWidgetData>[] => {
      // layoutedNodes only recalculates when positions change (layoutKey).
      // For content-only changes (title, status, tasks) we look up fresh
      // epic/feature objects from the current epics array so widgets stay
      // in sync even when the layout didn't need to recompute.
      const epicById = new Map(epics.map((e) => [e.id, e]));
      const featureById = new Map(
        epics.flatMap((e) => e.features ?? []).map((f) => [f.id, f]),
      );

      return layoutedNodes.map((node) => {
        if (node.type === "epicWidget") {
          const epic =
            epicById.get(node.id) ??
            (node.data as StructuralEpicNodeData).epic;
          return {
            ...node,
            data: {
              epic,
              onEdit: onSelectEpic
                ? () => onSelectEpic(epic.id)
                : (updatedEpic) => onUpdateEpic(updatedEpic),
              onDelete: onDeleteEpic,
              onAddEpicBelow,
              onAddFeature,
              onNavigateToTab: onNavigateToEpic,
              pulseToken:
                pulseNodeFocus?.nodeId === epic.id
                  ? pulseNodeFocus.token
                  : undefined,
              toolbarDraggingType,
              performanceMode,
              canEditRoadmap,
              editors: editorsByNodeId.get(epic.id),
            } satisfies EpicWidgetData,
          };
        }

        const feature =
          featureById.get(node.id) ??
          (node.data as StructuralFeatureNodeData).feature;
        return {
          ...node,
          data: {
            feature,
            showTaskCount: true,
            onEdit: () => onEditFeature?.(feature.epic_id, feature.id),
            onDelete: onDeleteFeature,
            onClick: onSelectFeature,
            onAddTask,
            onSelectTask,
            onUpdateTask,
            runningTaskId,
            pulseTaskId:
              pulseTaskFocus?.featureId === feature.id
                ? pulseTaskFocus.taskId
                : null,
            pulseTaskToken:
              pulseTaskFocus?.featureId === feature.id
                ? pulseTaskFocus.token
                : undefined,
            pulseToken:
              pulseNodeFocus?.nodeId === feature.id
                ? pulseNodeFocus.token
                : undefined,
            toolbarDraggingType,
            performanceMode,
            canEditRoadmap,
            editors: editorsByNodeId.get(feature.id),
            // Same node-id→editors map; the task list looks up its own task ids.
            taskEditorsByNodeId: editorsByNodeId,
          } satisfies FeatureWidgetData,
        };
      });
    },
    [
      layoutedNodes,
      epics,
      onAddEpicBelow,
      onAddFeature,
      onAddTask,
      onDeleteEpic,
      onDeleteFeature,
      onEditFeature,
      onNavigateToEpic,
      onSelectEpic,
      onSelectFeature,
      onSelectTask,
      onUpdateEpic,
      onUpdateTask,
      performanceMode,
      pulseNodeFocus,
      pulseTaskFocus,
      toolbarDraggingType,
      canEditRoadmap,
      runningTaskId,
      editorsByNodeId,
    ],
  );

  useEffect(() => {
    if (!focusNodeId || !reactFlowInstance) {
      return;
    }

    const targetNode = reactFlowInstance.getNode(focusNodeId);
    if (!targetNode) {
      onFocusComplete?.();
      return;
    }

    const nodeWidth = Number(targetNode.width) || 500;
    const nodeHeight = Number(targetNode.height) || 220;
    const centerX = targetNode.position.x + nodeWidth / 2 + focusNodeOffsetX;
    const centerY = targetNode.position.y + nodeHeight / 2;

    const viewport = reactFlowInstance.getViewport?.();
    const nextZoom = viewport?.zoom ?? zoom;
    reactFlowInstance.setCenter(centerX, centerY, {
      zoom: nextZoom,
      duration: isReducedMotion ? 0 : 600,
    });

    setPulseNodeFocus((previous) => ({
      nodeId: focusNodeId,
      token:
        previous && previous.nodeId === focusNodeId ? previous.token + 1 : 1,
    }));

    if (focusTaskId) {
      setPulseTaskFocus((previous) => ({
        featureId: focusNodeId,
        taskId: focusTaskId,
        token:
          previous &&
            previous.featureId === focusNodeId &&
            previous.taskId === focusTaskId
            ? previous.token + 1
            : 1,
      }));
    } else {
      setPulseTaskFocus(null);
    }

    onFocusComplete?.();
  }, [
    focusNodeId,
    focusNodeOffsetX,
    focusTaskId,
    isReducedMotion,
    onFocusComplete,
    reactFlowInstance,
    zoom,
  ]);

  const extraRightPadding = useMemo(() => {
    if (maxTaskCount >= 60) return 2800;
    if (maxTaskCount >= 40) return 2400;
    if (maxTaskCount >= 20) return 2000;
    return 1200;
  }, [maxTaskCount]);

  const translateExtent = useMemo((): [[number, number], [number, number]] => {
    if (!layoutedNodes.length) {
      return [
        [-1000, -400],
        [2400, 800],
      ];
    }

    const xPositions = layoutedNodes.map((node) => node.position.x);
    const yPositions = layoutedNodes.map((node) => node.position.y);

    const NODE_WIDTH = 680;
    const minX = Math.min(...xPositions) - 400;
    const maxX = Math.max(...xPositions) + NODE_WIDTH + extraRightPadding;
    const minY = Math.min(...yPositions) - 240;
    const maxY = Math.max(...yPositions) + 720;

    return [
      [minX, minY],
      [maxX, maxY],
    ];
  }, [extraRightPadding, layoutedNodes]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!workingNodesRef.current) return;
      const updated = applyNodeChanges(changes, workingNodesRef.current);
      workingNodesRef.current = updated;
      setWorkingNodes(updated);
    },
    [],
  );

  const onEdgesChange = useCallback(() => {
    // Handle edge changes if needed
  }, []);

  // --- Canvas drag helpers ---

  const computeReorderedEpics = useCallback(
    (
      currentNodes: Node[],
      ds: { nodeId: string; type: "epic" | "feature"; sourceEpicId?: string },
      sourceEpics: RoadmapEpic[],
    ): RoadmapEpic[] => {
      const epicNodes = currentNodes.filter((n) => n.type === "epicWidget");
      const featureNodes = currentNodes.filter((n) => n.type === "featureWidget");

      if (!ds) return sourceEpics;

      if (ds.type === "epic") {
        // Sort epics by their current Y position to determine new order
        const sortedEpicIds = [...epicNodes]
          .sort((a, b) => a.position.y - b.position.y)
          .map((n) => n.id);
        const reorderedEpics: RoadmapEpic[] = [];
        for (let index = 0; index < sortedEpicIds.length; index++) {
          const epic = sourceEpics.find((e) => e.id === sortedEpicIds[index]);
          if (epic) reorderedEpics.push({ ...epic, position: index * 1000 });
        }
        return reorderedEpics;
      }

      // Feature drag:
      // - Non-dragged features stay anchored to their original epics.
      //   Reassigning them by Y proximity causes misassignment when they
      //   happen to be slightly closer to an adjacent epic's midpoint.
      // - Only the dragged feature is assigned to the closest epic.
      // - Insertion point within the target epic uses center-Y comparison
      //   (top-left Y is inaccurate for nodes that are 150–300 px tall).

      const draggedNode = featureNodes.find((n) => n.id === ds.nodeId);
      if (!draggedNode) return sourceEpics;

      const draggedH = (draggedNode.height as number) ?? 150;
      const draggedCenterY = draggedNode.position.y + draggedH / 2;

      // Find target epic for the dragged feature (closest center distance)
      let targetEpicId: string | null = null;
      let minDist = Infinity;
      for (const epicNode of epicNodes) {
        const epicMid = epicNode.position.y + ((epicNode.height as number) ?? 220) / 2;
        const dist = Math.abs(draggedCenterY - epicMid);
        if (dist < minDist) {
          minDist = dist;
          targetEpicId = epicNode.id;
        }
      }
      if (!targetEpicId) return sourceEpics;

      const allFeatures = sourceEpics.flatMap((e) => e.features ?? []);
      const draggedFeature = allFeatures.find((f) => f.id === ds.nodeId);

      // Epic order is derived from epic Y positions (handles epic reorder during the same session)
      const epicOrder = [...epicNodes]
        .sort((a, b) => a.position.y - b.position.y)
        .map((n) => n.id);

      const result: RoadmapEpic[] = [];
      for (let index = 0; index < epicOrder.length; index++) {
        const epicId = epicOrder[index];
        if (!epicId) continue;
        const epic = sourceEpics.find((e) => e.id === epicId);
        if (!epic) continue;

        // Original features for this epic, excluding the dragged one, in original position order
        const originalFeatures = (epic.features ?? [])
          .filter((f) => f.id !== ds.nodeId)
          .sort((a, b) => a.position - b.position);

        if (epicId !== targetEpicId) {
          // Features stay as-is (non-target epic just loses the dragged feature if it was here)
          result.push({
            ...epic,
            position: index * 1000,
            features: originalFeatures.map((f, i) => ({ ...f, position: i * 1000 })),
          });
          continue;
        }

        // Target epic: insert dragged feature at the right position using center-Y comparison
        let insertIndex = originalFeatures.length; // default: append at end
        for (let i = 0; i < originalFeatures.length; i++) {
          const featureNode = featureNodes.find((n) => n.id === originalFeatures[i].id);
          const featureCenterY = featureNode
            ? featureNode.position.y + ((featureNode.height as number) ?? 150) / 2
            : Infinity;
          if (draggedCenterY < featureCenterY) {
            insertIndex = i;
            break;
          }
        }

        const orderedFeatures = [...originalFeatures];
        if (draggedFeature) {
          orderedFeatures.splice(insertIndex, 0, draggedFeature);
        }
        result.push({
          ...epic,
          position: index * 1000,
          features: orderedFeatures.map((f, i) => ({
            ...f,
            epic_id: epicId,
            position: i * 1000,
          })),
        });
      }
      return result;
    },
    [],
  );

  // Shared, deterministic drag-preview builder used by both the local drag
  // (onNodeDrag) and the remote-collaborator preview, so peers see the exact
  // same reflow. Pure given its args — the drag state is passed explicitly.
  const computeDragPreview = useCallback(
    (args: {
      ds: { nodeId: string; type: "epic" | "feature"; sourceEpicId?: string };
      draggedPosition: { x: number; y: number };
      baseNodes: Node[];
      originalNodes: Node[];
      relativeYs: Map<string, number> | null;
    }): { nodes: Node[]; edges: Edge[] } => {
      const { ds, draggedPosition, baseNodes, originalNodes, relativeYs } = args;

      const current = baseNodes.map((n) =>
        n.id === ds.nodeId
          ? { ...n, position: draggedPosition, zIndex: 1000 }
          : n,
      );

      // Pre-drag positions for non-dragged nodes so earlier preview frames
      // don't corrupt the order calculation.
      const nodesForOrder = originalNodes.map((n) =>
        n.id === ds.nodeId ? { ...n, position: draggedPosition } : n,
      );
      const reorderedEpics = computeReorderedEpics(nodesForOrder, ds, epics);
      const { nodes: previewPositioned } = getLayoutedElements(
        layoutedNodes,
        edges,
        reorderedEpics,
      );

      if (ds.type === "epic") {
        const epicCurrentY = draggedPosition.y;
        const updated = current.map((n) => {
          if (n.id === ds.nodeId) return n; // dragged epic stays under the cursor
          const relY = relativeYs?.get(n.id);
          if (relY !== undefined) {
            return {
              ...n,
              zIndex: 999,
              position: { x: n.position.x, y: epicCurrentY + relY },
            };
          }
          const preview = previewPositioned.find((p) => p.id === n.id);
          return preview ? { ...n, position: preview.position } : n;
        });
        return { nodes: updated, edges };
      }

      // Feature drag: non-dragged nodes animate to preview positions; the
      // dragged feature's edge re-points (and dashes) when crossing epics.
      const updated = current.map((n) => {
        if (n.id === ds.nodeId) return n;
        const preview = previewPositioned.find((p) => p.id === n.id);
        return preview ? { ...n, position: preview.position } : n;
      });

      const targetEpic = reorderedEpics.find((e) =>
        e.features?.some((f) => f.id === ds.nodeId),
      );
      const closestEpicId = targetEpic?.id ?? null;
      let updatedEdges = edges;
      if (closestEpicId) {
        const isNewEpic = closestEpicId !== ds.sourceEpicId;
        updatedEdges = edges.map((e) => {
          if (e.target !== ds.nodeId) return e;
          return {
            ...e,
            id: `epic-feature-${closestEpicId}-${ds.nodeId}`,
            source: closestEpicId,
            animated: isNewEpic,
            style: isNewEpic
              ? { stroke: "#f59e0b", strokeWidth: 2.5, strokeDasharray: "6,3" }
              : e.style,
          };
        });
      }
      return { nodes: updated, edges: updatedEdges };
    },
    [computeReorderedEpics, epics, layoutedNodes, edges],
  );

  // Mirror a remote collaborator's epic/feature drag by re-running the same
  // deterministic preview from the dragged node's broadcast position.
  useEffect(() => {
    if (!remoteDrag) {
      remoteDragSnapshotRef.current = null;
      return;
    }

    // Terminal phase — resolve exactly once.
    if (remoteDrag.ended) {
      if (handledTerminalRef.current === remoteDrag) return;
      handledTerminalRef.current = remoteDrag;

      const snap = remoteDragSnapshotRef.current;
      if (remoteDrag.ended === "commit" && remoteDrag.position && snap) {
        // Committed: settle to the final laid-out layout immediately (locally,
        // deterministically) so the watcher doesn't wait for the server refetch
        // and doesn't see the node snap from the raw drop spot into its slot.
        const draggedPosition = remoteDrag.position;
        const ds = {
          nodeId: remoteDrag.nodeId,
          type: remoteDrag.type,
          sourceEpicId: remoteDrag.sourceEpicId,
        };
        const nodesForOrder = snap.nodes.map((n) =>
          n.id === ds.nodeId ? { ...n, position: draggedPosition } : n,
        );
        const reorderedEpics = computeReorderedEpics(nodesForOrder, ds, epics);
        const settled = getLayoutedElements(layoutedNodes, edges, reorderedEpics);
        const settledNodes = snap.nodes.map((n) => {
          const p = settled.nodes.find((s) => s.id === n.id);
          return p ? { ...n, position: p.position } : n;
        });
        setRemoteWorkingNodes(settledNodes);
        setRemoteWorkingEdges(settled.edges);
      } else {
        // Cancelled, no-op, or a confirm is still pending — the reorder is NOT
        // committed, so revert to the authoritative (committed/original) layout.
        setRemoteWorkingNodes(null);
        setRemoteWorkingEdges(null);
      }
      remoteDragSnapshotRef.current = null;
      return;
    }

    // Capture the pre-drag snapshot once per remote drag (same role as the
    // local dragStartNodesRef / dragStartFeatureRelativeYsRef).
    if (
      !remoteDragSnapshotRef.current ||
      remoteDragSnapshotRef.current.nodeId !== remoteDrag.nodeId
    ) {
      const snapshot = nodes.map((n) =>
        n.id === remoteDrag.nodeId ? { ...n, zIndex: 1000 } : n,
      );
      let relativeYs: Map<string, number> | null = null;
      if (remoteDrag.type === "epic") {
        const epicPos = snapshot.find(
          (n) => n.id === remoteDrag.nodeId,
        )?.position;
        const epicFeatures =
          epics.find((e) => e.id === remoteDrag.nodeId)?.features ?? [];
        relativeYs = new Map();
        for (const f of epicFeatures) {
          const fn = snapshot.find((n) => n.id === f.id);
          if (fn && epicPos) relativeYs.set(f.id, fn.position.y - epicPos.y);
        }
      }
      remoteDragSnapshotRef.current = {
        nodeId: remoteDrag.nodeId,
        nodes: snapshot,
        relativeYs,
      };
    }

    if (!remoteDrag.position) return; // start received, no movement yet

    const snap = remoteDragSnapshotRef.current;
    const { nodes: preview, edges: previewEdges } = computeDragPreview({
      ds: {
        nodeId: remoteDrag.nodeId,
        type: remoteDrag.type,
        sourceEpicId: remoteDrag.sourceEpicId,
      },
      draggedPosition: remoteDrag.position,
      baseNodes: snap.nodes,
      originalNodes: snap.nodes,
      relativeYs: snap.relativeYs,
    });

    const color = remoteDrag.color;
    const tagged = preview.map((n) => {
      const isDragged = n.id === remoteDrag.nodeId;
      return {
        ...n,
        className: `${n.className ?? ""} ${isDragged ? "remote-dragging" : "remote-drag-shift"
          }`.trim(),
        style: isDragged
          ? ({
            ...(n.style ?? {}),
            "--remote-drag-color": color,
          } as React.CSSProperties)
          : n.style,
      };
    });
    setRemoteWorkingNodes(tagged);
    setRemoteWorkingEdges(previewEdges);
  }, [
    remoteDrag,
    computeDragPreview,
    computeReorderedEpics,
    nodes,
    epics,
    layoutedNodes,
    edges,
  ]);

  // Flash-free handoff: clear the held remote preview once the committed data
  // arrives (layoutKey changes after the dragger's persist → refetch).
  const prevLayoutKeyRef = useRef(layoutKey);
  useEffect(() => {
    if (prevLayoutKeyRef.current === layoutKey) return;
    prevLayoutKeyRef.current = layoutKey;
    setRemoteWorkingNodes(null);
    setRemoteWorkingEdges(null);
  }, [layoutKey]);

  // Fallback: if the drag ended but no data change followed (e.g. dropped in
  // place), release the held preview after a short delay.
  useEffect(() => {
    if (remoteDrag || !remoteWorkingNodes) return;
    const t = setTimeout(() => {
      setRemoteWorkingNodes(null);
      setRemoteWorkingEdges(null);
    }, 2000);
    return () => clearTimeout(t);
  }, [remoteDrag, remoteWorkingNodes]);

  const clearDragState = useCallback(() => {
    workingNodesRef.current = null;
    setWorkingNodes(null);
    workingEdgesRef.current = null;
    setWorkingEdges(null);
    dragStartFeatureRelativeYsRef.current = null;
    dragStartNodesRef.current = null;
    dragStateRef.current = null;
    setDragState(null);
    setPendingCanvasDrag(null);
  }, []);

  const persistCanvasDrag = useCallback(
    async (pending: PendingCanvasDrag) => {
      // The reorder is being committed — tell collaborators to settle to the
      // new order (covers both auto-persist and confirm-then-persist).
      onBroadcastNodeDragEnd?.(
        pending.kind === "epicReorder" ? pending.epicId : pending.featureId,
        true,
      );
      workingNodesRef.current = null;
      workingEdgesRef.current = null;
      setIsPersistingCanvasDrag(true);
      try {
        if (pending.kind === "epicReorder") {
          await reorderEpicsInRoadmap(pending.newEpicOrder);
        } else if (pending.kind === "featureReorder") {
          await reorderFeaturesInEpic(pending.epicId, pending.newFeatureOrder);
        } else {
          await moveFeatureBetweenEpics(
            pending.featureId,
            pending.targetEpicId,
            pending.newTargetFeatureOrder,
          );
        }
      } finally {
        setIsPersistingCanvasDrag(false);
        setPendingCanvasDrag(null);
        setWorkingNodes(null);
        setWorkingEdges(null);
      }
    },
    [
      reorderEpicsInRoadmap,
      reorderFeaturesInEpic,
      moveFeatureBetweenEpics,
      onBroadcastNodeDragEnd,
    ],
  );

  // Snap the canvas to the final laid-out order immediately on an auto-persisted
  // drop. The reorder store actions apply their `epics` update only after the
  // request resolves, so without this the working preview would sit frozen at
  // the dropped position until the network round-trip completes. We show the
  // settled layout right away and let persistCanvasDrag's finally hand off to
  // the recomputed nodes once the (identical) committed data lands.
  const applySettledPreview = useCallback(
    (reorderedEpics: RoadmapEpic[]) => {
      const settled = getLayoutedElements(layoutedNodes, edges, reorderedEpics);
      const settledNodes = nodes.map((n) => {
        const p = settled.nodes.find((s) => s.id === n.id);
        return p ? { ...n, position: p.position } : n;
      });
      workingNodesRef.current = settledNodes;
      setWorkingNodes(settledNodes);
      workingEdgesRef.current = settled.edges;
      setWorkingEdges(settled.edges);
    },
    [nodes, layoutedNodes, edges],
  );

  // Cancelling a pending confirm: tell collaborators the drag was not committed
  // so their held preview reverts to the original order.
  const cancelPendingCanvasDrag = useCallback(() => {
    const p = pendingCanvasDrag;
    if (p) {
      onBroadcastNodeDragEnd?.(
        p.kind === "epicReorder" ? p.epicId : p.featureId,
        false,
      );
    }
    clearDragState();
  }, [pendingCanvasDrag, clearDragState, onBroadcastNodeDragEnd]);

  const onNodeDragStart = useCallback(
    (_event: React.MouseEvent, node: Node, _nodes: Node[]) => {
      if (!canEditRoadmap) return;
      const type: "epic" | "feature" | null =
        node.type === "epicWidget"
          ? "epic"
          : node.type === "featureWidget"
            ? "feature"
            : null;
      if (!type) return;
      const sourceEpicId =
        type === "feature"
          ? (node.data as { feature: { epic_id: string } }).feature.epic_id
          : undefined;
      const ds: { nodeId: string; type: "epic" | "feature"; sourceEpicId?: string } = {
        nodeId: node.id,
        type,
        sourceEpicId,
      };
      setDragState(ds);
      dragStateRef.current = ds;
      const snapshot = nodes.map((n) =>
        n.id === node.id ? { ...n, zIndex: 1000 } : n,
      );
      workingNodesRef.current = snapshot;
      dragStartNodesRef.current = snapshot;
      setWorkingNodes(snapshot);
      // Snapshot edges so we can mutate them during drag
      workingEdgesRef.current = [...edges];
      setWorkingEdges([...edges]);
      // For epic drag: record each belonging feature's Y offset relative to the epic
      if (type === "epic") {
        const epicInitialPos = snapshot.find((n) => n.id === node.id)?.position;
        const epicFeatures = epics.find((e) => e.id === node.id)?.features ?? [];
        const relativeYs = new Map<string, number>();
        for (const feature of epicFeatures) {
          const featureNode = snapshot.find((n) => n.id === feature.id);
          if (featureNode && epicInitialPos) {
            relativeYs.set(feature.id, featureNode.position.y - epicInitialPos.y);
          }
        }
        dragStartFeatureRelativeYsRef.current = relativeYs;
      } else {
        dragStartFeatureRelativeYsRef.current = null;
      }

      onBroadcastNodeDragStart?.({ nodeId: node.id, type, sourceEpicId });
    },
    [nodes, edges, epics, canEditRoadmap, onBroadcastNodeDragStart],
  );

  const onNodeDrag = useCallback(
    (_event: React.MouseEvent, node: Node, _nodes: Node[]) => {
      const ds = dragStateRef.current;
      if (!ds || !workingNodesRef.current) return;

      const { nodes: updated, edges: updatedEdges } = computeDragPreview({
        ds,
        draggedPosition: node.position,
        baseNodes: workingNodesRef.current,
        originalNodes: dragStartNodesRef.current ?? workingNodesRef.current,
        relativeYs: dragStartFeatureRelativeYsRef.current,
      });

      workingNodesRef.current = updated;
      setWorkingNodes(updated);
      if (ds.type === "feature") {
        workingEdgesRef.current = updatedEdges;
        setWorkingEdges(updatedEdges);
      }

      // Stream the dragged node's position so collaborators see the same reflow.
      onBroadcastNodeDrag?.({
        nodeId: node.id,
        type: ds.type,
        sourceEpicId: ds.sourceEpicId,
        x: node.position.x,
        y: node.position.y,
      });
    },
    [computeDragPreview, onBroadcastNodeDrag],
  );

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node, _nodes: Node[]) => {
      const ds = dragStateRef.current;
      if (!ds || !workingNodesRef.current) {
        onBroadcastNodeDragEnd?.(node.id, false);
        clearDragState();
        return;
      }

      // Reconstruct nodes using original pre-drag positions for every node except the
      // dropped one (which uses its final drop position). This prevents preview-animated
      // positions of non-dragged nodes from corrupting the final order calculation.
      const originalNodes = dragStartNodesRef.current ?? workingNodesRef.current;
      const nodesForOrder = originalNodes.map((n) =>
        n.id === node.id ? { ...n, position: node.position } : n,
      );
      const reorderedEpics = computeReorderedEpics(nodesForOrder, ds, epics);
      setDragState(null);
      dragStateRef.current = null;

      if (ds.type === "epic") {
        const newEpicOrder = reorderedEpics.map((e) => e.id);
        const originalOrder = [...epics]
          .sort((a, b) => a.position - b.position)
          .map((e) => e.id);
        if (JSON.stringify(newEpicOrder) === JSON.stringify(originalOrder)) {
          onBroadcastNodeDragEnd?.(ds.nodeId, false);
          clearDragState();
          return;
        }
        const epicTitle = epics.find((e) => e.id === ds.nodeId)?.title ?? "";
        const pending: PendingCanvasDrag = {
          kind: "epicReorder",
          epicId: ds.nodeId,
          epicTitle,
          newEpicOrder,
        };
        if (dontAskEpicReorder) {
          applySettledPreview(reorderedEpics);
          void persistCanvasDrag(pending);
        } else {
          // Awaiting confirmation — peers keep showing the live preview until
          // the dragger confirms (persist) or cancels.
          setPendingCanvasDrag(pending);
        }
        return;
      }

      // Feature drag
      const targetEpic = reorderedEpics.find((e) =>
        e.features?.some((f) => f.id === ds.nodeId),
      );
      const sameEpic = targetEpic?.id === ds.sourceEpicId;
      const feature = epics
        .flatMap((e) => e.features ?? [])
        .find((f) => f.id === ds.nodeId);
      if (!feature || !targetEpic) {
        onBroadcastNodeDragEnd?.(ds.nodeId, false);
        clearDragState();
        return;
      }

      if (sameEpic) {
        const originalFeatureOrder = [...epics]
          .find((e) => e.id === ds.sourceEpicId)
          ?.features?.sort((a, b) => a.position - b.position)
          .map((f) => f.id) ?? [];
        const newFeatureOrder = (targetEpic.features ?? []).map((f) => f.id);
        if (JSON.stringify(newFeatureOrder) === JSON.stringify(originalFeatureOrder)) {
          onBroadcastNodeDragEnd?.(ds.nodeId, false);
          clearDragState();
          return;
        }
        const pending: PendingCanvasDrag = {
          kind: "featureReorder",
          featureId: ds.nodeId,
          featureTitle: feature.title ?? "",
          epicId: targetEpic.id,
          newFeatureOrder,
        };
        if (dontAskFeatureReorder) {
          applySettledPreview(reorderedEpics);
          void persistCanvasDrag(pending);
        } else {
          setPendingCanvasDrag(pending);
        }
      } else {
        const newTargetFeatureOrder = (targetEpic.features ?? []).map((f) => f.id);
        const pending: PendingCanvasDrag = {
          kind: "featureMove",
          featureId: ds.nodeId,
          featureTitle: feature.title ?? "",
          sourceEpicId: ds.sourceEpicId ?? "",
          targetEpicId: targetEpic.id,
          targetEpicTitle: targetEpic.title ?? "",
          newTargetFeatureOrder,
        };
        if (dontAskFeatureMove) {
          applySettledPreview(reorderedEpics);
          void persistCanvasDrag(pending);
        } else {
          setPendingCanvasDrag(pending);
        }
      }
    },
    [
      workingNodes,
      computeReorderedEpics,
      epics,
      clearDragState,
      persistCanvasDrag,
      applySettledPreview,
      dontAskEpicReorder,
      dontAskFeatureReorder,
      dontAskFeatureMove,
      onBroadcastNodeDragEnd,
    ],
  );

  const getToolbarItemFromTransfer = useCallback(
    (event: { dataTransfer: DataTransfer | null }): ToolbarItemType | null => {
      const rawCustom = event.dataTransfer?.getData(TOOLBAR_DRAG_MIME);
      if (rawCustom === "epic" || rawCustom === "feature" || rawCustom === "task") {
        return rawCustom;
      }

      const rawText = event.dataTransfer?.getData("text/plain");
      if (rawText === "epic" || rawText === "feature" || rawText === "task") {
        return rawText;
      }

      if (toolbarDraggingType) {
        // Browsers may hide custom drag data during dragover; keep toolbar DnD usable.
        return toolbarDraggingType;
      }

      const types = Array.from(event.dataTransfer?.types ?? []);
      if (types.includes(TOOLBAR_DRAG_MIME) && toolbarDraggingType) {
        return toolbarDraggingType;
      }

      if (types.includes("text/plain") && toolbarDraggingType) {
        return toolbarDraggingType;
      }
      return null;
    },
    [toolbarDraggingType],
  );

  const handleToolbarDragStart = useCallback(
    (itemType: ToolbarItemType, event: DragEvent<HTMLElement>) => {
      event.dataTransfer.setData(TOOLBAR_DRAG_MIME, itemType);
      event.dataTransfer.setData("text/plain", itemType);
      event.dataTransfer.effectAllowed = "move";
      setToolbarDraggingType(itemType);
    },
    [],
  );

  const handleToolbarDragEnd = useCallback(() => {
    setToolbarDraggingType(null);
  }, []);

  const handleCanvasDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const itemType = getToolbarItemFromTransfer(event);
      if (itemType !== "epic") return;
      if (!reactFlowInstance) return;
      const dropPosition = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const candidateNodes =
        (workingNodesRef.current as Node<EpicWidgetData | FeatureWidgetData>[] | null) ??
        reactFlowInstance.getNodes();
      const isOverEpic = candidateNodes.some((node) => {
        if (node.type !== "epicWidget") return false;
        const width = Number(node.width) || 500;
        const height = Number(node.height) || 220;
        const withinX =
          dropPosition.x >= node.position.x &&
          dropPosition.x <= node.position.x + width;
        const withinY =
          dropPosition.y >= node.position.y &&
          dropPosition.y <= node.position.y + height;
        return withinX && withinY;
      });
      if (!isOverEpic) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    },
    [getToolbarItemFromTransfer, reactFlowInstance],
  );

  const handleCanvasDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const itemType = getToolbarItemFromTransfer(event);
      setToolbarDraggingType(null);
      if (itemType !== "epic" || !reactFlowInstance) return;
      event.preventDefault();
      const dropPosition = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const candidateNodes =
        (workingNodesRef.current as Node<EpicWidgetData | FeatureWidgetData>[] | null) ??
        reactFlowInstance.getNodes();
      const targetEpic = candidateNodes.find((node) => {
        if (node.type !== "epicWidget") return false;
        const width = Number(node.width) || 500;
        const height = Number(node.height) || 220;
        const withinX =
          dropPosition.x >= node.position.x &&
          dropPosition.x <= node.position.x + width;
        const withinY =
          dropPosition.y >= node.position.y &&
          dropPosition.y <= node.position.y + height;
        return withinX && withinY;
      });
      if (!targetEpic) return;
      onAddEpicBelow?.(targetEpic.id);
    },
    [getToolbarItemFromTransfer, onAddEpicBelow, reactFlowInstance],
  );

  return (
    <div
      className="w-full h-full bg-[#F5F5F5] relative"
      onDragOver={handleCanvasDragOver}
      onDrop={handleCanvasDrop}
      onPointerMove={(e) => {
        if (!reactFlowInstance || !onTrackCursor) return;
        // screenToFlowPosition expects client (page) coords — it handles
        // the container offset internally. Subtracting bounds here would be
        // a bug that shifts every remote cursor by the container's page position.
        const pos = reactFlowInstance.screenToFlowPosition({
          x: e.clientX,
          y: e.clientY,
        });
        onTrackCursor(pos.x, pos.y);
      }}
    >
      <ReactFlow
        nodes={
          (workingNodes as Node<EpicWidgetData | FeatureWidgetData>[] | null) ??
          (remoteWorkingNodes as
            | Node<EpicWidgetData | FeatureWidgetData>[]
            | null) ??
          nodes
        }
        edges={workingEdges ?? remoteWorkingEdges ?? edges}
        nodeTypes={nodeTypes}
        // ReactFlow pauses viewport culling during a real drag (so the local
        // drag never flickers), but a remote collaborator's preview moves nodes
        // via the controlled `nodes` prop with no active drag — leaving culling
        // on makes epic/feature edges pop in and out as the reflow shifts their
        // bounding boxes. Pause culling while the remote preview is active.
        onlyRenderVisibleElements={!(remoteWorkingNodes && !workingNodes)}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onMoveStart={() => {
          onPanStart?.();
        }}
        onMoveEnd={(_, viewport) => {
          setZoom(viewport.zoom);
          onPanEnd?.();
        }}
        onInit={(instance) => {
          setReactFlowInstance(instance);
          setZoom(instance.getZoom());
        }}
        defaultViewport={{
          x: DEFAULT_VIEWPORT_X,
          y: DEFAULT_VIEWPORT_Y,
          zoom: DEFAULT_ZOOM,
        }}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        translateExtent={translateExtent}
        panOnDrag={[0, 1, 2]}
        panOnScroll
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        nodesDraggable={canEditRoadmap}
        defaultEdgeOptions={{
          type: "simplebezier",
        }}
      >
        <Background variant={BackgroundVariant.Dots} />
        <Controls position="top-right" />
        {showMiniMap && (
          <MiniMap
            position="bottom-right"
            nodeStrokeWidth={1.5}
            nodeStrokeColor={(node) => {
              if (node.type === "epicWidget") return "#9ca3af";
              if (node.type === "featureWidget") return "#f59e0b";
              return "#9ca3af";
            }}
            nodeColor={(node) => {
              if (node.type === "epicWidget") return "#f8fafc";
              if (node.type === "featureWidget") return "#fff7ed";
              return "#e5e7eb";
            }}
            nodeBorderRadius={6}
            maskColor="rgba(0, 0, 0, 0.04)"
            className="bg-gray-50 border border-gray-300 rounded-lg"
            style={{ width: 200, height: 140 }}
          />
        )}
        {featureFlags.realtimeCursors && (
          <CollaborationCursorsOverlay remoteCursors={remoteCursors} />
        )}
      </ReactFlow>

      <EpicReorderConfirmModal
        isOpen={pendingCanvasDrag?.kind === "epicReorder"}
        isSaving={isPersistingCanvasDrag}
        epicTitle={pendingCanvasDrag?.kind === "epicReorder" ? pendingCanvasDrag.epicTitle : null}
        dontAskAgain={dontAskEpicReorder}
        onDontAskAgainChange={(v) => {
          setDontAskEpicReorder(v);
          sessionStorage.setItem(CANVAS_SKIP_EPIC_REORDER_KEY, String(v));
        }}
        onCancel={cancelPendingCanvasDrag}
        onConfirm={() => {
          if (pendingCanvasDrag) void persistCanvasDrag(pendingCanvasDrag);
        }}
      />
      <FeatureReorderConfirmModal
        isOpen={pendingCanvasDrag?.kind === "featureReorder"}
        isSaving={isPersistingCanvasDrag}
        featureTitle={pendingCanvasDrag?.kind === "featureReorder" ? pendingCanvasDrag.featureTitle : null}
        dontAskAgain={dontAskFeatureReorder}
        onDontAskAgainChange={(v) => {
          setDontAskFeatureReorder(v);
          sessionStorage.setItem(CANVAS_SKIP_FEATURE_REORDER_KEY, String(v));
        }}
        onCancel={cancelPendingCanvasDrag}
        onConfirm={() => {
          if (pendingCanvasDrag) void persistCanvasDrag(pendingCanvasDrag);
        }}
      />
      <FeatureMoveConfirmModal
        isOpen={pendingCanvasDrag?.kind === "featureMove"}
        isSaving={isPersistingCanvasDrag}
        featureTitle={pendingCanvasDrag?.kind === "featureMove" ? pendingCanvasDrag.featureTitle : null}
        targetEpicTitle={pendingCanvasDrag?.kind === "featureMove" ? pendingCanvasDrag.targetEpicTitle : null}
        dontAskAgain={dontAskFeatureMove}
        onDontAskAgainChange={(v) => {
          setDontAskFeatureMove(v);
          sessionStorage.setItem(CANVAS_SKIP_FEATURE_MOVE_KEY, String(v));
        }}
        onCancel={cancelPendingCanvasDrag}
        onConfirm={() => {
          if (pendingCanvasDrag) void persistCanvasDrag(pendingCanvasDrag);
        }}
      />

      <div className="absolute bottom-16 right-4 bg-white/90 border border-gray-200 rounded-md px-2 py-1 text-xs text-gray-700 shadow-sm">
        Zoom {Math.round(zoom * 100)}%
      </div>
      <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-2xl border border-gray-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur select-none">
        <div className="flex items-center gap-2">
          <div className="mr-1 inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
            <GripHorizontal className="h-3 w-3" />
            Drag To Add
          </div>
          <button
            type="button"
            draggable
            onDragStart={(event) => handleToolbarDragStart("epic", event)}
            onDragEnd={handleToolbarDragEnd}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all duration-200 ${toolbarDraggingType === "epic"
                ? "border-emerald-500 bg-emerald-50 text-emerald-700 shadow-[0_0_0_3px_rgba(34,197,94,0.2)]"
                : "border-gray-200 bg-white text-gray-700 hover:border-emerald-300 hover:bg-emerald-50/70 hover:text-emerald-700 hover:shadow-sm"
              }`}
            title="Drop on an epic card to add a new epic below it"
          >
            <Layers3 className="h-3.5 w-3.5" />
            Epic
          </button>
          <button
            type="button"
            draggable
            onDragStart={(event) => handleToolbarDragStart("feature", event)}
            onDragEnd={handleToolbarDragEnd}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all duration-200 ${toolbarDraggingType === "feature"
                ? "border-emerald-500 bg-emerald-50 text-emerald-700 shadow-[0_0_0_3px_rgba(34,197,94,0.2)]"
                : "border-gray-200 bg-white text-gray-700 hover:border-emerald-300 hover:bg-emerald-50/70 hover:text-emerald-700 hover:shadow-sm"
              }`}
            title="Drop on an epic card to add a feature"
          >
            <Layers3 className="h-3.5 w-3.5" />
            Feature
          </button>
          <button
            type="button"
            draggable
            onDragStart={(event) => handleToolbarDragStart("task", event)}
            onDragEnd={handleToolbarDragEnd}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all duration-200 ${toolbarDraggingType === "task"
                ? "border-emerald-500 bg-emerald-50 text-emerald-700 shadow-[0_0_0_3px_rgba(34,197,94,0.2)]"
                : "border-gray-200 bg-white text-gray-700 hover:border-emerald-300 hover:bg-emerald-50/70 hover:text-emerald-700 hover:shadow-sm"
              }`}
            title="Drop on a feature card to add a task"
          >
            <ListTodo className="h-3.5 w-3.5" />
            Task
          </button>
          {assigneeAvatars.length > 0 && (
            <>
              <span
                aria-hidden="true"
                className="mx-1 h-5 w-px shrink-0 bg-gray-200"
              />
              <span className="mr-1 inline-flex items-center text-[11px] font-medium uppercase tracking-wide text-gray-500">
                Assignee
              </span>
              {assigneeAvatars.map((avatar) => (
                <ToolbarAssigneeChip key={avatar.userId} avatar={avatar} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
