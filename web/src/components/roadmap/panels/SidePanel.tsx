import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Calendar,
  CheckSquare,
  Search,
  ChevronDown,
  Check,
  Paperclip,
  Edit2,
  Plus,
  Trash2,
  Link2,
  History,
  AlertCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type {
  ChecklistItem,
  Comment,
  RoadmapTask,
  TaskActivityEntry,
  TaskAttachment,
  TaskDependency,
} from "@/types/roadmap";
import { projectService, type ProjectMember } from "@/services/project.service";
import { commentsService, taskService } from "@/services/roadmap.service";
import type { AddTaskAttachmentDto } from "@/services/roadmap.service";
import { uploadService } from "@/services/upload.service";
import { useToast } from "@/hooks/useToast";
import { CommentsSection } from "../shared/CommentsSection";
import { UnsavedChangesConfirmModal } from "../shared/UnsavedChangesConfirmModal";
import { RichTextEditor } from "@/components/common/RichTextEditor";
import { Button } from "@/ui/button";
import { useUser } from "@/stores/authStore";
import { useRoadmapStore } from "@/stores/roadmapStore";

interface SidePanelProps {
  task: RoadmapTask | null;
  isOpen: boolean;
  isCreating?: boolean;
  isPendingCreate?: boolean;
  onClose: () => void;
  onUpdateTask: (task: RoadmapTask) => void;
  onDeleteTask: (taskId: string) => void;
  onCreateTask?: (taskData: Partial<RoadmapTask>) => void;
  onSaved?: (task: RoadmapTask) => void;
  projectId?: string;
  projectMembers?: ProjectMember[];
  isLoading?: boolean;
  asModal?: boolean;
  zIndexBase?: number;
}

type TabType = "details" | "comments" | "history";

type TaskDraftSnapshot = {
  title: string;
  status: RoadmapTask["status"];
  priority: RoadmapTask["priority"];
  workType: RoadmapTask["work_type"];
  assigneeId?: string;
  dueDate: string;
  description: string;
};

const TASK_CREATE_DEFAULTS: TaskDraftSnapshot = {
  title: "",
  status: "todo",
  priority: "medium",
  workType: "real_work",
  assigneeId: undefined,
  dueDate: "",
  description: "",
};

const buildTaskDraftSnapshot = (
  taskData: Partial<RoadmapTask>,
): TaskDraftSnapshot => ({
  title: taskData.title ?? "",
  status: (taskData.status as RoadmapTask["status"]) ?? "todo",
  priority: (taskData.priority as RoadmapTask["priority"]) ?? "medium",
  workType: taskData.work_type ?? "real_work",
  assigneeId: taskData.assignee_id ?? taskData.assignee?.id,
  dueDate: toDateInputValue(taskData.due_date),
  description: taskData.description ?? "",
});

const isSameTaskDraftSnapshot = (
  left: TaskDraftSnapshot,
  right: TaskDraftSnapshot,
) =>
  left.title === right.title &&
  left.status === right.status &&
  left.priority === right.priority &&
  left.workType === right.workType &&
  left.assigneeId === right.assigneeId &&
  left.dueDate === right.dueDate &&
  left.description === right.description;

const formatPillDate = (dateStr?: string): string | null => {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const toDateInputValue = (value?: string) => {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
};

const formatFileSize = (bytes?: number) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
    <span className="w-6 h-6 rounded-full bg-black text-white text-[10px] font-semibold flex items-center justify-center">
      {initials}
    </span>
  );
}

