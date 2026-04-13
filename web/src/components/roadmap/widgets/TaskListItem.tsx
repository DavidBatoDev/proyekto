import { memo, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Check, Trash2, ChevronDown } from "lucide-react";
import type { RoadmapTask, TaskStatus } from "@/types/roadmap";

interface TaskListItemProps {
  task: RoadmapTask;
  onDelete?: (taskId: string) => void;
  onClick?: (task: RoadmapTask) => void;
  onToggleComplete?: (taskId: string) => void;
  onUpdateStatus?: (taskId: string, status: TaskStatus) => void;
  density?: "normal" | "compact";
  pulseToken?: number;
}

const STATUS_OPTIONS: TaskStatus[] = [
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
];

const getStatusColor = (status: RoadmapTask["status"]) => {
  switch (status) {
    case "done":
      return "bg-green-100 text-green-800";
    case "in_progress":
      return "bg-blue-100 text-blue-800";
    case "in_review":
      return "bg-purple-100 text-purple-800";
    case "blocked":
      return "bg-red-100 text-red-800";
    case "todo":
      return "bg-gray-100 text-gray-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
};

const getCheckboxStyle = (status: TaskStatus) => {
  switch (status) {
    case "in_progress":
      return {
        box: "border-blue-500 bg-blue-50 text-blue-600",
        mark: "-",
      };
    case "in_review":
      return {
        box: "border-purple-500 bg-purple-50 text-purple-600",
        mark: "o",
      };
    case "done":
      return {
        box: "border-emerald-500 bg-emerald-500 text-white",
        mark: "check",
      };
    case "blocked":
      return {
        box: "border-red-500 bg-red-50 text-red-600",
        mark: "X",
      };
    case "todo":
    default:
      return {
        box: "border-gray-300 bg-white text-transparent",
        mark: "",
      };
  }
};

const getCategoryLabel = (task: RoadmapTask): string | null => {
  // Use labels or assignee to determine category
  if (task.labels && task.labels.length > 0) {
    return task.labels[0].toUpperCase();
  }
  return null;
};

export const TaskListItem = memo(
  ({
    task,
    onDelete,
    onClick,
    onToggleComplete,
    onUpdateStatus,
    density = "normal",
    pulseToken,
  }: TaskListItemProps) => {
    const isCompleted = task.status === "done";
    const isOptimisticTask = task.id.startsWith("temp-");
    const categoryLabel = getCategoryLabel(task);
    const isCompact = density === "compact";
    const [isStatusOpen, setIsStatusOpen] = useState(false);
    const statusDropdownRef = useRef<HTMLDivElement>(null);
    const dropdownMenuRef = useRef<HTMLDivElement>(null);
    const [isCheckboxMenuOpen, setIsCheckboxMenuOpen] = useState(false);
    const checkboxButtonRef = useRef<HTMLButtonElement>(null);
    const checkboxMenuRef = useRef<HTMLDivElement>(null);
    const [checkboxMenuPosition, setCheckboxMenuPosition] = useState({
      top: 0,
      left: 0,
    });
    const [dropdownPosition, setDropdownPosition] = useState({
      top: 0,
      left: 0,
    });
    const [isPulsing, setIsPulsing] = useState(false);

    const checkboxStyle = getCheckboxStyle(task.status);

    const updateDropdownPosition = () => {
      if (!statusDropdownRef.current) return;
      const rect = statusDropdownRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.right - 160,
      });
    };

    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as Node;
        const isInTrigger = statusDropdownRef.current?.contains(target);
        const isInMenu = dropdownMenuRef.current?.contains(target);
        if (!isInTrigger && !isInMenu) setIsStatusOpen(false);

        const isInCheckbox = checkboxButtonRef.current?.contains(target);
        const isInCheckboxMenu = checkboxMenuRef.current?.contains(target);
        if (!isInCheckbox && !isInCheckboxMenu) setIsCheckboxMenuOpen(false);
      };

      if (isStatusOpen || isCheckboxMenuOpen) {
        if (isStatusOpen) updateDropdownPosition();
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
          document.removeEventListener("mousedown", handleClickOutside);
        };
      }
    }, [isStatusOpen, isCheckboxMenuOpen]);

    // Reposition dropdown on scroll
    useEffect(() => {
      if (!isStatusOpen && !isCheckboxMenuOpen) return;

      const handleReposition = () => {
        updateDropdownPosition();

        if (checkboxButtonRef.current && isCheckboxMenuOpen) {
          const rect = checkboxButtonRef.current.getBoundingClientRect();
          setCheckboxMenuPosition({
            top: rect.bottom + 6,
            left: rect.left,
          });
        }
      };

      window.addEventListener("scroll", handleReposition, true);
      window.addEventListener("resize", handleReposition);
      return () => {
        window.removeEventListener("scroll", handleReposition, true);
        window.removeEventListener("resize", handleReposition);
      };
    }, [isStatusOpen, isCheckboxMenuOpen]);

    useEffect(() => {
      if (!pulseToken) return;
      setIsPulsing(true);
      const timeoutId = window.setTimeout(() => {
        setIsPulsing(false);
      }, 900);
      return () => {
        window.clearTimeout(timeoutId);
      };
    }, [pulseToken]);

    return (
      <div
        data-task-id={task.id}
        className={`flex items-center transition-colors border border-transparent hover:border-gray-200 group ${
          isCompact ? "gap-2 px-0 py-0" : "gap-3 px-4 py-3"
        } hover:bg-gray-50 ${isPulsing ? "roadmap-task-row-pulse" : ""} ${
          isOptimisticTask ? "opacity-75" : ""
        }`}
        onClick={() => onClick?.(task)}
      >
        {/* Checkbox */}
        <button
          ref={checkboxButtonRef}
          onClick={(e) => {
            e.stopPropagation();
            onToggleComplete?.(task.id);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setCheckboxMenuPosition({
              top: e.clientY,
              left: e.clientX,
            });
            setIsCheckboxMenuOpen(true);
          }}
          className={`shrink-0 rounded border-2 flex items-center justify-center transition-all ${
            isCompact ? "w-4 h-4" : "w-5 h-5"
          } ${checkboxStyle.box}`}
          title={isCompleted ? "Mark as incomplete" : "Mark as complete"}
        >
          {checkboxStyle.mark === "check" ? (
            <Check
              className={
                isCompact ? "w-2.5 h-2.5 text-white" : "w-3 h-3 text-white"
              }
            />
          ) : (
            <span
              className={`${isCompact ? "text-[10px]" : "text-[11px]"} leading-none font-bold`}
            >
              {checkboxStyle.mark}
            </span>
          )}
        </button>

        {isCheckboxMenuOpen &&
          createPortal(
            <div
              ref={checkboxMenuRef}
              className="fixed z-80 bg-white border border-gray-300 rounded-md shadow-lg py-1 min-w-[150px]"
              style={{
                top: checkboxMenuPosition.top,
                left: checkboxMenuPosition.left,
              }}
            >
              {STATUS_OPTIONS.map((status) => (
                <button
                  key={status}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdateStatus?.(task.id, status);
                    setIsCheckboxMenuOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs capitalize hover:bg-gray-100 ${task.status === status ? "bg-gray-50 font-semibold" : ""}`}
                >
                  {status.replace(/_/g, " ")}
                </button>
              ))}
            </div>,
            document.body,
          )}

        {/* Task Title */}
        <div className="flex-1 min-w-0">
          <p
            className={`truncate ${
              isCompact ? "text-xs" : "text-sm"
            } font-medium ${
              isCompleted ? "text-gray-400 line-through" : "text-gray-900"
            }`}
          >
            {task.title}
          </p>
        </div>

        {/* Category/Assignee Badge */}
        {categoryLabel && (
          <span
            className={`shrink-0 rounded font-semibold bg-gray-200 text-gray-700 ${
              isCompact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs"
            }`}
          >
            {categoryLabel}
          </span>
        )}

        {/* Status Dropdown */}
        <div className="relative shrink-0" ref={statusDropdownRef}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsStatusOpen(!isStatusOpen);
            }}
            className={`inline-flex items-center gap-1 font-medium rounded transition-colors ${
              isCompact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs"
            } ${getStatusColor(task.status)} hover:opacity-80 cursor-pointer`}
          >
            {task.status.replace(/_/g, " ")}
            <ChevronDown className={isCompact ? "w-2.5 h-2.5" : "w-3 h-3"} />
          </button>

          {/* Dropdown Menu - Rendered via Portal */}
          {isStatusOpen &&
            statusDropdownRef.current &&
            createPortal(
              <div
                ref={dropdownMenuRef}
                className="fixed bg-white border border-gray-300 rounded shadow-lg z-70"
                style={{
                  top: dropdownPosition.top,
                  left: dropdownPosition.left,
                  width: "160px",
                }}
              >
                {STATUS_OPTIONS.map((status) => (
                  <button
                    key={status}
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateStatus?.(task.id, status);
                      setIsStatusOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 transition-colors ${
                      task.status === status
                        ? "bg-gray-200 text-black font-semibold"
                        : "hover:bg-gray-100"
                    }`}
                  >
                    {status.replace(/_/g, " ")}
                  </button>
                ))}
              </div>,
              document.body,
            )}
        </div>

        {/* Actions (shown on hover) */}
        <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(task.id);
              }}
              className="p-1 hover:bg-red-100 rounded transition-colors"
              title="Delete task"
            >
              <Trash2 className="w-4 h-4 text-red-600" />
            </button>
          )}
        </div>
      </div>
    );
  },
);

TaskListItem.displayName = "TaskListItem";
