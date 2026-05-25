import { memo, useMemo, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useDroppable } from "@dnd-kit/core";
import { Check, Trash2, ChevronDown, Search, UserPlus } from "lucide-react";
import type { RoadmapTask, TaskStatus } from "@/types/roadmap";
import { useRoadmapStore } from "@/stores/roadmapStore";
import { useProjectMembersQuery } from "@/hooks/useProjectQueries";
import { recordRecentAssignment } from "@/hooks/useRecentAssignees";
import { useToast } from "@/contexts/ToastContext";
import type { ProjectMember } from "@/services/project.service";

const getInitials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

const getMemberDisplayName = (member: ProjectMember): string => {
  const u = member.user;
  if (!u) return member.position ?? "Member";
  if (u.display_name && u.display_name.trim()) return u.display_name;
  const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  if (full) return full;
  return u.email ?? "Member";
};

const resolveAssigneeName = (
  assignee: NonNullable<RoadmapTask["assignee"]> | undefined,
): string | null => {
  if (!assignee) return null;
  if (assignee.display_name && assignee.display_name.trim())
    return assignee.display_name;
  const full = [assignee.first_name, assignee.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (full) return full;
  return assignee.email ?? null;
};

interface TaskListItemProps {
  task: RoadmapTask;
  onDelete?: (taskId: string) => void;
  onClick?: (task: RoadmapTask) => void;
  onToggleComplete?: (taskId: string) => void;
  onUpdateStatus?: (taskId: string, status: TaskStatus) => void;
  density?: "normal" | "compact";
  pulseToken?: number;
  isRunning?: boolean;
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
      isRunning = false,
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

    const toast = useToast();
    const projectId = useRoadmapStore(
      (state) => state.roadmap?.project_id ?? "",
    );
    const membersQuery = useProjectMembersQuery(projectId);
    const members = useMemo<ProjectMember[]>(
      () => membersQuery.data ?? [],
      [membersQuery.data],
    );

    const [isAssigneeMenuOpen, setIsAssigneeMenuOpen] = useState(false);
    const [assigneeSearch, setAssigneeSearch] = useState("");
    const [assigneeMenuPosition, setAssigneeMenuPosition] = useState({
      top: 0,
      left: 0,
    });
    const [isSavingAssignee, setIsSavingAssignee] = useState(false);
    const assigneeTriggerRef = useRef<HTMLButtonElement>(null);
    const assigneeMenuRef = useRef<HTMLDivElement>(null);

    const ASSIGNEE_MENU_WIDTH = 240;

    const updateAssigneeMenuPosition = () => {
      const rect = assigneeTriggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const preferredLeft = rect.right - ASSIGNEE_MENU_WIDTH;
      const clampedLeft = Math.max(
        8,
        Math.min(preferredLeft, window.innerWidth - ASSIGNEE_MENU_WIDTH - 8),
      );
      setAssigneeMenuPosition({
        top: rect.bottom + 6,
        left: clampedLeft,
      });
    };

    const filteredMembers = useMemo(() => {
      const q = assigneeSearch.trim().toLowerCase();
      if (!q) return members;
      return members.filter((member) => {
        const name = member.user?.display_name ?? "";
        const email = member.user?.email ?? "";
        const role = member.role ?? "";
        const first = member.user?.first_name ?? "";
        const last = member.user?.last_name ?? "";
        return (
          name.toLowerCase().includes(q) ||
          email.toLowerCase().includes(q) ||
          role.toLowerCase().includes(q) ||
          first.toLowerCase().includes(q) ||
          last.toLowerCase().includes(q)
        );
      });
    }, [assigneeSearch, members]);

    const currentAssigneeId = task.assignee_id ?? task.assignee?.id ?? null;

    const applyAssignment = async (member: ProjectMember | null) => {
      if (isSavingAssignee) return;
      const latestEpics = useRoadmapStore.getState().epics;
      const currentTask = latestEpics
        .flatMap((epic) => epic.features ?? [])
        .flatMap((feature) => feature.tasks ?? [])
        .find((candidate) => candidate.id === task.id);
      if (!currentTask) return;

      const nextAssigneeId = member?.user_id ?? undefined;
      if ((currentTask.assignee_id ?? null) === (nextAssigneeId ?? null)) {
        setIsAssigneeMenuOpen(false);
        return;
      }

      const nextTask: RoadmapTask = {
        ...currentTask,
        assignee_id: nextAssigneeId,
        assignee: member?.user
          ? {
              id: member.user.id,
              display_name: member.user.display_name,
              avatar_url: member.user.avatar_url,
              email: member.user.email,
              first_name: member.user.first_name,
              last_name: member.user.last_name,
            }
          : undefined,
      };

      setIsSavingAssignee(true);
      try {
        await useRoadmapStore.getState().updateTask(nextTask);
        if (nextAssigneeId) {
          recordRecentAssignment(projectId, nextAssigneeId);
          const name =
            (member?.user?.display_name && member.user.display_name.trim()) ||
            member?.user?.email ||
            "member";
          toast.success(`Assigned ${name} to "${currentTask.title}"`);
        } else {
          toast.success(`Unassigned "${currentTask.title}"`);
        }
      } catch {
        toast.error("Failed to update task assignee");
      } finally {
        setIsSavingAssignee(false);
        setIsAssigneeMenuOpen(false);
      }
    };

    const { setNodeRef: setDropRef, isOver, active } = useDroppable({
      id: `task-drop-${task.id}`,
      data: {
        type: "task-assignee",
        taskId: task.id,
        currentAssigneeId: task.assignee_id ?? null,
        currentAssigneeName: resolveAssigneeName(task.assignee),
      },
    });
    const isAssigneeDragOver =
      isOver && active?.data.current?.type === "assignee";

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

        const isInAssigneeTrigger =
          assigneeTriggerRef.current?.contains(target);
        const isInAssigneeMenu = assigneeMenuRef.current?.contains(target);
        if (!isInAssigneeTrigger && !isInAssigneeMenu) {
          setIsAssigneeMenuOpen(false);
        }
      };

      const handleEscape = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        setIsStatusOpen(false);
        setIsCheckboxMenuOpen(false);
        setIsAssigneeMenuOpen(false);
      };

      if (isStatusOpen || isCheckboxMenuOpen || isAssigneeMenuOpen) {
        if (isStatusOpen) updateDropdownPosition();
        if (isAssigneeMenuOpen) updateAssigneeMenuPosition();
        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("keydown", handleEscape);
        return () => {
          document.removeEventListener("mousedown", handleClickOutside);
          document.removeEventListener("keydown", handleEscape);
        };
      }
    }, [isStatusOpen, isCheckboxMenuOpen, isAssigneeMenuOpen]);

    // Reposition dropdown on scroll
    useEffect(() => {
      if (!isStatusOpen && !isCheckboxMenuOpen && !isAssigneeMenuOpen) return;

      const handleReposition = () => {
        updateDropdownPosition();

        if (checkboxButtonRef.current && isCheckboxMenuOpen) {
          const rect = checkboxButtonRef.current.getBoundingClientRect();
          setCheckboxMenuPosition({
            top: rect.bottom + 6,
            left: rect.left,
          });
        }

        if (isAssigneeMenuOpen) updateAssigneeMenuPosition();
      };

      window.addEventListener("scroll", handleReposition, true);
      window.addEventListener("resize", handleReposition);
      return () => {
        window.removeEventListener("scroll", handleReposition, true);
        window.removeEventListener("resize", handleReposition);
      };
    }, [isStatusOpen, isCheckboxMenuOpen, isAssigneeMenuOpen]);

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
        ref={setDropRef}
        data-task-id={task.id}
        className={`nodrag flex items-center transition-colors border group ${
          isCompact ? "gap-2 px-0 py-0" : "gap-3 px-4 py-3"
        } ${isPulsing ? "roadmap-task-row-pulse" : ""} ${
          isOptimisticTask ? "opacity-75" : ""
        } ${
          isAssigneeDragOver
            ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-300"
            : isRunning
              ? "border-emerald-300 bg-emerald-50/70 ring-1 ring-emerald-200"
              : "border-transparent hover:border-gray-200 hover:bg-gray-50"
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

        {/* Assignee avatar (click to open picker) */}
        <button
          ref={assigneeTriggerRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!isAssigneeMenuOpen) {
              setAssigneeSearch("");
              updateAssigneeMenuPosition();
            }
            setIsAssigneeMenuOpen((prev) => !prev);
          }}
          disabled={isSavingAssignee}
          title={
            task.assignee
              ? `Assigned to ${resolveAssigneeName(task.assignee) ?? "member"} — click to change`
              : "Click to assign a member"
          }
          className={`shrink-0 rounded-full transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 disabled:opacity-60 ${
            isCompact ? "w-5 h-5" : "w-6 h-6"
          } ${
            isSavingAssignee ? "animate-pulse" : "hover:ring-2 hover:ring-orange-200"
          }`}
        >
          {task.assignee?.avatar_url ? (
            <img
              src={task.assignee.avatar_url}
              alt=""
              draggable={false}
              className={`rounded-full object-cover ring-1 ring-white shadow-sm ${
                isCompact ? "w-5 h-5" : "w-6 h-6"
              }`}
            />
          ) : task.assignee ? (
            <div
              className={`rounded-full flex items-center justify-center font-semibold bg-linear-to-br from-slate-200 to-slate-300 text-slate-700 ring-1 ring-white shadow-sm ${
                isCompact ? "w-5 h-5 text-[9px]" : "w-6 h-6 text-[10px]"
              }`}
            >
              {getInitials(resolveAssigneeName(task.assignee) ?? "?")}
            </div>
          ) : (
            <div
              className={`rounded-full flex items-center justify-center border border-dashed border-gray-300 text-gray-400 bg-white hover:text-gray-600 hover:border-gray-400 ${
                isCompact ? "w-5 h-5" : "w-6 h-6"
              }`}
            >
              <UserPlus className={isCompact ? "w-2.5 h-2.5" : "w-3 h-3"} />
            </div>
          )}
        </button>

        {isAssigneeMenuOpen &&
          createPortal(
            <div
              ref={assigneeMenuRef}
              className="fixed z-80 bg-white border border-gray-200 rounded-lg shadow-lg p-2"
              style={{
                top: assigneeMenuPosition.top,
                left: assigneeMenuPosition.left,
                width: ASSIGNEE_MENU_WIDTH,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative mb-2">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={assigneeSearch}
                  onChange={(e) => setAssigneeSearch(e.target.value)}
                  placeholder="Search members..."
                  className="w-full pl-8 pr-2 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-400/30"
                  autoFocus
                />
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void applyAssignment(null);
                }}
                disabled={isSavingAssignee}
                className="w-full px-2 py-2 text-left text-sm rounded-md hover:bg-gray-50 flex items-center justify-between disabled:opacity-60"
              >
                <span className="flex items-center gap-2 text-gray-700">
                  <span className="w-6 h-6 rounded-full flex items-center justify-center border border-dashed border-gray-300 text-gray-400 bg-white">
                    <UserPlus className="w-3 h-3" />
                  </span>
                  Unassigned
                </span>
                {!currentAssigneeId && (
                  <Check className="w-4 h-4 text-orange-500" />
                )}
              </button>

              <div className="max-h-56 overflow-y-auto mt-1">
                {filteredMembers.map((member) => {
                  const isSelected = member.user_id === currentAssigneeId;
                  const memberName = getMemberDisplayName(member);
                  const avatarUrl = member.user?.avatar_url ?? null;
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void applyAssignment(member);
                      }}
                      disabled={isSavingAssignee}
                      className="w-full px-2 py-2 text-left text-sm rounded-md hover:bg-gray-50 flex items-center justify-between gap-2 disabled:opacity-60"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        {avatarUrl ? (
                          <img
                            src={avatarUrl}
                            alt=""
                            draggable={false}
                            className="w-6 h-6 rounded-full object-cover shrink-0"
                          />
                        ) : (
                          <span className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[10px] font-semibold bg-linear-to-br from-slate-200 to-slate-300 text-slate-700">
                            {getInitials(memberName)}
                          </span>
                        )}
                        <span className="truncate text-gray-700">
                          {memberName}
                        </span>
                      </span>
                      {isSelected && (
                        <Check className="w-4 h-4 text-orange-500 shrink-0" />
                      )}
                    </button>
                  );
                })}
                {filteredMembers.length === 0 && (
                  <p className="px-2 py-2 text-xs text-gray-400">
                    No members found
                  </p>
                )}
              </div>
            </div>,
            document.body,
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