export const SidePanel = ({
  task,
  isOpen,
  isCreating = false,
  isPendingCreate = false,
  onClose,
  onUpdateTask,
  onDeleteTask,
  onCreateTask,
  onSaved,
  projectId,
  projectMembers = [],
  isLoading = false,
  asModal = false,
  zIndexBase: _zIndexBase = 120,
}: SidePanelProps) => {
  const user = useUser();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<TabType>("details");
  const [editedTask, setEditedTask] = useState<RoadmapTask | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [newTaskData, setNewTaskData] = useState<Partial<RoadmapTask>>({
    title: "",
    status: "todo",
    priority: "medium",
    work_type: "real_work",
  });
  const [isAssigneeMenuOpen, setIsAssigneeMenuOpen] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [fetchedProjectMembers, setFetchedProjectMembers] = useState<
    ProjectMember[]
  >([]);
  const [showUnsavedChangesConfirm, setShowUnsavedChangesConfirm] =
    useState(false);

  // Description editing state
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");

  // Attachments state
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [isLoadingAttachments, setIsLoadingAttachments] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Checklist state
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [newChecklistTitle, setNewChecklistTitle] = useState("");
  const [isAddingChecklist, setIsAddingChecklist] = useState(false);

  // History state
  const [history, setHistory] = useState<TaskActivityEntry[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Dependencies state
  const [dependencies, setDependencies] = useState<{ blocking: TaskDependency[]; blocked_by: TaskDependency[] }>({ blocking: [], blocked_by: [] });
  const [isLoadingDeps, setIsLoadingDeps] = useState(false);
  const [depSearchQuery, setDepSearchQuery] = useState("");
  const [isDepSearchOpen, setIsDepSearchOpen] = useState(false);

  const createSnapshotRef = useRef<TaskDraftSnapshot>({
    ...TASK_CREATE_DEFAULTS,
  });
  const editSnapshotRef = useRef<TaskDraftSnapshot | null>(null);
  const initialChecklistRef = useRef<ChecklistItem[]>([]);

  const isCreateMode = isCreating || (!!isOpen && !task);
  const isReadOnlyPending = !isCreateMode && isPendingCreate;
  const isInteractionDisabled = isLoading || isReadOnlyPending;

  useEffect(() => {
    if (isCreateMode) {
      createSnapshotRef.current = { ...TASK_CREATE_DEFAULTS };
      setNewTaskData({
        title: "",
        status: "todo",
        priority: "medium",
        work_type: "real_work",
      });
      setDescriptionDraft("");
      setIsEditingDescription(false);
    } else if (task) {
      const normalizedTask = {
        ...task,
        work_type: task.work_type ?? "real_work",
        due_date: toDateInputValue(task.due_date) || undefined,
      };
      editSnapshotRef.current = buildTaskDraftSnapshot(normalizedTask);
      setEditedTask(normalizedTask);
      setDescriptionDraft(normalizedTask.description ?? "");
      setIsEditingDescription(false);
      const initialChecklist = normalizedTask.checklist ?? [];
      setChecklistItems(initialChecklist);
      initialChecklistRef.current = initialChecklist;
    }
  // Use stable identity keys (id + updated_at) instead of the task object reference.
  // Zustand creates new task objects on every store mutation, so using `task` directly
  // would reset the snapshot (and lose hasUnsavedChanges) on any unrelated store update.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreateMode, task?.id, task?.updated_at]);

  useEffect(() => {
    if (!isOpen) {
      setIsAssigneeMenuOpen(false);
      setAssigneeSearch("");
      setComments([]);
      setIsLoadingComments(false);
      setShowUnsavedChangesConfirm(false);
      setIsEditingDescription(false);
      setAttachments([]);
      setChecklistItems([]);
      setNewChecklistTitle("");
      setIsAddingChecklist(false);
      setHistory([]);
      setDependencies({ blocking: [], blocked_by: [] });
      setDepSearchQuery("");
      setIsDepSearchOpen(false);
    }
  }, [isOpen]);

  // Load attachments when panel opens in edit mode
  useEffect(() => {
    if (!isOpen || isCreateMode || !task?.id) return;
    let cancelled = false;
    const load = async () => {
      try {
        setIsLoadingAttachments(true);
        const fetched = await commentsService.getTaskAttachments(task.id);
        if (!cancelled) setAttachments(fetched);
      } catch {
        if (!cancelled) setAttachments([]);
      } finally {
        if (!cancelled) setIsLoadingAttachments(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [isOpen, isCreateMode, task?.id]);

  // Load history when switching to history tab
  useEffect(() => {
    if (!isOpen || isCreateMode || activeTab !== "history" || !task?.id) return;
    let cancelled = false;
    const load = async () => {
      try {
        setIsLoadingHistory(true);
        const data = await taskService.getHistory(task.id);
        if (!cancelled) setHistory(data);
      } catch {
        if (!cancelled) setHistory([]);
      } finally {
        if (!cancelled) setIsLoadingHistory(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [activeTab, isCreateMode, isOpen, task?.id]);

  // Load dependencies when panel opens
  useEffect(() => {
    if (!isOpen || isCreateMode || !task?.id) return;
    let cancelled = false;
    const load = async () => {
      try {
        setIsLoadingDeps(true);
        const data = await taskService.getDependencies(task.id);
        if (!cancelled) setDependencies(data);
      } catch {
        if (!cancelled) setDependencies({ blocking: [], blocked_by: [] });
      } finally {
        if (!cancelled) setIsLoadingDeps(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [isOpen, isCreateMode, task?.id]);

  const handleAddDependency = async (blockingTaskId: string) => {
    if (!task?.id) return;
    const taskInfo = allRoadmapTasks.find((t) => t.id === blockingTaskId);
    const optimisticDep: TaskDependency = {
      id: `temp-${blockingTaskId}`,
      blocking_task_id: blockingTaskId,
      blocked_task_id: task.id,
      created_at: new Date().toISOString(),
      blocking_task: taskInfo
        ? { id: taskInfo.id, title: taskInfo.title, status: taskInfo.status }
        : undefined,
    };
    setDependencies((prev) => ({ ...prev, blocked_by: [...prev.blocked_by, optimisticDep] }));
    setDepSearchQuery("");
    setIsDepSearchOpen(false);
    try {
      const created = await taskService.addDependency(task.id, blockingTaskId);
      setDependencies((prev) => ({
        ...prev,
        blocked_by: prev.blocked_by.map((d) =>
          d.id === optimisticDep.id ? (created ?? optimisticDep) : d,
        ),
      }));
    } catch (err) {
      setDependencies((prev) => ({
        ...prev,
        blocked_by: prev.blocked_by.filter((d) => d.id !== optimisticDep.id),
      }));
      console.error("[SidePanel] addDependency failed:", err);
      alert("Failed to add dependency. Please try again.");
    }
  };

  const handleRemoveDependency = async (depId: string) => {
    if (!task?.id) return;
    setDependencies((prev) => ({
      blocking: prev.blocking.filter((d) => d.id !== depId),
      blocked_by: prev.blocked_by.filter((d) => d.id !== depId),
    }));
    await taskService.removeDependency(task.id, depId).catch(() => {});
  };

  const hasUnsavedChanges = useMemo(() => {
    const checklistStr = (items: ChecklistItem[]) =>
      JSON.stringify(items.map((i) => `${i.id ?? ""}:${i.title}:${i.completed}`));
    if (isCreateMode) {
      const draft = { ...buildTaskDraftSnapshot(newTaskData), description: descriptionDraft };
      return !isSameTaskDraftSnapshot(draft, createSnapshotRef.current) || checklistItems.length > 0;
    }
    if (!editedTask || !editSnapshotRef.current) return false;
    const draft = { ...buildTaskDraftSnapshot(editedTask), description: descriptionDraft };
    const fieldsDiffer = !isSameTaskDraftSnapshot(draft, editSnapshotRef.current);
    const checklistDiffers = checklistStr(checklistItems) !== checklistStr(initialChecklistRef.current);
    return fieldsDiffer || checklistDiffers;
  }, [editedTask, isCreateMode, newTaskData, descriptionDraft, checklistItems]);

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
    return () => { cancelled = true; };
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
    void loadProjectMembers();
    return () => { cancelled = true; };
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

  const handleAddAttachment = async (file: File) => {
    if (!task?.id) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File too large. Maximum size is 5 MB.");
      return;
    }
    const tempId = `temp-${Date.now()}`;
    const optimisticChip: TaskAttachment = {
      id: tempId,
      task_id: task.id,
      uploaded_by: user?.id ?? "",
      file_name: file.name,
      file_url: null as any,
      file_size: file.size,
      mime_type: file.type || undefined,
      created_at: new Date().toISOString(),
    };
    setAttachments((prev) => [optimisticChip, ...prev]);
    try {
      const publicUrl = await uploadService.uploadTaskAttachment(file);
      const dto: AddTaskAttachmentDto = {
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || undefined,
        file_url: publicUrl,
      };
      const saved = await commentsService.addTaskAttachment(task.id, dto);
      setAttachments((prev) =>
        prev.map((a) => (a.id === tempId ? saved : a)),
      );
    } catch (err) {
      setAttachments((prev) => prev.filter((a) => a.id !== tempId));
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Attachment upload failed]", err);
      toast.error(`Upload failed: ${msg}`);
    }
  };

  const handleRemoveAttachment = async (attachmentId: string) => {
    if (!task?.id) return;
    setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    try {
      await commentsService.deleteTaskAttachment(task.id, attachmentId);
    } catch {
      // Revert on error — reload
      const fetched = await commentsService.getTaskAttachments(task.id).catch(() => []);
      setAttachments(fetched);
    }
  };

  const handleSave = () => {
    if (isInteractionDisabled) return false;

    if (isCreateMode) {
      if (!newTaskData.title?.trim()) {
        alert("Task title is required");
        return false;
      }
      if (onCreateTask) {
        void Promise.resolve(
          onCreateTask({ ...newTaskData, description: descriptionDraft || null, checklist: checklistItems }),
        ).catch(() => undefined);
      }
      onClose();
      return true;
    } else {
      if (editedTask) {
        if (!editedTask.title?.trim()) {
          alert("Task title is required");
          return false;
        }
        const savedTask = { ...editedTask, description: descriptionDraft || null, checklist: checklistItems };
        void Promise.resolve(onUpdateTask(savedTask))
          .then(() => {
            onClose();
            // Fire pulse after the panel's 300ms exit animation finishes
            if (onSaved) setTimeout(() => onSaved(savedTask), 350);
          })
          .catch(() => undefined);
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
        work_type: "real_work",
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
    if (isInteractionDisabled) return;
    const didSave = handleSave();
    if (didSave) setShowUnsavedChangesConfirm(false);
  };


  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape" && !isLoading) handleRequestClose();
      if (e.ctrlKey && e.key === "Enter" && !isInteractionDisabled) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    handleRequestClose,
    handleSave,
    isInteractionDisabled,
    isLoading,
    isOpen,
  ]);

  // Flat task list for dependency search (from store)
  const storeEpics = useRoadmapStore((s) => s.epics);
  const allRoadmapTasks = useMemo(
    () => storeEpics.flatMap((e) => e.features ?? []).flatMap((f) => f.tasks ?? []).filter((t) => t.id !== task?.id),
    [storeEpics, task?.id],
  );

  const filteredDepTasks = useMemo(() => {
    const existingIds = new Set([
      ...dependencies.blocked_by.map((d) => d.blocking_task_id),
      ...dependencies.blocking.map((d) => d.blocked_task_id),
    ]);
    const q = depSearchQuery.trim().toLowerCase();
    return allRoadmapTasks
      .filter((t) => !existingIds.has(t.id) && (q === "" || t.title.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [depSearchQuery, allRoadmapTasks, dependencies]);

  const mentionUsers = fetchedProjectMembers
    .filter((m) => m.user_id)
    .map((m) => ({
      id: m.user_id as string,
      display_name:
        m.user?.display_name ||
        [m.user?.first_name, m.user?.last_name].filter(Boolean).join(" ") ||
        m.user?.email ||
        m.user_id ||
        "",
      avatar_url: m.user?.avatar_url,
    }))
    .filter((u) => u.display_name);

  const panelContent = (
    <div
      className={
        asModal
          ? "w-full max-w-2xl max-h-[85vh] bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden"
          : "fixed top-0 right-0 bottom-0 w-[560px] bg-white border-l border-gray-200 shadow-2xl z-130 flex flex-col"
      }
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
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

      {/* Title Section */}
      <div className="px-6 py-4 border-b border-gray-200 shrink-0">
        <input
          type="text"
          placeholder="Task title..."
          value={
            isCreateMode ? newTaskData.title : editedTask?.title || ""
          }
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
          disabled={isInteractionDisabled}
          className="w-full text-xl font-semibold text-gray-900 border-none focus:outline-none focus:ring-0 px-0 disabled:opacity-50"
          autoFocus
        />
      </div>

      {/* Compact Fields Strip */}
      <div className="px-6 py-2.5 border-b border-gray-100 flex flex-wrap items-center gap-2 shrink-0">
        {/* Status */}
        <div className="relative">
          <select
            value={isCreateMode ? newTaskData.status : editedTask?.status || "todo"}
            onChange={(e) => {
              const status = e.target.value as RoadmapTask["status"];
              if (isCreateMode) {
                setNewTaskData({ ...newTaskData, status });
              } else {
                setEditedTask(editedTask ? { ...editedTask, status } : null);
              }
            }}
            disabled={isInteractionDisabled}
            className="appearance-none pl-2.5 pr-6 h-7 text-xs font-medium rounded-full border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-primary/30 cursor-pointer disabled:opacity-50"
          >
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="in_review">In Review</option>
            <option value="done">Done</option>
            <option value="blocked">Blocked</option>
          </select>
          <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
        </div>

        {/* Priority */}
        <div className="relative">
          <select
            value={isCreateMode ? newTaskData.priority : editedTask?.priority || "medium"}
            onChange={(e) => {
              const priority = e.target.value as RoadmapTask["priority"];
              if (isCreateMode) {
                setNewTaskData({ ...newTaskData, priority });
              } else {
                setEditedTask(editedTask ? { ...editedTask, priority } : null);
              }
            }}
            disabled={isInteractionDisabled}
            className="appearance-none pl-2.5 pr-6 h-7 text-xs font-medium rounded-full border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-primary/30 cursor-pointer disabled:opacity-50"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
          <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
        </div>

        {/* Assignee */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsAssigneeMenuOpen((prev) => !prev)}
            disabled={isInteractionDisabled}
            className="flex items-center gap-1.5 pl-1.5 pr-2.5 h-7 text-xs font-medium rounded-full border border-gray-200 bg-white hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <MemberAvatar
              name={selectedMember?.user?.display_name || selectedMember?.user?.email || "Unassigned"}
              avatarUrl={selectedMember?.user?.avatar_url}
            />
            <span className="max-w-[90px] truncate text-gray-700">
              {selectedMember?.user?.display_name || selectedMember?.user?.email || "Unassigned"}
            </span>
            <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" />
          </button>

          {isAssigneeMenuOpen && (
            <div className="absolute z-30 mt-1 w-56 rounded-lg border border-gray-200 bg-white shadow-lg p-2">
              <div className="relative mb-2">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={assigneeSearch}
                  onChange={(e) => setAssigneeSearch(e.target.value)}
                  disabled={isInteractionDisabled}
                  placeholder="Search members..."
                  className="w-full pl-8 pr-2 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <button
                type="button"
                onClick={() => assignToMember(null)}
                disabled={isInteractionDisabled}
                className="w-full px-2 py-2 text-left text-sm rounded-md hover:bg-gray-50 flex items-center justify-between"
              >
                <span className="flex items-center gap-2 text-gray-700">
                  <MemberAvatar name="Unassigned" avatarUrl={null} />
                  Unassigned
                </span>
                {!currentAssigneeId && <Check className="w-4 h-4 text-primary" />}
              </button>
              <div className="max-h-44 overflow-y-auto mt-1">
                {filteredMembers.map((member) => {
                  const isSelected = member.user_id === currentAssigneeId;
                  const memberName = member.user?.display_name || member.user?.email || member.user_id || "Unassigned";
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => assignToMember(member)}
                      disabled={isInteractionDisabled}
                      className="w-full px-2 py-2 text-left text-sm rounded-md hover:bg-gray-50 flex items-center justify-between gap-2"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <MemberAvatar name={memberName} avatarUrl={member.user?.avatar_url} />
                        <span className="truncate text-gray-700">{memberName}</span>
                      </span>
                      {isSelected && <Check className="w-4 h-4 text-primary shrink-0" />}
                    </button>
                  );
                })}
                {filteredMembers.length === 0 && (
                  <p className="px-2 py-2 text-xs text-gray-400">No members found</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Due Date */}
        <div className="relative flex items-center gap-1.5 pl-2 pr-2.5 h-7 text-xs font-medium rounded-full border border-gray-200 bg-white cursor-pointer hover:bg-gray-50 transition-colors">
          <Calendar className="w-3 h-3 text-gray-400 shrink-0" />
          <span
            className={
              (isCreateMode ? toDateInputValue(newTaskData.due_date) : toDateInputValue(editedTask?.due_date))
                ? "text-gray-700"
                : "text-gray-400"
            }
          >
            {formatPillDate(
              isCreateMode ? toDateInputValue(newTaskData.due_date) : toDateInputValue(editedTask?.due_date),
            ) ?? "Due date"}
          </span>
          <input
            type="date"
            value={isCreateMode ? toDateInputValue(newTaskData.due_date) : toDateInputValue(editedTask?.due_date)}
            onChange={(e) => {
              const dueDate = e.target.value || undefined;
              if (isCreateMode) {
                setNewTaskData({ ...newTaskData, due_date: dueDate });
              } else {
                setEditedTask(editedTask ? { ...editedTask, due_date: dueDate } : null);
              }
            }}
            disabled={isInteractionDisabled}
            className="absolute inset-0 opacity-0 cursor-pointer w-full disabled:cursor-not-allowed"
          />
        </div>
      </div>

      {/* Tabs - only show in edit mode */}
      {!isCreateMode && (
        <div className="flex items-center border-b border-gray-200 px-6 shrink-0">
          {(["details", "comments", "history"] as TabType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 font-medium text-sm transition-colors border-b-2 ${
                activeTab === tab
                  ? "text-primary border-primary"
                  : "text-gray-600 hover:text-gray-900 border-transparent"
              }`}
            >
              {tab === "details" ? "Overview" : tab === "comments" ? "Comments" : "History"}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {(isCreateMode || activeTab === "details") && (
          <div className="space-y-5">
            {/* Description */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Description
                </label>
                {!isEditingDescription && descriptionDraft && (
                  <button
                    type="button"
                    onClick={() => setIsEditingDescription(true)}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 rounded transition-colors"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    Edit
                  </button>
                )}
              </div>

              {isEditingDescription ? (
                <div className="space-y-2">
                  <RichTextEditor
                    value={descriptionDraft}
                    onChange={setDescriptionDraft}
                    placeholder="Add a more detailed description..."
                    tools={[
                      "textFormat",
                      "bold",
                      "italic",
                      "more",
                      "separator",
                      "bulletList",
                      "numberedList",
                      "separator",
                      "link",
                    ]}
                    minHeight="64px"
                    maxHeight="none"
                    compact
                    autoFocus
                    disabled={isInteractionDisabled}
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setIsEditingDescription(false)}
                      className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : descriptionDraft ? (
                <div
                  className="text-sm text-gray-700 leading-relaxed prose prose-sm max-w-none border border-gray-200 rounded-lg px-4 py-3 bg-gray-50 cursor-text [&_p]:my-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
                  onClick={() => !isInteractionDisabled && setIsEditingDescription(true)}
                  dangerouslySetInnerHTML={{ __html: descriptionDraft }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => !isInteractionDisabled && setIsEditingDescription(true)}
                  disabled={isInteractionDisabled}
                  className="w-full px-3 py-2 text-sm text-gray-500 border border-gray-300 border-dashed rounded-md hover:border-gray-400 hover:bg-gray-50 transition-colors text-left disabled:opacity-50"
                >
                  Add a description...
                </button>
              )}
            </div>

            {/* Checklist */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
                  <CheckSquare className="w-3.5 h-3.5" />
                  Checklist
                  {checklistItems.length > 0 && (
                    <span className="text-gray-400 font-normal normal-case tracking-normal ml-1">
                      {checklistItems.filter((i) => i.completed).length}/{checklistItems.length}
                    </span>
                  )}
                </label>
              </div>
              <div className="space-y-1 mb-2">
                {checklistItems.map((item, idx) => (
                  <div key={item.id ?? idx} className="flex items-center gap-2 group">
                    <button
                      type="button"
                      onClick={() => {
                        const next = checklistItems.map((ci, i) =>
                          i === idx ? { ...ci, completed: !ci.completed } : ci,
                        );
                        setChecklistItems(next);
                        if (editedTask) setEditedTask({ ...editedTask, checklist: next });
                      }}
                      className={`shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                        item.completed
                          ? "border-emerald-500 bg-emerald-500"
                          : "border-gray-300 bg-white"
                      }`}
                    >
                      {item.completed && <Check className="w-2.5 h-2.5 text-white" />}
                    </button>
                    <span className={`flex-1 text-sm ${item.completed ? "line-through text-gray-400" : "text-gray-700"}`}>
                      {item.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = checklistItems.filter((_, i) => i !== idx);
                        setChecklistItems(next);
                        if (editedTask) setEditedTask({ ...editedTask, checklist: next });
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-red-500 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              {isAddingChecklist ? (
                <div className="flex items-center gap-1.5 mt-1">
                  <input
                    type="text"
                    autoFocus
                    value={newChecklistTitle}
                    onChange={(e) => setNewChecklistTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (!newChecklistTitle.trim()) return;
                        const next = [...checklistItems, { id: crypto.randomUUID(), title: newChecklistTitle.trim(), completed: false }];
                        setChecklistItems(next);
                        if (editedTask) setEditedTask({ ...editedTask, checklist: next });
                        setNewChecklistTitle("");
                        setIsAddingChecklist(false);
                      }
                      if (e.key === "Escape") {
                        setNewChecklistTitle("");
                        setIsAddingChecklist(false);
                      }
                    }}
                    placeholder="Subtask title..."
                    className="flex-1 px-2 py-1 text-sm border-b border-gray-200 focus:border-primary focus:outline-none bg-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newChecklistTitle.trim()) return;
                      const next = [...checklistItems, { id: crypto.randomUUID(), title: newChecklistTitle.trim(), completed: false }];
                      setChecklistItems(next);
                      if (editedTask) setEditedTask({ ...editedTask, checklist: next });
                      setNewChecklistTitle("");
                      setIsAddingChecklist(false);
                    }}
                    disabled={!newChecklistTitle.trim()}
                    className="p-1 text-gray-500 hover:text-primary disabled:opacity-40 transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => { setNewChecklistTitle(""); setIsAddingChecklist(false); }}
                    className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsAddingChecklist(true)}
                  disabled={isInteractionDisabled}
                  className="flex items-center gap-1 mt-1 text-xs text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add subtask
                </button>
              )}
            </div>

            {/* Attachments */}
            {!isCreateMode && (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleAddAttachment(file);
                    e.target.value = "";
                  }}
                />
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
                    <Paperclip className="w-3.5 h-3.5" />
                    Attachments
                    {attachments.length > 0 && (
                      <span className="font-normal normal-case tracking-normal text-gray-400 ml-0.5">{attachments.length}</span>
                    )}
                  </label>
                  {attachments.length > 0 && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isInteractionDisabled}
                      className="p-1 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
                      title="Add attachment"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {isLoadingAttachments ? (
                  <p className="text-xs text-gray-400">Loading...</p>
                ) : attachments.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isInteractionDisabled}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-dashed border-gray-200 text-xs text-gray-400 hover:border-gray-300 hover:text-gray-500 hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    <Paperclip className="w-3.5 h-3.5" />
                    Attach a file
                  </button>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {attachments.map((a) => (
                      <div
                        key={a.id}
                        className="group flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-600 max-w-[200px] hover:border-gray-300 transition-colors"
                      >
                        <Paperclip className="w-3 h-3 shrink-0 text-gray-400" />
                        {a.file_url ? (
                          <a
                            href={a.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="truncate flex-1 hover:text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {a.file_name}
                          </a>
                        ) : (
                          <span className="truncate flex-1">{a.file_name}</span>
                        )}
                        {a.file_size && (
                          <span className="text-gray-400 shrink-0">{formatFileSize(a.file_size)}</span>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleRemoveAttachment(a.id)}
                          className="shrink-0 text-gray-300 hover:text-red-400 transition-colors ml-0.5"
                          title="Remove"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Dependencies */}
            {!isCreateMode && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5" />
                    Dependencies
                  </label>
                </div>
                {isLoadingDeps ? (
                  <p className="text-xs text-gray-400">Loading...</p>
                ) : (
                  <div className="space-y-3">
                    {dependencies.blocked_by.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-400 mb-1 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 text-red-400" />
                          Blocked by
                        </p>
                        <div className="space-y-1">
                          {dependencies.blocked_by.map((dep) => (
                            <div key={dep.id} className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-md px-2.5 py-1.5 text-xs">
                              <span className="flex-1 text-gray-700 truncate">{dep.blocking_task?.title ?? dep.blocking_task_id}</span>
                              {dep.blocking_task?.status && (
                                <span className="text-gray-400 shrink-0">{dep.blocking_task.status.replace(/_/g, " ")}</span>
                              )}
                              <button type="button" onClick={() => void handleRemoveDependency(dep.id)} className="shrink-0 text-gray-400 hover:text-red-500 transition-colors">
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {dependencies.blocking.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-400 mb-1">Blocking</p>
                        <div className="space-y-1">
                          {dependencies.blocking.map((dep) => (
                            <div key={dep.id} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-md px-2.5 py-1.5 text-xs">
                              <span className="flex-1 text-gray-700 truncate">{dep.blocked_task?.title ?? dep.blocked_task_id}</span>
                              {dep.blocked_task?.status && (
                                <span className="text-gray-400 shrink-0">{dep.blocked_task.status.replace(/_/g, " ")}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="relative">
                      <input
                        type="text"
                        value={depSearchQuery}
                        onChange={(e) => { setDepSearchQuery(e.target.value); setIsDepSearchOpen(true); }}
                        onFocus={() => setIsDepSearchOpen(true)}
                        onBlur={() => setTimeout(() => setIsDepSearchOpen(false), 150)}
                        placeholder="Search tasks to block this one..."
                        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                      {isDepSearchOpen && (
                        <div className="absolute z-20 left-0 right-0 bottom-full mb-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
                          {filteredDepTasks.length > 0 ? (
                            filteredDepTasks.map((t) => (
                              <button
                                key={t.id}
                                type="button"
                                onMouseDown={(e) => { e.preventDefault(); void handleAddDependency(t.id); }}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 truncate"
                              >
                                {t.title}
                              </button>
                            ))
                          ) : (
                            <p className="px-3 py-2 text-xs text-gray-400">
                              {depSearchQuery ? "No tasks found" : "No other tasks available"}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        )}

        {!isCreateMode && activeTab === "history" && (
          <div className="space-y-1">
            {isLoadingHistory ? (
              <p className="text-sm text-gray-400 py-8 text-center">Loading history...</p>
            ) : history.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <History className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-sm">No activity recorded yet.</p>
              </div>
            ) : (
              <div className="relative pl-8">
                <div className="absolute left-3 top-0 bottom-0 w-px bg-gray-200" />
                {history.map((entry) => {
                  const user = entry.changed_by_user;
                  const name = user?.display_name ?? "Someone";
                  const initials = name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
                  const when = new Date(entry.created_at);
                  const diffMs = Date.now() - when.getTime();
                  const diffMins = Math.floor(diffMs / 60000);
                  const diffHrs = Math.floor(diffMins / 60);
                  const diffDays = Math.floor(diffHrs / 24);
                  const timeAgo = diffMins < 1 ? "just now" : diffMins < 60 ? `${diffMins}m ago` : diffHrs < 24 ? `${diffHrs}h ago` : diffDays === 1 ? "yesterday" : `${diffDays}d ago`;
                  const fieldLabels: Record<string, string> = {
                    status: "Status", priority: "Priority", assignee_id: "Assignee",
                    due_date: "Due Date", title: "Title", created: "Created",
                  };
                  const fieldLabel = fieldLabels[entry.field_name] ?? entry.field_name;

                  return (
                    <div key={entry.id} className="relative flex gap-3 pb-4">
                      <div className="absolute -left-5 w-6 h-6 rounded-full bg-white border border-gray-200 flex items-center justify-center z-10 shrink-0">
                        {user?.avatar_url ? (
                          <img src={user.avatar_url} alt={name} className="w-6 h-6 rounded-full object-cover" />
                        ) : (
                          <span className="text-[9px] font-semibold text-gray-600">{initials}</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm text-gray-700">
                          <span className="font-medium">{name}</span>
                          {entry.field_name === "created" ? " created this task" : ` changed ${fieldLabel}`}
                        </p>
                        {entry.field_name !== "created" && (entry.old_value || entry.new_value) && (
                          <p className="text-xs text-gray-400 mt-0.5">
                            {entry.old_value ? <span className="line-through">{entry.old_value.replace(/_/g, " ")}</span> : "none"}
                            {" → "}
                            {entry.new_value ? entry.new_value.replace(/_/g, " ") : "none"}
                          </p>
                        )}
                        <p className="text-xs text-gray-400 mt-0.5">{timeAgo}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {!isCreateMode && activeTab === "comments" && (
          <CommentsSection
            comments={comments}
            onAddComment={handleAddComment}
            onUpdateComment={
              isReadOnlyPending ? undefined : handleUpdateComment
            }
            onDeleteComment={
              isReadOnlyPending ? undefined : handleDeleteComment
            }
            currentUserId={user?.id}
            canComment={Boolean(user) && !isReadOnlyPending}
            disabledMessage={
              isReadOnlyPending
                ? "Comments will unlock once this task is created."
                : undefined
            }
            isLoading={isLoadingComments}
            emptyMessage="No comments yet for this task."
            mentionUsers={mentionUsers}
          />
        )}
      </div>

      {/* Footer Actions */}
      <div className="border-t border-gray-200 px-6 py-4 bg-gray-50 shrink-0">
        {isCreateMode ? (
          <div className="flex items-center gap-2">
            <Button
              onClick={handleSave}
              variant="contained"
              colorScheme="primary"
              size="md"
              className="flex-1 flex items-center justify-center gap-2"
              disabled={isInteractionDisabled}
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
          <div className="flex items-center gap-2 w-full">
            <Button
              onClick={handleSave}
              variant="contained"
              colorScheme="primary"
              size="md"
              className="flex-1 flex items-center justify-center gap-2"
              disabled={isInteractionDisabled}
            >
              {isLoading && (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              {isLoading ? "Saving..." : "Save Changes"}
            </Button>
            <Button
              onClick={() => {
                if (task) {
                  if (isReadOnlyPending) return;
                  onDeleteTask(task.id);
                  onClose();
                }
              }}
              variant="outlined"
              colorScheme="destructive"
              size="md"
              disabled={isInteractionDisabled}
            >
              Delete
            </Button>
          </div>
        )}
        <p className="text-xs text-gray-500 mt-2 text-center">
          Press Esc to close | Ctrl+Enter to save
        </p>
      </div>
    </div>
  );

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
              className={`fixed inset-0 bg-black/15 cursor-default ${asModal ? "z-120 flex items-center justify-center" : "z-120"}`}
            >
              {asModal && (
                <motion.div
                  key="sidepanel-modal-content"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-2xl mx-4"
                >
                  {panelContent}
                </motion.div>
              )}
            </motion.div>
          )}
          {isOpen && !asModal && (
            <motion.div
              key="sidepanel-content"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="fixed top-0 right-0 bottom-0 z-130"
            >
              {panelContent}
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
            (isCreateMode ? newTaskData.title : editedTask?.title)?.trim() ?? ""
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
