import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
} from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useDraggable } from "@dnd-kit/core";
import { GripHorizontal, Layers3, ListTodo } from "lucide-react";
import { EpicWidget, type EpicWidgetData } from "../../widgets/EpicWidget";
import {
  FeatureWidget,
  type FeatureWidgetData,
} from "../../widgets/FeatureWidget";
import type {
  Roadmap,
  RoadmapEpic,
  RoadmapFeature,
  RoadmapTask,
} from "@/types/roadmap";
import type { RoadmapPerformanceMode } from "./models/types";
import {
  useRecentAssignees,
  type DockAvatar,
} from "@/hooks/useRecentAssignees";

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
      className={`relative shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 transition-opacity cursor-grab active:cursor-grabbing ${
        isDragging ? "opacity-40" : "opacity-100"
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

const getEdgeColor = (status: RoadmapFeature["status"]) => {
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
  const DEFAULT_ZOOM = 0.67;
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [isPanningCanvas, setIsPanningCanvas] = useState(false);
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
  const MAX_ZOOM = 1.0;
  const MIN_ZOOM = minZoom;
  const isReducedMotion = performanceMode === "reducedMotion";
  const [toolbarDraggingType, setToolbarDraggingType] =
    useState<ToolbarItemType | null>(null);

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

    const featureEdges: Edge[] = allFeatures.map((feature) => ({
      id: `epic-feature-${feature.epic_id}-${feature.id}`,
      source: feature.epic_id,
      sourceHandle: "epic-right",
      target: feature.id,
      type: "simplebezier",
      animated: feature.status === "in_progress",
      style: {
        stroke: getEdgeColor(feature.status),
        strokeWidth: 2,
      },
    }));

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
  }, [epics]);

  const nodes = useMemo(
    (): Node<EpicWidgetData | FeatureWidgetData>[] =>
      layoutedNodes.map((node) => {
        if (node.type === "epicWidget") {
          const epic = (node.data as StructuralEpicNodeData).epic;
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
            } satisfies EpicWidgetData,
          };
        }

        const feature = (node.data as StructuralFeatureNodeData).feature;
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
          } satisfies FeatureWidgetData,
        };
      }),
    [
      layoutedNodes,
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

    reactFlowInstance.setCenter(centerX, centerY, {
      zoom: 0.8,
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
  ]);

  const extraRightPadding = useMemo(() => {
    if (maxTaskCount >= 60) return 2600;
    if (maxTaskCount >= 40) return 2200;
    if (maxTaskCount >= 20) return 1800;
    return 1000;
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

    const NODE_WIDTH = 520;
    const minX = Math.min(...xPositions) - 400;
    const maxX = Math.max(...xPositions) + NODE_WIDTH + extraRightPadding;
    const minY = Math.min(...yPositions) - 240;
    const maxY = Math.max(...yPositions) + 720;

    return [
      [minX, minY],
      [maxX, maxY],
    ];
  }, [extraRightPadding, layoutedNodes]);

  const onNodesChange = useCallback(() => {
    // Handle node changes if needed (e.g., dragging)
  }, []);

  const onEdgesChange = useCallback(() => {
    // Handle edge changes if needed
  }, []);

  const lastEpicId = useMemo(() => {
    if (!epics.length) return null;
    return [...epics].sort((a, b) => a.position - b.position)[epics.length - 1]
      ?.id;
  }, [epics]);

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
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    },
    [getToolbarItemFromTransfer],
  );

  const handleCanvasDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const itemType = getToolbarItemFromTransfer(event);
      setToolbarDraggingType(null);
      if (itemType !== "epic" || !lastEpicId) return;
      event.preventDefault();
      onAddEpicBelow?.(lastEpicId);
    },
    [getToolbarItemFromTransfer, lastEpicId, onAddEpicBelow],
  );

  return (
    <div
      className={`w-full h-full bg-[#F5F5F5] relative ${
        isPanningCanvas ? "cursor-grabbing" : "cursor-grab"
      }`}
      onDragOver={handleCanvasDragOver}
      onDrop={handleCanvasDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onlyRenderVisibleElements
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onMoveStart={() => {
          setIsPanningCanvas(true);
        }}
        onMoveEnd={(_, viewport) => {
          setZoom(viewport.zoom);
          setIsPanningCanvas(false);
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
        nodesDraggable={false}
        defaultEdgeOptions={{
          type: "simplebezier",
        }}
      >
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
      </ReactFlow>
      <div className="absolute bottom-4 right-4 bg-white/90 border border-gray-200 rounded-md px-2 py-1 text-xs text-gray-700 shadow-sm">
        Zoom {Math.round(zoom * 100)}%
      </div>
      <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-2xl border border-gray-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur select-none">
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
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all duration-200 ${
              toolbarDraggingType === "epic"
                ? "border-emerald-500 bg-emerald-50 text-emerald-700 shadow-[0_0_0_3px_rgba(34,197,94,0.2)]"
                : "border-gray-200 bg-white text-gray-700 hover:border-emerald-300 hover:bg-emerald-50/70 hover:text-emerald-700 hover:shadow-sm"
            }`}
            title="Drop on an epic card or canvas to add a new epic"
          >
            <Layers3 className="h-3.5 w-3.5" />
            Epic
          </button>
          <button
            type="button"
            draggable
            onDragStart={(event) => handleToolbarDragStart("feature", event)}
            onDragEnd={handleToolbarDragEnd}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all duration-200 ${
              toolbarDraggingType === "feature"
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
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all duration-200 ${
              toolbarDraggingType === "task"
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
