import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { motion } from "framer-motion";
import {
  Edit2,
  Trash2,
  CheckCircle2,
  Clock,
  AlertCircle,
  List,
  Plus,
  Calendar,
  Maximize2,
} from "lucide-react";
import type { FeatureStatus, RoadmapFeature, RoadmapTask } from "@/types/roadmap";
import type { RoadmapPerformanceMode } from "../views/roadmap/models/types";
import { TaskListItem } from "./TaskListItem";
import { TaskListModal } from "../modals/TaskListModal";
import {
  calculateFeatureProgressFromTasks,
  getCompletedTaskCount,
} from "../shared/featureProgress";
import { deriveFeatureStatus } from "@/utils/featureStatus";

type ToolbarItemType = "epic" | "feature" | "task";
const TOOLBAR_DRAG_MIME = "application/x-roadmap-toolbar-item";

export interface FeatureWidgetData extends Record<string, unknown> {
  feature: RoadmapFeature;
  showTaskCount?: boolean; // If true, show task count; if false, show full tasks
  onEdit?: (feature: RoadmapFeature) => void;
  onDelete?: (featureId: string) => void;
  onClick?: (feature: RoadmapFeature) => void;
  onAddTask?: (featureId: string) => void;
  onSelectTask?: (task: RoadmapTask) => void;
  onUpdateTask?: (task: RoadmapTask) => void;
  pulseTaskId?: string | null;
  pulseTaskToken?: number;
  pulseToken?: number;
  runningTaskId?: string | null;
  toolbarDraggingType?: ToolbarItemType | null;
  performanceMode?: RoadmapPerformanceMode;
  canEditRoadmap?: boolean;
}

type FeatureWidgetNode = Node<FeatureWidgetData>;

