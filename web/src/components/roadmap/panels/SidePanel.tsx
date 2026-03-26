import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Calendar,
  Tag,
  CheckSquare,
  User,
  Search,
  ChevronDown,
  Check,
  Play,
  Square,
  Clock4,
  Save,
  XCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { Comment, RoadmapTask } from "@/types/roadmap";
import { projectService, type ProjectMember } from "@/services/project.service";
import { commentsService } from "@/services/roadmap.service";
import {
  projectTimeService,
  type TaskTimeLog,
} from "@/services/project-time.service";
import { CommentsSection } from "../shared/CommentsSection";
import { UnsavedChangesConfirmModal } from "../shared/UnsavedChangesConfirmModal";
import { Button } from "@/ui/button";
import { useUser } from "@/stores/authStore";

interface SidePanelProps {
  task: RoadmapTask | null;
  isOpen: boolean;
  isCreating?: boolean;
  onClose: () => void;
  onUpdateTask: (task: RoadmapTask) => void;
  onDeleteTask: (taskId: string) => void;
  onCreateTask?: (taskData: Partial<RoadmapTask>) => void;
  projectId?: string;
  projectMembers?: ProjectMember[];
  isLoading?: boolean;
}

type TabType = "details" | "comments";

type TaskDraftSnapshot = {
  title: string;
  status: RoadmapTask["status"];
  priority: RoadmapTask["priority"];
  assigneeId?: string;
  dueDate: string;
};

const TASK_CREATE_DEFAULTS: TaskDraftSnapshot = {
  title: "",
  status: "todo",
  priority: "medium",
  assigneeId: undefined,
  dueDate: "",
};

const buildTaskDraftSnapshot = (taskData: Partial<RoadmapTask>): TaskDraftSnapshot => ({
  title: taskData.title ?? "",
  status: (taskData.status as RoadmapTask["status"]) ?? "todo",
  priority: (taskData.priority as RoadmapTask["priority"]) ?? "medium",
  assigneeId: taskData.assignee_id ?? taskData.assignee?.id,
  dueDate: toDateInputValue(taskData.due_date),
});

const isSameTaskDraftSnapshot = (
  left: TaskDraftSnapshot,
  right: TaskDraftSnapshot,
) =>
  left.title === right.title &&
  left.status === right.status &&
  left.priority === right.priority &&
  left.assigneeId === right.assigneeId &&
  left.dueDate === right.dueDate;

const toDateInputValue = (value?: string) => {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
};

const toLocalDateTimeInput = (value?: string | null) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const offset = parsed.getTimezoneOffset();
  const local = new Date(parsed.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
};

const fromLocalDateTimeInput = (value: string) => {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
};

const formatDuration = (totalSeconds?: number | null) => {
  if (!totalSeconds || totalSeconds <= 0) return "00:00:00";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
};

function MemberAvatar({
  name,
  avatarUrl,
}: {
  name?: string;
  avatarUrl?: string | null;
}) {
  const initials = (name ?? "?")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name ?? "Member"}
        className="w-6 h-6 rounded-full object-cover ring-1 ring-white"
      />
    );
  }

  return (
    <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-700 text-[10px] font-semibold flex items-center justify-center">
      {initials}
    </span>
  );
}

