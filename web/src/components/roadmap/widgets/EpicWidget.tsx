import { memo, useEffect, useRef, useState, type DragEvent } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { motion } from "framer-motion";
import { Edit2, Trash2, Plus, ExternalLink, Calendar } from "lucide-react";
import type { RoadmapEpic } from "@/types/roadmap";
import type { RoadmapPerformanceMode } from "../views/roadmap/models/types";
import { calculateEpicProgressFromFeatures } from "../shared/featureProgress";

type ToolbarItemType = "epic" | "feature" | "task";
const TOOLBAR_DRAG_MIME = "application/x-roadmap-toolbar-item";

export interface EpicWidgetData extends Record<string, unknown> {
  epic: RoadmapEpic;
  onEdit?: (epic: RoadmapEpic) => void;
  onDelete?: (epicId: string) => void;
  onAddEpicBelow?: (epicId: string) => void;
  onAddFeature?: (epicId: string) => void;
  onNavigateToTab?: (tabId: string) => void;
  pulseToken?: number;
  toolbarDraggingType?: ToolbarItemType | null;
  performanceMode?: RoadmapPerformanceMode;
}

type EpicWidgetNode = Node<EpicWidgetData>;

export const EpicWidget = memo(({ data }: NodeProps<EpicWidgetNode>) => {
  const {
    epic,
    onEdit,
    onDelete,
    onAddEpicBelow,
    onAddFeature,
    onNavigateToTab,
    pulseToken,
    toolbarDraggingType = null,
    performanceMode = "normal",
  } = data;
  const isReducedMotion = performanceMode === "reducedMotion";
  const descriptionRef = useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [isPulsing, setIsPulsing] = useState(false);
  const [cardDropType, setCardDropType] = useState<"epic" | "feature" | null>(
    null,
  );
  const [isAddFeatureDropActive, setIsAddFeatureDropActive] = useState(false);
  const [isAddEpicDropActive, setIsAddEpicDropActive] = useState(false);
  const computedProgress = calculateEpicProgressFromFeatures(epic.features);
  const isOptimisticEpic = epic.id.startsWith("temp-");
  const taskCount = (epic.features ?? []).reduce(
    (count, feature) => count + (feature.tasks?.length ?? 0),
    0,
  );
  const progressToRender = taskCount > 0 ? computedProgress : epic.progress;

  useEffect(() => {
    const el = descriptionRef.current;
    if (!el) return;
    setHasOverflow(el.scrollHeight > el.clientHeight + 1);
  }, [epic.description]);

  useEffect(() => {
    if (isReducedMotion) {
      setIsPulsing(false);
      return;
    }
    if (!pulseToken) return;
    setIsPulsing(true);
    const timeoutId = window.setTimeout(() => {
      setIsPulsing(false);
    }, 900);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isReducedMotion, pulseToken]);

  const getToolbarItemType = (
    event: Pick<DragEvent<HTMLElement>, "dataTransfer">,
  ): ToolbarItemType | null => {
    const rawCustom = event.dataTransfer.getData(TOOLBAR_DRAG_MIME);
    if (
      rawCustom === "epic" ||
      rawCustom === "feature" ||
      rawCustom === "task"
    ) {
      return rawCustom;
    }

    const rawText = event.dataTransfer.getData("text/plain");
    if (rawText === "epic" || rawText === "feature" || rawText === "task") {
      return rawText;
    }

    if (toolbarDraggingType) {
      return toolbarDraggingType;
    }

    return null;
  };

  const isGlobalFeatureDropHighlight = toolbarDraggingType === "feature";
  const isGlobalEpicDropHighlight = toolbarDraggingType === "epic";
  const canAcceptCardDrop = (
    itemType: ToolbarItemType | null,
  ): itemType is "epic" | "feature" => {
    if (itemType === "epic") return Boolean(onAddEpicBelow);
    if (itemType === "feature") return Boolean(onAddFeature);
    return false;
  };

  return (
    <motion.div
      className={`group relative bg-white border-2 rounded-4xl shadow-md hover:shadow-lg transition-all duration-200 w-[500px] max-h-[420px] flex flex-col cursor-pointer ${
        isPulsing && !isReducedMotion ? "roadmap-widget-light-pulse" : ""
      } ${isOptimisticEpic ? "opacity-75" : ""} ${
        cardDropType === "epic" || cardDropType === "feature"
          ? "border-emerald-500 ring-2 ring-emerald-300 shadow-[0_0_0_1px_rgba(16,185,129,0.3),0_12px_24px_rgba(16,185,129,0.22)]"
          : isGlobalFeatureDropHighlight
            ? "border-emerald-400 ring-2 ring-emerald-200 shadow-[0_0_0_1px_rgba(16,185,129,0.22),0_10px_24px_rgba(16,185,129,0.18)]"
            : "border-gray-300"
      }`}
      onClick={() => onEdit?.(epic)}
      onDragEnter={(event) => {
        const itemType = getToolbarItemType(event);
        if (!canAcceptCardDrop(itemType)) return;
        event.preventDefault();
        event.stopPropagation();
        setCardDropType(itemType);
      }}
      onDragOver={(event) => {
        const itemType = getToolbarItemType(event);
        if (!canAcceptCardDrop(itemType)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setCardDropType(itemType);
      }}
      onDragLeave={() => {
        setCardDropType(null);
      }}
      onDrop={(event) => {
        const itemType = getToolbarItemType(event);
        setCardDropType(null);
        if (!canAcceptCardDrop(itemType)) return;
        event.preventDefault();
        event.stopPropagation();
        if (itemType === "epic") {
          onAddEpicBelow?.(epic.id);
          return;
        }
        if (itemType === "feature") {
          onAddFeature?.(epic.id);
        }
      }}
      initial={isReducedMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
      animate={isReducedMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
      transition={
        isReducedMotion ? undefined : { duration: 0.25, ease: "easeOut" }
      }
    >
      {/* Invisible handles for edge connections */}
      <Handle
        type="target"
        position={Position.Top}
        id="epic-top"
        className="w-3 h-3 opacity-0"
      />

      <Handle
        type="source"
        position={Position.Bottom}
        id="epic-bottom"
        className="w-3 h-3 opacity-0"
      />

      {/* Handle for connecting to features */}
      <Handle
        type="source"
        position={Position.Right}
        id="epic-right"
        className="w-3 h-3 opacity-0"
      />

      {/* Add Feature button (right side) */}
      {onAddFeature && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddFeature(epic.id);
          }}
          onDragEnter={(event) => {
            if (getToolbarItemType(event) !== "feature") return;
            event.preventDefault();
            setIsAddFeatureDropActive(true);
          }}
          onDragOver={(event) => {
            if (getToolbarItemType(event) !== "feature") return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setIsAddFeatureDropActive(true);
          }}
          onDragLeave={() => {
            setIsAddFeatureDropActive(false);
          }}
          onDrop={(event) => {
            setIsAddFeatureDropActive(false);
            if (getToolbarItemType(event) !== "feature") return;
            event.preventDefault();
            event.stopPropagation();
            onAddFeature(epic.id);
          }}
          className={`absolute -right-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-emerald-500 text-white rounded-full flex items-center justify-center hover:bg-emerald-400 transition-all duration-200 ease-out shadow-lg z-10 cursor-pointer ${
            toolbarDraggingType === "feature"
              ? `opacity-100 scale-100 ring-2 ${
                  isAddFeatureDropActive
                    ? "ring-emerald-400 shadow-[0_0_0_1px_rgba(16,185,129,0.35),0_10px_22px_rgba(16,185,129,0.35)]"
                    : "ring-emerald-300 shadow-[0_0_0_1px_rgba(16,185,129,0.24),0_8px_18px_rgba(16,185,129,0.28)]"
                }`
              : "opacity-0 group-hover:opacity-100 scale-95 group-hover:scale-100"
          }`}
          title="Add Feature"
        >
          <Plus className="w-4 h-4" />
        </button>
      )}

      {/* Add Epic Below button (bottom) */}
      {onAddEpicBelow && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddEpicBelow(epic.id);
          }}
          onDragEnter={(event) => {
            if (getToolbarItemType(event) !== "epic") return;
            event.preventDefault();
            setIsAddEpicDropActive(true);
          }}
          onDragOver={(event) => {
            if (getToolbarItemType(event) !== "epic") return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setIsAddEpicDropActive(true);
          }}
          onDragLeave={() => {
            setIsAddEpicDropActive(false);
          }}
          onDrop={(event) => {
            setIsAddEpicDropActive(false);
            if (getToolbarItemType(event) !== "epic") return;
            event.preventDefault();
            event.stopPropagation();
            onAddEpicBelow(epic.id);
          }}
          className={`absolute -bottom-4 left-1/2 -translate-x-1/2 w-8 h-8 bg-emerald-500 text-white rounded-full flex items-center justify-center hover:bg-emerald-400 transition-all duration-200 ease-out shadow-lg z-10 cursor-pointer ${
            isGlobalEpicDropHighlight
              ? `opacity-100 scale-100 ring-2 ${
                  isAddEpicDropActive
                    ? "ring-emerald-400 shadow-[0_0_0_1px_rgba(16,185,129,0.35),0_10px_22px_rgba(16,185,129,0.35)]"
                    : "ring-emerald-300 shadow-[0_0_0_1px_rgba(16,185,129,0.26),0_8px_18px_rgba(16,185,129,0.3)]"
                }`
              : "opacity-0 group-hover:opacity-100 scale-95 group-hover:scale-100"
          }`}
          title="Add Epic Below"
        >
          <Plus className="w-4 h-4" />
        </button>
      )}

      <div className="p-10 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {epic.color && (
                <div
                  className="w-3 h-3 rounded-full border border-gray-300"
                  style={{ backgroundColor: epic.color }}
                />
              )}
            </div>
            <h3 className="font-semibold text-gray-900 text-base leading-tight wrap-break-word">
              {epic.title}
            </h3>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0">
            {onNavigateToTab && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigateToTab(epic.id);
                }}
                className="p-1.5 hover:bg-blue-100 rounded transition-colors"
                title="Navigate to epic"
              >
                <ExternalLink className="w-3.5 h-3.5 text-blue-600" />
              </button>
            )}
            {onEdit && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(epic);
                }}
                className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                title="Edit epic"
              >
                <Edit2 className="w-3.5 h-3.5 text-gray-600" />
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(epic.id);
                }}
                className="p-1.5 hover:bg-red-100 rounded transition-colors"
                title="Delete epic"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-600" />
              </button>
            )}
          </div>
        </div>

        {/* Description - scrollable with fade at bottom */}
        {epic.description && (
          <div
            ref={descriptionRef}
            className="relative mb-3 grow overflow-y-auto pr-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <div
              className="text-sm text-gray-600 leading-relaxed prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: epic.description }}
            />
            {hasOverflow && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-white to-white/0" />
            )}
          </div>
        )}

        {/* Labels */}
        {((epic.labels && epic.labels.length > 0) ||
          (epic.tags && epic.tags.length > 0)) && (
          <div className="flex flex-wrap items-center gap-2 mb-3 shrink-0">
            {/* Display labels if available */}
            {epic.labels?.map((label) => (
              <span
                key={label.id}
                className="px-2 py-1 text-xs font-medium rounded-full border"
                style={{
                  backgroundColor: label.color,
                  color: getContrastColor(label.color),
                  borderColor: adjustColorBrightness(label.color, -20),
                }}
              >
                {label.name}
              </span>
            ))}
            {/* Fallback to tags if no labels */}
            {!epic.labels &&
              epic.tags?.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-1 text-xs font-medium bg-blue-50 text-blue-700 rounded-full border border-blue-100"
                >
                  {tag}
                </span>
              ))}
          </div>
        )}

        {/* Progress Bar */}
        {progressToRender !== undefined && (
          <div className="mb-3 shrink-0">
            <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
              <span>Progress</span>
              <span className="font-medium">
                {Math.round(progressToRender)}%
              </span>
            </div>
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${progressToRender}%` }}
              />
            </div>
          </div>
        )}

        {/* Features count */}
        <div className="flex items-center justify-between text-xs text-gray-500 shrink-0">
          <span>
            {epic.features?.length || 0} feature
            {epic.features?.length !== 1 ? "s" : ""}
          </span>
          {epic.estimated_hours && <span>~{epic.estimated_hours}h</span>}
        </div>

        {/* Date range */}
        {(epic.start_date || epic.end_date) && (
          <div className="flex items-center gap-1 mt-2 text-xs text-gray-400 shrink-0">
            <Calendar className="w-3 h-3 shrink-0" />
            <span>
              {epic.start_date
                ? new Date(epic.start_date).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : "—"}
              {" → "}
              {epic.end_date
                ? new Date(epic.end_date).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : "—"}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
});

EpicWidget.displayName = "EpicWidget";

// Helper function to determine text color based on background
function getContrastColor(hexColor: string): string {
  // Convert hex to RGB
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);

  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Return black or white based on luminance
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

// Helper function to adjust color brightness
function adjustColorBrightness(hexColor: string, percent: number): string {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);

  const adjust = (value: number) => {
    const adjusted = value + (value * percent) / 100;
    return Math.max(0, Math.min(255, Math.round(adjusted)));
  };

  const newR = adjust(r).toString(16).padStart(2, "0");
  const newG = adjust(g).toString(16).padStart(2, "0");
  const newB = adjust(b).toString(16).padStart(2, "0");

  return `#${newR}${newG}${newB}`;
}