export const FeatureWidget = memo(({ data }: NodeProps<FeatureWidgetNode>) => {
  const {
    feature,
    showTaskCount = true,
    onEdit,
    onDelete,
    onClick,
    onAddTask,
    onSelectTask,
    onUpdateTask,
    pulseTaskId,
    pulseTaskToken,
    pulseToken,
    runningTaskId,
    toolbarDraggingType = null,
    performanceMode = "normal",
    canEditRoadmap = false,
  } = data;
  const isReducedMotion = performanceMode === "reducedMotion";
  const safelyUpdateTask = (task: RoadmapTask) => {
    if (!onUpdateTask) return;
    void Promise.resolve(onUpdateTask(task)).catch(() => undefined);
  };
  const descriptionRef = useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [isPulsing, setIsPulsing] = useState(false);
  const [isCardTaskDropActive, setIsCardTaskDropActive] = useState(false);
  const [isAddTaskDropActive, setIsAddTaskDropActive] = useState(false);
  const [isTaskListModalOpen, setIsTaskListModalOpen] = useState(false);
  const derivedStatus = deriveFeatureStatus(feature.tasks);

  const getWidgetBorderColor = (status: FeatureStatus) => {
    switch (status) {
      case "completed":
        return "border-green-500 hover:border-green-600";
      case "in_progress":
        return "border-blue-500 hover:border-blue-600";
      case "in_review":
        return "border-purple-500 hover:border-purple-600";
      case "blocked":
        return "border-red-500 hover:border-red-600";
      case "not_started":
      default:
        return "border-transparent hover:border-gray-200";
    }
  };

  const getStatusColor = (status: FeatureStatus) => {
    switch (status) {
      case "completed":
        return "bg-green-100 text-green-800 border-green-300";
      case "in_progress":
        return "bg-blue-100 text-blue-800 border-blue-300";
      case "in_review":
        return "bg-purple-100 text-purple-800 border-purple-300";
      case "blocked":
        return "bg-red-100 text-red-800 border-red-300";
      case "not_started":
        return "bg-gray-100 text-gray-800 border-gray-300";
      default:
        return "bg-gray-100 text-gray-800 border-gray-300";
    }
  };

  const getStatusIcon = (status: FeatureStatus) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="w-3 h-3" />;
      case "in_progress":
        return <Clock className="w-3 h-3" />;
      case "blocked":
        return <AlertCircle className="w-3 h-3" />;
      default:
        return null;
    }
  };

  const taskCount = feature.tasks?.length || 0;
  const isOptimisticFeature = feature.id.startsWith("temp-");
  const completedTasks = getCompletedTaskCount(feature.tasks);
  const autoProgress = calculateFeatureProgressFromTasks(feature.tasks);
  const featureAssignees = useMemo(() => {
    const deduped = new Map<string, NonNullable<RoadmapTask["assignee"]>>();

    for (const task of feature.tasks ?? []) {
      const assigneeId = task.assignee_id ?? task.assignee?.id;
      if (!assigneeId || !task.assignee) continue;
      if (!deduped.has(assigneeId)) deduped.set(assigneeId, task.assignee);
    }

    return Array.from(deduped.values());
  }, [feature.tasks]);

  useEffect(() => {
    const el = descriptionRef.current;
    if (!el) return;
    setHasOverflow(el.scrollHeight > el.clientHeight + 1);
  }, [feature.description]);

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
  const isGlobalTaskDropHighlight = toolbarDraggingType === "task";

  const renderAssigneeAvatar = (
    assignee: NonNullable<RoadmapTask["assignee"]>,
  ) => {
    if (assignee.avatar_url) {
      return (
        <img
          src={assignee.avatar_url}
          alt={assignee.display_name ?? assignee.email ?? "Assignee"}
          className="w-6 h-6 rounded-full object-cover ring-1 ring-white"
        />
      );
    }

    const source = assignee.display_name ?? assignee.email ?? "?";
    const initials = source
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

    return (
      <div className="w-6 h-6 rounded-full bg-black text-white text-[9px] font-bold flex items-center justify-center ring-1 ring-white">
        {initials}
      </div>
    );
  };

  return (
    <>
      <motion.div
        className={`relative group bg-white border-2 rounded-4xl shadow-md hover:shadow-lg transition-all duration-200 w-[500px] max-h-80 flex flex-col ${canEditRoadmap ? "cursor-pointer active:cursor-grabbing" : "cursor-pointer"} ${
          isPulsing && !isReducedMotion ? "roadmap-widget-light-pulse" : ""
        } ${isOptimisticFeature ? "opacity-75" : ""} ${
          isCardTaskDropActive
            ? "border-emerald-500 ring-2 ring-emerald-300 shadow-[0_0_0_1px_rgba(16,185,129,0.3),0_12px_24px_rgba(16,185,129,0.22)]"
            : isGlobalTaskDropHighlight
              ? "border-emerald-400 ring-2 ring-emerald-200 shadow-[0_0_0_1px_rgba(16,185,129,0.22),0_10px_24px_rgba(16,185,129,0.18)]"
              : getWidgetBorderColor(derivedStatus)
        }`}
        onClick={() => onClick?.(feature)}
        onDragEnter={(event) => {
          if (!onAddTask || getToolbarItemType(event) !== "task") return;
          event.preventDefault();
          event.stopPropagation();
          setIsCardTaskDropActive(true);
        }}
        onDragOver={(event) => {
          if (!onAddTask || getToolbarItemType(event) !== "task") return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          setIsCardTaskDropActive(true);
        }}
        onDragLeave={() => {
          setIsCardTaskDropActive(false);
        }}
        onDrop={(event) => {
          const itemType = getToolbarItemType(event);
          setIsCardTaskDropActive(false);
          if (!onAddTask || itemType !== "task") return;
          event.preventDefault();
          event.stopPropagation();
          onAddTask(feature.id);
        }}
        initial={isReducedMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
        animate={isReducedMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
        transition={
          isReducedMotion ? undefined : { duration: 0.25, ease: "easeOut" }
        }
      >
        {/* Deliverable indicator */}
        {feature.is_deliverable && (
          <div className="absolute -top-2 -right-2 w-6 h-6 bg-amber-500 text-white rounded-full flex items-center justify-center text-xs font-bold shadow">
            ★
          </div>
        )}

        {/* Invisible handles for edge connections */}
        <Handle
          type="target"
          position={Position.Left}
          className="w-3 h-3 opacity-0"
        />
        <Handle
          type="source"
          position={Position.Right}
          className="w-3 h-3 opacity-0"
        />

        {onAddTask && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onAddTask(feature.id);
            }}
            onDragEnter={(event) => {
              if (getToolbarItemType(event) !== "task") return;
              event.preventDefault();
              setIsAddTaskDropActive(true);
            }}
            onDragOver={(event) => {
              if (getToolbarItemType(event) !== "task") return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setIsAddTaskDropActive(true);
            }}
            onDragLeave={() => {
              setIsAddTaskDropActive(false);
            }}
            onDrop={(event) => {
              setIsAddTaskDropActive(false);
              if (getToolbarItemType(event) !== "task") return;
              event.preventDefault();
              event.stopPropagation();
              onAddTask(feature.id);
            }}
            className={`absolute top-1/2 -translate-y-1/2 -right-4 w-8 h-8 rounded-full bg-emerald-500 text-white shadow-lg flex items-center justify-center hover:bg-emerald-400 transition-all duration-200 ease-out z-10 cursor-pointer ${
              toolbarDraggingType === "task"
                ? `opacity-100 scale-100 ring-2 ${
                    isAddTaskDropActive
                      ? "ring-emerald-400 shadow-[0_0_0_1px_rgba(16,185,129,0.35),0_10px_22px_rgba(16,185,129,0.35)]"
                      : "ring-emerald-300 shadow-[0_0_0_1px_rgba(16,185,129,0.24),0_8px_18px_rgba(16,185,129,0.28)]"
                  }`
                : "opacity-0 group-hover:opacity-100 scale-95 group-hover:scale-100"
            }`}
            title="Add task"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}

        <div className="p-10 flex flex-col h-full overflow-hidden">
          {/* Header */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1"></div>
              <h4 className="font-semibold text-gray-900 text-sm leading-tight wrap-break-word">
                {feature.title}
              </h4>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0">
              {onEdit && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(feature);
                  }}
                  className="p-1 hover:bg-amber-100 rounded transition-colors"
                  title="Edit feature"
                >
                  <Edit2 className="w-3 h-3 text-gray-600" />
                </button>
              )}
              {onDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(feature.id);
                  }}
                  className="p-1 hover:bg-red-100 rounded transition-colors"
                  title="Delete feature"
                >
                  <Trash2 className="w-3 h-3 text-red-600" />
                </button>
              )}
            </div>
          </div>

          {/* Description */}
          {feature.description && (
            <div
              ref={descriptionRef}
              className="relative mb-2 grow overflow-y-auto pr-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <div
                className="text-sm text-gray-600 leading-relaxed prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: feature.description }}
              />
              {hasOverflow && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-white to-white/0" />
              )}
            </div>
          )}

          {/* Status Badge */}
          <div className="flex items-center gap-2 mb-2">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded border ${getStatusColor(derivedStatus)}`}
            >
              {getStatusIcon(derivedStatus)}
              {derivedStatus.replace(/_/g, " ")}
            </span>

            {featureAssignees.length > 0 && (
              <div className="ml-auto flex items-center">
                {featureAssignees.slice(0, 4).map((assignee, index) => (
                  <div
                    key={assignee.id}
                    className={index > 0 ? "-ml-1.5" : ""}
                    title={
                      assignee.display_name ?? assignee.email ?? "Assignee"
                    }
                  >
                    {renderAssigneeAvatar(assignee)}
                  </div>
                ))}
                {featureAssignees.length > 4 && (
                  <span className="-ml-1.5 w-6 h-6 rounded-full bg-gray-100 border border-white flex items-center justify-center text-[9px] font-semibold text-gray-600">
                    +{featureAssignees.length - 4}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Progress Bar (auto-calculated from task statuses) */}
          {taskCount > 0 && (
            <div className="mb-2">
              <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                <span>Progress</span>
                <span className="font-medium">{autoProgress}%</span>
              </div>
              <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all duration-300"
                  style={{ width: `${autoProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Task count or indicator */}
          {showTaskCount && (
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1 text-gray-600">
                <List className="w-3 h-3" />
                <span>
                  {taskCount} task{taskCount !== 1 ? "s" : ""}
                </span>
              </div>
              {taskCount > 0 && (
                <span className="text-gray-500">
                  {completedTasks}/{taskCount} done
                </span>
              )}
            </div>
          )}

          {/* Estimated hours */}
          {feature.estimated_hours && (
            <div className="mt-2 text-xs text-gray-500 text-right">
              ~{feature.estimated_hours}h
            </div>
          )}

          {/* Date range */}
          {(feature.start_date || feature.end_date) && (
            <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
              <Calendar className="w-3 h-3 shrink-0" />
              <span>
                {feature.start_date
                  ? new Date(feature.start_date).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })
                  : "—"}
                {" → "}
                {feature.end_date
                  ? new Date(feature.end_date).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })
                  : "—"}
              </span>
            </div>
          )}
        </div>
      </motion.div>

      {taskCount > 0 && (
        <>
          {/* Connecting line from feature to tasks */}
          <div className="absolute top-1/2 -translate-y-1/2 left-[500px] w-10 h-0.5 bg-emerald-400" />

          {/* Task List - positioned to the right */}
          <div
            className="absolute top-1/2 -translate-y-1/2 left-[540px] rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden cursor-pointer"
            onClick={(e) => { e.stopPropagation(); setIsTaskListModalOpen(true); }}
            title="View all tasks"
          >
            {/* Task list header */}
            <div className="flex items-center justify-between px-2.5 pt-2 pb-1 hover:bg-gray-50 transition-colors">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Tasks · {feature.tasks?.length ?? 0}
              </span>
              <Maximize2 className="w-3 h-3 text-gray-500" />
            </div>

            <div className="max-h-56 overflow-y-auto p-1.5 pt-0">
              <div className="grid grid-flow-col grid-rows-3 gap-1.5 auto-cols-max">
                {feature.tasks?.slice(0, 9).map((task) => (
                  <div key={task.id} className="w-[190px]" onClick={(e) => e.stopPropagation()}>
                    <TaskListItem
                      task={task}
                      density="compact"
                      isRunning={runningTaskId === task.id}
                      pulseToken={
                        pulseTaskId === task.id ? pulseTaskToken : undefined
                      }
                      onClick={onSelectTask}
                      onToggleComplete={(taskId) => {
                        const taskToUpdate = feature.tasks?.find(
                          (t) => t.id === taskId,
                        );
                        if (!taskToUpdate) return;
                        safelyUpdateTask({
                          ...taskToUpdate,
                          status:
                            taskToUpdate.status === "done" ? "todo" : "done",
                        });
                      }}
                      onUpdateStatus={(taskId, status) => {
                        const taskToUpdate = feature.tasks?.find(
                          (t) => t.id === taskId,
                        );
                        if (!taskToUpdate) return;
                        safelyUpdateTask({
                          ...taskToUpdate,
                          status,
                        });
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {isTaskListModalOpen && (
            <TaskListModal
              feature={feature}
              onClose={() => setIsTaskListModalOpen(false)}
              onUpdateTask={safelyUpdateTask}
              onSelectTask={onSelectTask ? (task) => {
                setIsTaskListModalOpen(false);
                onSelectTask(task);
              } : undefined}
            />
          )}
        </>
      )}
    </>
  );
});

FeatureWidget.displayName = "FeatureWidget";