export const SidePanel = ({
  task,
  isOpen,
  isCreating = false,
  onClose,
  onUpdateTask,
  onDeleteTask,
  onCreateTask,
  projectId,
  projectMembers = [],
  isLoading = false,
}: SidePanelProps) => {
  const user = useUser();
  const [activeTab, setActiveTab] = useState<TabType>("details");
  const [editedTask, setEditedTask] = useState<RoadmapTask | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [newTaskData, setNewTaskData] = useState<Partial<RoadmapTask>>({
    title: "",
    status: "todo",
    priority: "medium",
  });
  const [isAssigneeMenuOpen, setIsAssigneeMenuOpen] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [fetchedProjectMembers, setFetchedProjectMembers] = useState<
    ProjectMember[]
  >([]);
  const [timeLogs, setTimeLogs] = useState<TaskTimeLog[]>([]);
  const [isLoadingTimeLogs, setIsLoadingTimeLogs] = useState(false);
  const [timeActionLoading, setTimeActionLoading] = useState(false);
  const [timeError, setTimeError] = useState<string | null>(null);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editStartedAt, setEditStartedAt] = useState("");
  const [editEndedAt, setEditEndedAt] = useState("");
  const [timerNow, setTimerNow] = useState(Date.now());
  const [showUnsavedChangesConfirm, setShowUnsavedChangesConfirm] =
    useState(false);
  const createSnapshotRef = useRef<TaskDraftSnapshot>({
    ...TASK_CREATE_DEFAULTS,
  });
  const editSnapshotRef = useRef<TaskDraftSnapshot | null>(null);

  const isCreateMode = isCreating || (!!isOpen && !task);

  // Initialize state when task or isCreating changes
  useEffect(() => {
    if (isCreateMode) {
      createSnapshotRef.current = { ...TASK_CREATE_DEFAULTS };
      setNewTaskData({
        title: "",
        status: "todo",
        priority: "medium",
      });
    } else if (task) {
      const normalizedTask = {
        ...task,
        due_date: toDateInputValue(task.due_date) || undefined,
      };
      editSnapshotRef.current = buildTaskDraftSnapshot(normalizedTask);
      setEditedTask(normalizedTask);
    }
  }, [isCreateMode, task]);

  useEffect(() => {
    if (!isOpen) {
      setIsAssigneeMenuOpen(false);
      setAssigneeSearch("");
      setComments([]);
      setIsLoadingComments(false);
      setTimeLogs([]);
      setIsLoadingTimeLogs(false);
      setTimeError(null);
      setEditingLogId(null);
      setShowUnsavedChangesConfirm(false);
    }
  }, [isOpen]);

  const hasUnsavedChanges = useMemo(() => {
    if (isCreateMode) {
      return !isSameTaskDraftSnapshot(
        buildTaskDraftSnapshot(newTaskData),
        createSnapshotRef.current,
      );
    }

    if (!editedTask || !editSnapshotRef.current) return false;

    return !isSameTaskDraftSnapshot(
      buildTaskDraftSnapshot(editedTask),
      editSnapshotRef.current,
    );
  }, [editedTask, isCreateMode, newTaskData]);

  useEffect(() => {
    if (!isOpen || isCreateMode || activeTab !== "comments" || !task?.id)
      return;

    let cancelled = false;

    const loadComments = async () => {
      try {
        setIsLoadingComments(true);
        const fetched = await commentsService.getTaskComments(task.id);
        if (!cancelled) setComments(fetched);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load task comments:", error);
          setComments([]);
        }
      } finally {
        if (!cancelled) setIsLoadingComments(false);
      }
    };

    void loadComments();

    return () => {
      cancelled = true;
    };
  }, [activeTab, isCreateMode, isOpen, task?.id]);

  const handleAddComment = async (content: string) => {
    if (!task?.id) return;
    const created = await commentsService.addTaskComment(task.id, content);
    setComments((prev) => [...prev, created]);
  };

  const handleUpdateComment = async (commentId: string, content: string) => {
    if (!task?.id) return;
    const updated = await commentsService.updateTaskComment(
      task.id,
      commentId,
      content,
    );
    setComments((prev) =>
      prev.map((comment) => (comment.id === commentId ? updated : comment)),
    );
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!task?.id) return;
    await commentsService.deleteTaskComment(task.id, commentId);
    setComments((prev) => prev.filter((comment) => comment.id !== commentId));
  };

  const loadTaskTimeLogs = useCallback(async () => {
    if (!projectId || !task?.id || isCreateMode) return;
    try {
      setIsLoadingTimeLogs(true);
      setTimeError(null);
      const response = await projectTimeService.listMyTaskLogs(
        projectId,
        task.id,
        { page: 1, limit: 20 },
      );
      setTimeLogs(response.items);
    } catch (error) {
      setTimeError(
        error instanceof Error ? error.message : "Failed to load time logs.",
      );
      setTimeLogs([]);
    } finally {
      setIsLoadingTimeLogs(false);
    }
  }, [isCreateMode, projectId, task?.id]);

  useEffect(() => {
    if (!isOpen || activeTab !== "details") return;
    void loadTaskTimeLogs();
  }, [isOpen, activeTab, loadTaskTimeLogs]);

  useEffect(() => {
    const hasActiveTimer = timeLogs.some((log) => !log.ended_at);
    if (!hasActiveTimer) return;
    const interval = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [timeLogs]);

  useEffect(() => {
    if (!isOpen || !projectId) return;

    let cancelled = false;

    const loadProjectMembers = async () => {
      try {
        const members = await projectService.getMembers(projectId);
        if (!cancelled) setFetchedProjectMembers(members);
      } catch {
        if (!cancelled) setFetchedProjectMembers([]);
      }
    };

    loadProjectMembers();

    return () => {
      cancelled = true;
    };
  }, [isOpen, projectId]);

  const assigneeMembers =
    fetchedProjectMembers.length > 0 ? fetchedProjectMembers : projectMembers;

  const currentAssigneeId = isCreateMode
    ? newTaskData.assignee_id
    : editedTask?.assignee_id || editedTask?.assignee?.id;

  const filteredMembers = useMemo(() => {
    const q = assigneeSearch.trim().toLowerCase();
    if (!q) return assigneeMembers;
    return assigneeMembers.filter((member) => {
      const name = member.user?.display_name || "";
      const email = member.user?.email || "";
      const role = member.role || "";
      return (
        name.toLowerCase().includes(q) ||
        email.toLowerCase().includes(q) ||
        role.toLowerCase().includes(q)
      );
    });
  }, [assigneeSearch, assigneeMembers]);

  const selectedMember = assigneeMembers.find(
    (member) => member.user_id === currentAssigneeId,
  );

  const assignToMember = (member: ProjectMember | null) => {
    const assigneeId = member?.user_id;
    const assignee = member?.user
      ? {
          id: member.user.id,
          display_name: member.user.display_name,
          avatar_url: member.user.avatar_url,
          email: member.user.email,
          first_name: member.user.first_name,
          last_name: member.user.last_name,
        }
      : undefined;

    if (isCreateMode) {
      setNewTaskData((prev) => ({
        ...prev,
        assignee_id: assigneeId,
        assignee,
      }));
    } else {
      setEditedTask((prev) =>
        prev
          ? {
              ...prev,
              assignee_id: assigneeId,
              assignee,
            }
          : prev,
      );
    }
    setIsAssigneeMenuOpen(false);
  };

  const activeLog = useMemo(
    () => timeLogs.find((entry) => !entry.ended_at) ?? null,
    [timeLogs],
  );
  const isTimerRunning = Boolean(activeLog);

  const activeDurationSeconds = useMemo(() => {
    if (!activeLog) return null;
    const startedAt = new Date(activeLog.started_at).getTime();
    if (Number.isNaN(startedAt)) return null;
    return Math.max(0, Math.floor((timerNow - startedAt) / 1000));
  }, [activeLog, timerNow]);

  const handleStartTimer = async () => {
    if (!projectId || !task?.id) return;
    try {
      setTimeActionLoading(true);
      setTimeError(null);
      await projectTimeService.start(projectId, task.id);
      await loadTaskTimeLogs();
    } catch (error) {
      setTimeError(
        error instanceof Error ? error.message : "Failed to start timer.",
      );
    } finally {
      setTimeActionLoading(false);
    }
  };

  const handleStopTimer = async (logId: string) => {
    try {
      setTimeActionLoading(true);
      setTimeError(null);
      await projectTimeService.stop(logId);
      await loadTaskTimeLogs();
    } catch (error) {
      setTimeError(
        error instanceof Error ? error.message : "Failed to stop timer.",
      );
    } finally {
      setTimeActionLoading(false);
    }
  };

  const beginEditLog = (log: TaskTimeLog) => {
    if (isTimerRunning) {
      setTimeError("Stop the timer before editing logs.");
      return;
    }
    setEditingLogId(log.id);
    setEditStartedAt(toLocalDateTimeInput(log.started_at));
    setEditEndedAt(toLocalDateTimeInput(log.ended_at));
  };

  const cancelEditLog = () => {
    setEditingLogId(null);
    setEditStartedAt("");
    setEditEndedAt("");
  };

  const saveEditLog = async (logId: string) => {
    if (isTimerRunning) {
      setTimeError("Stop the timer before editing logs.");
      return;
    }

    try {
      setTimeActionLoading(true);
      setTimeError(null);
      const started_at = fromLocalDateTimeInput(editStartedAt);
      const ended_at = fromLocalDateTimeInput(editEndedAt);
      await projectTimeService.update(logId, {
        ...(started_at ? { started_at } : {}),
        ...(ended_at ? { ended_at } : {}),
      });
      cancelEditLog();
      await loadTaskTimeLogs();
    } catch (error) {
      setTimeError(
        error instanceof Error ? error.message : "Failed to update time log.",
      );
    } finally {
      setTimeActionLoading(false);
    }
  };

  useEffect(() => {
    if (!isTimerRunning || editingLogId === null) return;
    cancelEditLog();
    setTimeError("Stop the timer before editing logs.");
  }, [isTimerRunning, editingLogId]);

  const handleSave = () => {
    if (isLoading) return false;

    if (isCreateMode) {
      // Validate title is required
      if (!newTaskData.title?.trim()) {
        alert("Task title is required");
        return false;
      }
      if (onCreateTask) {
        void Promise.resolve(onCreateTask(newTaskData)).catch(() => undefined);
      }
      onClose();
      return true;
    } else {
      // Edit mode
      if (editedTask) {
        if (!editedTask.title?.trim()) {
          alert("Task title is required");
          return false;
        }
        void Promise.resolve(onUpdateTask(editedTask)).catch(() => undefined);
        onClose();
        return true;
      }
    }
    return false;
  };

  const closeImmediately = () => {
    if (isLoading) return;

    if (isCreateMode) {
      setNewTaskData({
        title: "",
        status: "todo",
        priority: "medium",
      });
    }
    setShowUnsavedChangesConfirm(false);
    onClose();
  };

  const handleRequestClose = () => {
    if (isLoading) return;
    if (hasUnsavedChanges) {
      setShowUnsavedChangesConfirm(true);
      return;
    }
    closeImmediately();
  };

  const handleSaveBeforeClose = () => {
    if (isLoading) return;
    const didSave = handleSave();
    if (didSave) {
      setShowUnsavedChangesConfirm(false);
    }
  };

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      // Esc to close
      if (e.key === "Escape" && !isLoading) {
        handleRequestClose();
      }

      // Ctrl+Enter to save
      if (e.ctrlKey && e.key === "Enter" && !isLoading) {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleRequestClose, handleSave, isLoading, isOpen]);

  return (
    <>
      {createPortal(
        <AnimatePresence>
      {isOpen && (
        <motion.div
          key="sidepanel-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
          onClick={handleRequestClose}
          className="fixed inset-0 z-120 bg-black/15 cursor-default"
        />
      )}
      {isOpen && (
        <motion.div
          key="sidepanel-content"
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
          className="fixed top-0 right-0 bottom-0 w-[560px] bg-white border-l border-gray-200 shadow-2xl z-130 flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">
              {isCreateMode ? "Create Task" : "Edit Task"}
            </h2>
            <button
              onClick={handleRequestClose}
              disabled={isLoading}
              className="p-2 hover:bg-gray-100 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Close panel (Esc)"
            >
              <X className="w-5 h-5 text-gray-600" />
            </button>
          </div>

          {/* Title Section - Always Editable */}
          <div className="px-6 py-4 border-b border-gray-200">
            <input
              type="text"
              placeholder="Task title..."
              value={isCreateMode ? newTaskData.title : editedTask?.title || ""}
              onChange={(e) => {
                if (isCreateMode) {
                  setNewTaskData({ ...newTaskData, title: e.target.value });
                } else {
                  setEditedTask(
                    editedTask
                      ? { ...editedTask, title: e.target.value }
                      : null,
                  );
                }
              }}
              disabled={isLoading}
              className="w-full text-xl font-semibold text-gray-900 border-none focus:outline-none focus:ring-0 px-0 disabled:opacity-50"
              autoFocus
            />
          </div>

          {/* Action Buttons Row */}
          <div className="px-6 py-3 border-b border-gray-200 flex items-center gap-2 overflow-x-auto">
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md hover:bg-gray-100 transition-colors text-gray-700 disabled:opacity-50"
              title="Add dates"
              disabled={isLoading}
            >
              <Calendar className="w-4 h-4" />
              <span>Dates</span>
            </button>
          </div>

          {/* Tabs - only show in edit mode (not creating) */}
          {!isCreateMode && (
            <div className="flex items-center border-b border-gray-200 px-6">
              <button
                onClick={() => setActiveTab("details")}
                className={`px-4 py-3 font-medium text-sm transition-colors border-b-2 ${
                  activeTab === "details"
                    ? "text-primary border-primary"
                    : "text-gray-600 hover:text-gray-900 border-transparent"
                }`}
              >
                Details
              </button>
              <button
                onClick={() => setActiveTab("comments")}
                className={`px-4 py-3 font-medium text-sm transition-colors border-b-2 ${
                  activeTab === "comments"
                    ? "text-primary border-primary"
                    : "text-gray-600 hover:text-gray-900 border-transparent"
                }`}
              >
                Comments
              </button>
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {(isCreateMode || activeTab === "details") && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="flex text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5 items-center gap-1.5">
                    <CheckSquare className="w-3.5 h-3.5" />
                    Status
                  </label>
                  <select
                    value={
                      isCreateMode
                        ? newTaskData.status
                        : editedTask?.status || "todo"
                    }
                    onChange={(e) => {
                      const status = e.target.value as RoadmapTask["status"];
                      if (isCreateMode) {
                        setNewTaskData({ ...newTaskData, status });
                      } else {
                        setEditedTask(
                          editedTask ? { ...editedTask, status } : null,
                        );
                      }
                    }}
                    disabled={isLoading}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-50 disabled:bg-gray-50 text-sm"
                  >
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="in_review">In Review</option>
                    <option value="done">Done</option>
                    <option value="blocked">Blocked</option>
                  </select>
                </div>

                <div>
                  <label className="flex text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5 items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5" />
                    Priority
                  </label>
                  <select
                    value={
                      isCreateMode
                        ? newTaskData.priority
                        : editedTask?.priority || "medium"
                    }
                    onChange={(e) => {
                      const priority = e.target
                        .value as RoadmapTask["priority"];
                      if (isCreateMode) {
                        setNewTaskData({ ...newTaskData, priority });
                      } else {
                        setEditedTask(
                          editedTask ? { ...editedTask, priority } : null,
                        );
                      }
                    }}
                    disabled={isLoading}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-50 disabled:bg-gray-50 text-sm"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="flex text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5 items-center gap-1.5">
                    <User className="w-3.5 h-3.5" />
                    Assignee
                  </label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setIsAssigneeMenuOpen((prev) => !prev)}
                      disabled={isLoading}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-left flex items-center justify-between gap-2 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:bg-gray-50"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <MemberAvatar
                          name={
                            selectedMember?.user?.display_name ||
                            selectedMember?.user?.email ||
                            "Unassigned"
                          }
                          avatarUrl={selectedMember?.user?.avatar_url}
                        />
                        <span className="text-sm text-gray-700 truncate">
                          {selectedMember?.user?.display_name ||
                            selectedMember?.user?.email ||
                            "Unassigned"}
                        </span>
                      </span>
                      <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                    </button>

                    {isAssigneeMenuOpen && (
                      <div className="absolute z-30 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg p-2">
                        <div className="relative mb-2">
                          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={assigneeSearch}
                            onChange={(e) => setAssigneeSearch(e.target.value)}
                            placeholder="Search members..."
                            className="w-full pl-8 pr-2 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => assignToMember(null)}
                          className="w-full px-2 py-2 text-left text-sm rounded-md hover:bg-gray-50 flex items-center justify-between"
                        >
                          <span className="flex items-center gap-2 text-gray-700">
                            <MemberAvatar name="Unassigned" avatarUrl={null} />
                            Unassigned
                          </span>
                          {!currentAssigneeId && (
                            <Check className="w-4 h-4 text-primary" />
                          )}
                        </button>

                        <div className="max-h-44 overflow-y-auto mt-1">
                          {filteredMembers.map((member) => {
                            const isSelected =
                              member.user_id === currentAssigneeId;
                            const memberName =
                              member.user?.display_name ||
                              member.user?.email ||
                              member.user_id ||
                              "Unassigned";

                            return (
                              <button
                                key={member.id}
                                type="button"
                                onClick={() => assignToMember(member)}
                                className="w-full px-2 py-2 text-left text-sm rounded-md hover:bg-gray-50 flex items-center justify-between gap-2"
                              >
                                <span className="flex items-center gap-2 min-w-0">
                                  <MemberAvatar
                                    name={memberName}
                                    avatarUrl={member.user?.avatar_url}
                                  />
                                  <span className="truncate text-gray-700">
                                    {memberName}
                                  </span>
                                </span>
                                {isSelected && (
                                  <Check className="w-4 h-4 text-primary shrink-0" />
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
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="flex text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5 items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={
                      isCreateMode
                        ? toDateInputValue(newTaskData.due_date)
                        : toDateInputValue(editedTask?.due_date)
                    }
                    onChange={(e) => {
                      const dueDate = e.target.value || undefined;
                      if (isCreateMode) {
                        setNewTaskData({ ...newTaskData, due_date: dueDate });
                      } else {
                        setEditedTask(
                          editedTask
                            ? { ...editedTask, due_date: dueDate }
                            : null,
                        );
                      }
                    }}
                    disabled={isLoading}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-50 disabled:bg-gray-50 text-sm"
                  />
                </div>

                {!isCreateMode && task?.id && projectId && (
                  <div className="md:col-span-2 rounded-lg border border-gray-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Clock4 className="w-4 h-4 text-gray-500" />
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Time
                        </p>
                      </div>
                      {activeLog ? (
                        <span className="text-xs font-semibold text-emerald-600">
                          Running {formatDuration(activeDurationSeconds)}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500">No active timer</span>
                      )}
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      {isLoadingTimeLogs ? (
                        <div className="h-9 w-28 rounded-md border border-gray-200 bg-gray-100 animate-pulse" />
                      ) : activeLog ? (
                        <button
                          type="button"
                          onClick={() => void handleStopTimer(activeLog.id)}
                          disabled={isLoading || timeActionLoading}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
                        >
                          <Square className="w-3.5 h-3.5" />
                          Stop Timer
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleStartTimer()}
                          disabled={isLoading || timeActionLoading}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                        >
                          <Play className="w-3.5 h-3.5" />
                          Start Timer
                        </button>
                      )}
                    </div>

                    {timeError && (
                      <p className="mt-2 text-xs text-red-600">{timeError}</p>
                    )}

                    <div className="mt-3 space-y-2 max-h-52 overflow-y-auto pr-1">
                      {isLoadingTimeLogs ? (
                        <>
                          {[0, 1, 2].map((idx) => (
                            <div
                              key={idx}
                              className="rounded-md border border-gray-200 bg-gray-50 p-2 animate-pulse"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="space-y-1.5">
                                  <div className="h-3 w-44 rounded bg-gray-200" />
                                  <div className="h-3 w-28 rounded bg-gray-100" />
                                </div>
                                <div className="space-y-1.5">
                                  <div className="h-3 w-14 rounded bg-gray-200 ml-auto" />
                                  <div className="h-4 w-16 rounded-full bg-gray-100 ml-auto" />
                                </div>
                              </div>
                            </div>
                          ))}
                        </>
                      ) : timeLogs.length === 0 ? (
                        <p className="text-xs text-gray-500">
                          No time logs yet for this task.
                        </p>
                      ) : (
                        timeLogs.map((log) => {
                          const isEditing = editingLogId === log.id;
                          const canEdit = !isTimerRunning;
                          return (
                            <div
                              key={log.id}
                              className="rounded-md border border-gray-200 bg-gray-50 p-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-xs text-gray-700">
                                  {new Date(log.started_at).toLocaleString()}{" "}
                                  {log.ended_at
                                    ? `- ${new Date(log.ended_at).toLocaleString()}`
                                    : "- Running"}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold text-gray-700">
                                    {formatDuration(
                                      log.ended_at
                                        ? log.duration_seconds
                                        : activeLog?.id === log.id
                                          ? activeDurationSeconds
                                          : null,
                                    )}
                                  </span>
                                  <span
                                    className={`text-[10px] px-2 py-0.5 rounded-full ${
                                      log.status === "approved"
                                        ? "bg-emerald-100 text-emerald-700"
                                        : log.status === "rejected"
                                          ? "bg-red-100 text-red-700"
                                          : "bg-amber-100 text-amber-700"
                                    }`}
                                  >
                                    {log.status}
                                  </span>
                                </div>
                              </div>

                              {isEditing ? (
                                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                                  <input
                                    type="datetime-local"
                                    value={editStartedAt}
                                    onChange={(e) => setEditStartedAt(e.target.value)}
                                    className="px-2 py-1.5 text-xs border border-gray-300 rounded"
                                  />
                                  <input
                                    type="datetime-local"
                                    value={editEndedAt}
                                    onChange={(e) => setEditEndedAt(e.target.value)}
                                    className="px-2 py-1.5 text-xs border border-gray-300 rounded"
                                  />
                                  <div className="md:col-span-2 flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => void saveEditLog(log.id)}
                                      disabled={timeActionLoading}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-blue-200 bg-blue-50 text-blue-700"
                                    >
                                      <Save className="w-3 h-3" />
                                      Save
                                    </button>
                                    <button
                                      type="button"
                                      onClick={cancelEditLog}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-gray-300 bg-white text-gray-700"
                                    >
                                      <XCircle className="w-3 h-3" />
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                canEdit && (
                                  <button
                                    type="button"
                                    onClick={() => beginEditLog(log)}
                                    className="mt-2 text-xs text-blue-700 hover:underline"
                                  >
                                    Edit log
                                  </button>
                                )
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>

                    {isTimerRunning && (
                      <p className="mt-2 text-xs text-amber-700">
                        Edit log is unavailable while the timer is running.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {!isCreateMode && activeTab === "comments" && (
              <CommentsSection
                comments={comments}
                onAddComment={handleAddComment}
                onUpdateComment={handleUpdateComment}
                onDeleteComment={handleDeleteComment}
                currentUserId={user?.id}
                canComment={Boolean(user)}
                isLoading={isLoadingComments}
                emptyMessage="No comments yet for this task."
              />
            )}
          </div>

          {/* Footer Actions */}
          <div className="border-t border-gray-200 px-6 py-4 bg-gray-50">
            {isCreateMode ? (
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleSave}
                  variant="contained"
                  colorScheme="primary"
                  size="md"
                  className="flex-1 flex items-center justify-center gap-2"
                  disabled={isLoading}
                >
                  {isLoading && (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  )}
                  {isLoading ? "Creating..." : "Create Task"}
                </Button>
                <Button
                  onClick={handleRequestClose}
                  variant="outlined"
                  colorScheme="secondary"
                  size="md"
                  disabled={isLoading}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              activeTab === "details" && (
                <div className="flex items-center gap-2 w-full">
                  <Button
                    onClick={handleSave}
                    variant="contained"
                    colorScheme="primary"
                    size="md"
                    className="flex-1 flex items-center justify-center gap-2"
                    disabled={isLoading}
                  >
                    {isLoading && (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    )}
                    {isLoading ? "Saving..." : "Save Changes"}
                  </Button>
                  <Button
                    onClick={() => {
                      if (task) {
                        onDeleteTask(task.id);
                        onClose();
                      }
                    }}
                    variant="outlined"
                    colorScheme="destructive"
                    size="md"
                    disabled={isLoading}
                  >
                    Delete
                  </Button>
                </div>
              )
            )}
            <p className="text-xs text-gray-500 mt-2 text-center">
              Press Esc to close | Ctrl+Enter to save
            </p>
          </div>
        </motion.div>
      )}
        </AnimatePresence>,
        document.body,
      )}
      <UnsavedChangesConfirmModal
        isOpen={isOpen && showUnsavedChangesConfirm}
        isSaving={isLoading}
        isSaveDisabled={
          !(
            (isCreateMode ? newTaskData.title : editedTask?.title)?.trim() ??
            ""
          )
        }
        entityLabel="task"
        onCancel={() => setShowUnsavedChangesConfirm(false)}
        onDiscard={closeImmediately}
        onSave={handleSaveBeforeClose}
      />
    </>
  );
};
