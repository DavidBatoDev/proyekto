import { memo, useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  Edit2,
  Trash2,
  CheckCircle2,
  User,
  Maximize2,
} from "lucide-react";
import type { RoadmapTask, ChecklistItem } from "@/types/roadmap";
import { TaskStatusBadge } from "@/components/common/SemanticBadge";
import { SidePanel } from "@/components/roadmap/panels/SidePanel";

export interface TaskWidgetData extends Record<string, unknown> {
  task: RoadmapTask;
  onEdit?: (task: RoadmapTask) => void;
  onDelete?: (taskId: string) => void;
  onClick?: (task: RoadmapTask) => void;
  onUpdateTask?: (task: RoadmapTask) => void;
  showHandles?: boolean;
  variant?: "flow" | "epic";
  projectId?: string;
}

type TaskWidgetNode = Node<TaskWidgetData>;

const getPriorityColor = (priority: RoadmapTask["priority"]) => {
  switch (priority) {
    case "urgent":
      return "text-red-600";
    case "high":
      return "text-orange-600";
    case "medium":
      return "text-yellow-600";
    case "low":
      return "text-green-600";
    default:
      return "text-gray-600";
  }
};

interface TaskCardProps {
  task: RoadmapTask;
  onEdit?: (task: RoadmapTask) => void;
  onDelete?: (taskId: string) => void;
  onClick?: (task: RoadmapTask) => void;
  onExpand?: (task: RoadmapTask) => void;
  selected?: boolean;
  variant?: "flow" | "epic";
}

export const TaskCard = memo(
  ({
    task,
    onEdit,
    onDelete,
    onClick,
    onExpand,
    selected = false,
    variant = "epic",
  }: TaskCardProps) => {
    const containerClass =
      variant === "epic"
        ? "relative bg-white border rounded-2xl shadow-sm hover:shadow-md transition-all w-60 h-[180px] overflow-hidden cursor-pointer"
        : "relative bg-white border-2 rounded-4xl shadow-sm hover:shadow-md transition-all min-w-[200px] max-w-[240px] cursor-pointer";

    const borderClass =
      variant === "epic"
        ? selected
          ? "border-emerald-400 ring-2 ring-emerald-100"
          : "border-emerald-200 hover:border-emerald-300"
        : selected
          ? "border-emerald-500 ring-2 ring-emerald-200"
          : "border-emerald-300 hover:border-emerald-400";

    const completedChecklist =
      task.checklist?.filter((item: ChecklistItem) => item.completed).length ||
      0;
    const totalChecklist = task.checklist?.length || 0;

    return (
      <div
        className={`${containerClass} ${borderClass}`}
        onClick={() => onClick?.(task)}
      >
        <div className="p-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-emerald-700 uppercase tracking-wider">
                  Task
                </span>
                {task.priority && (
                  <span
                    className={`text-xs font-bold ${getPriorityColor(task.priority)}`}
                  >
                    {task.priority === "urgent"
                      ? "!!!"
                      : task.priority === "high"
                        ? "!!"
                        : task.priority === "medium"
                          ? "!"
                          : ""}
                  </span>
                )}
              </div>
              <h5
                title={task.title}
                className="font-semibold text-gray-900 text-sm leading-tight wrap-break-word"
              >
                {task.title}
              </h5>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0">
              {onExpand && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onExpand(task);
                  }}
                  className="p-1 hover:bg-blue-100 rounded transition-colors"
                  title="Expand task"
                >
                  <Maximize2 className="w-3 h-3 text-blue-600" />
                </button>
              )}
              {onEdit && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(task);
                  }}
                  className="p-1 hover:bg-emerald-100 rounded transition-colors"
                  title="Edit task"
                >
                  <Edit2 className="w-3 h-3 text-gray-600" />
                </button>
              )}
              {onDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(task.id);
                  }}
                  className="p-1 hover:bg-red-100 rounded transition-colors"
                  title="Delete task"
                >
                  <Trash2 className="w-3 h-3 text-red-600" />
                </button>
              )}
            </div>
          </div>

          {/* Description */}
          {task.description && (
            <p className="text-xs text-gray-600 mb-2 line-clamp-1">
              {task.description.replace(/<[^>]+>/g, "")}
            </p>
          )}

          {/* Status Badge */}
          <div className="mb-2">
            <TaskStatusBadge status={task.status} />
          </div>

          {/* Assignee */}
          {task.assignee && (
            <div className="flex items-center gap-2 mb-2">
              {task.assignee.avatar_url ? (
                <img
                  src={task.assignee.avatar_url}
                  alt={task.assignee.display_name}
                  className="w-5 h-5 rounded-full border border-gray-300"
                />
              ) : (
                <div className="w-5 h-5 rounded-full bg-gray-300 flex items-center justify-center">
                  <User className="w-3 h-3 text-gray-600" />
                </div>
              )}
              <span className="text-xs text-gray-600 truncate">
                {task.assignee.display_name || "Unassigned"}
              </span>
            </div>
          )}

          {/* Checklist progress */}
          {totalChecklist > 0 && (
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <CheckCircle2 className="w-3 h-3" />
              <span>
                {completedChecklist}/{totalChecklist} checks
              </span>
            </div>
          )}

          {/* Due date */}
          {task.due_date && (
            <div className="mt-2 text-xs text-gray-500">
              Due: {new Date(task.due_date).toLocaleDateString()}
            </div>
          )}

          {/* Labels */}
          {task.labels && task.labels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {task.labels.slice(0, 2).map((label: string, idx: number) => (
                <span
                  key={idx}
                  className="px-1.5 py-0.5 text-xs bg-gray-200 text-gray-700 rounded"
                >
                  {label}
                </span>
              ))}
              {task.labels.length > 2 && (
                <span className="text-xs text-gray-500">
                  +{task.labels.length - 2}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  },
);

export const TaskWidget = memo(
  ({ data, selected }: NodeProps<TaskWidgetNode>) => {
    const {
      task,
      onEdit,
      onDelete,
      onClick,
      onUpdateTask,
      showHandles = false,
      variant = "flow",
      projectId,
    } = data;

    const [expandedTask, setExpandedTask] = useState<RoadmapTask | null>(null);

    const handleExpand = (t: RoadmapTask) => setExpandedTask(t);
    const handleCloseExpand = () => setExpandedTask(null);
    const handleUpdateExpanded = (updated: RoadmapTask) => {
      onUpdateTask?.(updated);
      setExpandedTask(null);
    };
    const handleDeleteExpanded = (taskId: string) => {
      onDelete?.(taskId);
      setExpandedTask(null);
    };

    return (
      <div>
        {showHandles && (
          <Handle
            type="target"
            position={Position.Left}
            className="w-3 h-3 bg-emerald-400 border-2 border-white"
          />
        )}

        <TaskCard
          task={task}
          onEdit={onEdit}
          onDelete={onDelete}
          onClick={onClick}
          onExpand={onUpdateTask ? handleExpand : undefined}
          selected={selected}
          variant={variant}
        />

        {expandedTask && (
          <SidePanel
            task={expandedTask}
            isOpen={true}
            onClose={handleCloseExpand}
            onUpdateTask={handleUpdateExpanded}
            onDeleteTask={handleDeleteExpanded}
            projectId={projectId}
            asModal
          />
        )}
      </div>
    );
  },
);

TaskWidget.displayName = "TaskWidget";
