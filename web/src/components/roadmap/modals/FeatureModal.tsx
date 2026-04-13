import { useState, useEffect, useRef, useMemo, type FormEvent } from "react";
import { Plus, Edit2, ChevronDown, ChevronUp, Calendar, X } from "lucide-react";
import type {
  Comment,
  FeatureStatus,
  RoadmapFeature,
  RoadmapTask,
} from "@/types/roadmap";
import { useUser } from "@/auth";
import { RoadmapModalLayout } from "./RoadmapModalLayout";
import { RichTextEditor } from "@/components/common/RichTextEditor";
import { TaskListItem } from "../widgets/TaskListItem";
import { CommentsSection } from "../shared/CommentsSection";
import { commentsService } from "@/services/roadmap.service";
import { UnsavedChangesConfirmModal } from "../shared/UnsavedChangesConfirmModal";
import {
  calculateFeatureProgressFromTasks,
  getCompletedTaskCount,
} from "../shared/featureProgress";

interface FeatureModalProps {
  isOpen: boolean;
  epicTitle?: string;
  initialData?: RoadmapFeature;
  titleText?: string;
  submitLabel?: string;
  onClose: () => void;
  onAddTask?: (featureId: string) => void | Promise<void>;
  onUpdateTask?: (task: RoadmapTask) => void | Promise<void>;
  onDeleteTask?: (taskId: string) => void | Promise<void>;
  onSelectTask?: (task: RoadmapTask) => void;
  onSubmit: (data: {
    title: string;
    description: string;
    status: FeatureStatus;
    is_deliverable: boolean;
    start_date?: string;
    end_date?: string;
  }) => void;
  isLoading?: boolean;
  isPendingCreate?: boolean;
}

export const FeatureModal = ({
  isOpen,
  epicTitle: _epicTitle,
  initialData,
  titleText: _titleText = "Add Feature",
  submitLabel = "Create Feature",
  onClose,
  onAddTask,
  onUpdateTask,
  onDeleteTask,
  onSelectTask,
  onSubmit,
  isLoading = false,
  isPendingCreate = false,
}: FeatureModalProps) => {
  const user = useUser();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<FeatureStatus>("not_started");
  const [isDeliverable, setIsDeliverable] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [draftStartDate, setDraftStartDate] = useState("");
  const [draftEndDate, setDraftEndDate] = useState("");
  const [isDateMenuOpen, setIsDateMenuOpen] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showReadMore, setShowReadMore] = useState(false);
  const [showUnsavedChangesConfirm, setShowUnsavedChangesConfirm] =
    useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const descriptionRef = useRef<HTMLDivElement>(null);
  const initialSnapshotRef = useRef<{
    title: string;
    description: string;
    status: FeatureStatus;
    isDeliverable: boolean;
    startDate: string;
    endDate: string;
  } | null>(null);
  const isReadOnlyPending = isPendingCreate;

  // Populate form from initialData when modal opens
  useEffect(() => {
    if (isOpen) {
      const nextInitialValues = {
        title: initialData?.title ?? "",
        description: initialData?.description ?? "",
        status: initialData?.status ?? "not_started",
        isDeliverable: initialData?.is_deliverable ?? false,
        startDate: initialData?.start_date?.slice(0, 10) ?? "",
        endDate: initialData?.end_date?.slice(0, 10) ?? "",
      };
      initialSnapshotRef.current = nextInitialValues;

      setTitle(nextInitialValues.title);
      setDescription(nextInitialValues.description);
      setStatus(nextInitialValues.status);
      setIsDeliverable(nextInitialValues.isDeliverable);
      setStartDate(nextInitialValues.startDate);
      setEndDate(nextInitialValues.endDate);
      setDraftStartDate(nextInitialValues.startDate);
      setDraftEndDate(nextInitialValues.endDate);
      setIsDateMenuOpen(false);
      setIsEditingDescription(false);
      setIsExpanded(false);
      setShowUnsavedChangesConfirm(false);
    }
  }, [isOpen, initialData?.id]);

  useEffect(() => {
    if (!isOpen) {
      setShowUnsavedChangesConfirm(false);
    }
  }, [isOpen]);

  useEffect(() => {
    // Check if content needs "Show more" button after render
    const checkHeight = () => {
      if (descriptionRef.current && description && !isEditingDescription) {
        const needsShowMore = descriptionRef.current.scrollHeight > 192; // 192px = max-h-48
        setShowReadMore(needsShowMore);
      } else {
        setShowReadMore(false);
      }
    };

    // Use setTimeout to ensure DOM has updated
    const timer = setTimeout(checkHeight, 100);
    return () => clearTimeout(timer);
  }, [description, isEditingDescription, isOpen]);

  const submitCurrentValues = () => {
    onSubmit({
      title,
      description,
      status,
      is_deliverable: isDeliverable,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
    });

    // Reset form only if not in edit mode
    if (!initialData) {
      setTitle("");
      setDescription("");
      setStatus("not_started");
      setIsDeliverable(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submitCurrentValues();
  };

  const hasUnsavedChanges = useMemo(() => {
    const snapshot = initialSnapshotRef.current;
    if (!snapshot) return false;

    return (
      title !== snapshot.title ||
      description !== snapshot.description ||
      status !== snapshot.status ||
      isDeliverable !== snapshot.isDeliverable ||
      startDate !== snapshot.startDate ||
      endDate !== snapshot.endDate
    );
  }, [description, endDate, isDeliverable, startDate, status, title]);

  const handleRequestClose = () => {
    if (isLoading) return;
    if (hasUnsavedChanges) {
      setShowUnsavedChangesConfirm(true);
      return;
    }
    onClose();
  };

  const handleDiscardChanges = () => {
    setShowUnsavedChangesConfirm(false);
    onClose();
  };

  const handleSaveBeforeClose = () => {
    if (isLoading || isReadOnlyPending || !title.trim()) return;
    setShowUnsavedChangesConfirm(false);
    submitCurrentValues();
    onClose();
  };

  const hasDates = Boolean(startDate || endDate);

  const formatDate = (value?: string) => {
    if (!value) return "";
    return new Date(value).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const displayDateRange = `${startDate ? formatDate(startDate) : "No start"} - ${endDate ? formatDate(endDate) : "No end"}`;

  const openDateMenu = () => {
    setDraftStartDate(startDate);
    setDraftEndDate(endDate);
    setIsDateMenuOpen(true);
  };

  const saveDates = () => {
    setStartDate(draftStartDate);
    setEndDate(draftEndDate);
    setIsDateMenuOpen(false);
  };

  const removeDates = () => {
    setStartDate("");
    setEndDate("");
    setDraftStartDate("");
    setDraftEndDate("");
    setIsDateMenuOpen(false);
  };

  const tasks: RoadmapTask[] =
    (initialData?.tasks as RoadmapTask[] | undefined) ?? [];
  const featureAssignees = useMemo(() => {
    const deduped = new Map<string, NonNullable<RoadmapTask["assignee"]>>();

    for (const task of tasks) {
      const assigneeId = task.assignee_id ?? task.assignee?.id;
      if (!assigneeId || !task.assignee) continue;
      if (!deduped.has(assigneeId)) deduped.set(assigneeId, task.assignee);
    }

    return Array.from(deduped.values());
  }, [tasks]);
  const featureId = initialData?.id;
  const loadComments = async () => {
    if (!featureId) return;

    try {
      setLoadingComments(true);
      const fetched = await commentsService.getFeatureComments(featureId);
      setComments(fetched);
    } catch (error) {
      console.error("Failed to load feature comments:", error);
      setComments([]);
    } finally {
      setLoadingComments(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      setComments([]);
      setLoadingComments(false);
      return;
    }

    if (featureId) {
      void loadComments();
    }
  }, [isOpen, featureId]);

  const handleAddComment = async (content: string) => {
    if (!featureId) return;
    const created = await commentsService.addFeatureComment(featureId, content);
    setComments((prev) => [...prev, created]);
  };

  const handleUpdateComment = async (commentId: string, content: string) => {
    if (!featureId) return;
    const updated = await commentsService.updateFeatureComment(
      featureId,
      commentId,
      content,
    );
    setComments((prev) =>
      prev.map((comment) => (comment.id === commentId ? updated : comment)),
    );
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!featureId) return;
    await commentsService.deleteFeatureComment(featureId, commentId);
    setComments((prev) => prev.filter((comment) => comment.id !== commentId));
  };
  const autoProgress = calculateFeatureProgressFromTasks(tasks);
  const completedTasks = getCompletedTaskCount(tasks);

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
      <div className="w-6 h-6 rounded-full bg-gray-200 text-gray-700 text-[9px] font-bold flex items-center justify-center ring-1 ring-white">
        {initials}
      </div>
    );
  };

  const body = (
    <>
      <div
        className={
          isReadOnlyPending ? "pointer-events-none opacity-70" : undefined
        }
      >
        {/* Status and Deliverable Row */}
        <div className="flex gap-6 mb-6">
          {/* Status */}
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Status</h3>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as FeatureStatus)}
              className="w-full px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-white"
            >
              <option value="not_started">Not Started</option>
              <option value="in_progress">In Progress</option>
              <option value="in_review">In Review</option>
              <option value="completed">Completed</option>
              <option value="blocked">Blocked</option>
            </select>
          </div>

          {/* Is Deliverable */}
          <div className="w-48">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">
              Deliverable
            </h3>
            <label className="flex items-center gap-2 cursor-pointer h-[42px]">
              <input
                type="checkbox"
                checked={isDeliverable}
                onChange={(e) => setIsDeliverable(e.target.checked)}
                className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
              />
              <span className="text-sm text-gray-700">Milestone progress</span>
            </label>
          </div>
        </div>

        {/* Progress (auto-calculated from task statuses) */}
        <div className="mb-6">
          <div className="flex items-center justify-between text-sm text-gray-700 mb-1.5">
            <h3 className="font-semibold text-gray-900">Progress</h3>
            <span className="font-medium">{autoProgress}%</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${autoProgress}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Auto-calculated from tasks: {completedTasks}/{tasks.length} done
          </p>
        </div>

        {/* Assignees (derived from child tasks) */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">
            Assignees
          </h3>
          {featureAssignees.length > 0 ? (
            <div className="flex items-center">
              {featureAssignees.slice(0, 6).map((assignee, index) => (
                <div
                  key={assignee.id}
                  className={index > 0 ? "-ml-1.5" : ""}
                  title={assignee.display_name ?? assignee.email ?? "Assignee"}
                >
                  {renderAssigneeAvatar(assignee)}
                </div>
              ))}
              {featureAssignees.length > 6 && (
                <span className="-ml-1.5 w-6 h-6 rounded-full bg-gray-100 border border-white flex items-center justify-center text-[9px] font-semibold text-gray-600">
                  +{featureAssignees.length - 6}
                </span>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-500">No assignees yet</p>
          )}
        </div>

        {/* Dates */}
        <div
          className={`relative ${hasDates || isDateMenuOpen ? "mb-6" : "mb-0"}`}
        >
          {hasDates && (
            <button
              type="button"
              onClick={openDateMenu}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-900 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              <Calendar className="w-4 h-4 text-gray-500" />
              {displayDateRange}
              <ChevronDown className="w-4 h-4 text-gray-500" />
            </button>
          )}

          {isDateMenuOpen && (
            <div className="absolute z-20 mt-2 w-full max-w-[420px] rounded-xl border border-gray-200 bg-white shadow-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900">Dates</h3>
                <button
                  type="button"
                  onClick={() => setIsDateMenuOpen(false)}
                  className="p-1 rounded hover:bg-gray-100"
                >
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Start date
                  </label>
                  <input
                    type="date"
                    value={draftStartDate}
                    onChange={(e) => setDraftStartDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    End date
                  </label>
                  <input
                    type="date"
                    value={draftEndDate}
                    onChange={(e) => setDraftEndDate(e.target.value)}
                    min={draftStartDate || undefined}
                    className="w-full px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                  />
                </div>
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={removeDates}
                  className="px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                >
                  Remove
                </button>
                <button
                  type="button"
                  onClick={saveDates}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-primary rounded-md hover:bg-primary/90 transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Description */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-900">Description</h3>
            {!isEditingDescription && description && (
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
                value={description}
                onChange={setDescription}
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
                  "image",
                ]}
                minHeight="100px"
                maxHeight="none"
                autoFocus
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
          ) : description ? (
            <div className="relative">
              <div
                ref={descriptionRef}
                className={`relative text-sm text-gray-700 leading-relaxed prose prose-sm max-w-none overflow-hidden transition-[max-height] duration-300 ease-in-out ${
                  isExpanded ? "max-h-[2000px]" : "max-h-48"
                }`}
              >
                <div dangerouslySetInnerHTML={{ __html: description }} />

                {/* Gradient Overlay when collapsed */}
                {!isExpanded && showReadMore && (
                  <div className="absolute bottom-0 left-0 right-0 h-12 bg-linear-to-t from-white to-transparent pointer-events-none" />
                )}
              </div>

              {/* Show More / Less Button */}
              {showReadMore && (
                <button
                  type="button"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
                >
                  {isExpanded ? (
                    <>
                      Show less <ChevronUp className="w-3 h-3" />
                    </>
                  ) : (
                    <>
                      Show more <ChevronDown className="w-3 h-3" />
                    </>
                  )}
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditingDescription(true)}
              className="w-full px-3 py-2 text-sm text-gray-500 border border-gray-300 border-dashed rounded-md hover:border-gray-400 hover:bg-gray-50 transition-colors text-left"
            >
              Add a description...
            </button>
          )}
        </div>
      </div>
    </>
  );

  const footer = (
    <div className="flex justify-end">
      <button
        type="submit"
        disabled={!title.trim() || isLoading || isReadOnlyPending}
        className="px-6 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
      >
        {isLoading ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Saving...
          </>
        ) : isReadOnlyPending ? (
          "Creating..."
        ) : (
          submitLabel
        )}
      </button>
    </div>
  );

  const rightPanelTabs = [
    {
      id: "comments",
      label: "Comments",
      content: featureId ? (
        <CommentsSection
          comments={comments}
          onAddComment={handleAddComment}
          onUpdateComment={isReadOnlyPending ? undefined : handleUpdateComment}
          onDeleteComment={isReadOnlyPending ? undefined : handleDeleteComment}
          currentUserId={user?.id}
          canComment={Boolean(user) && !isReadOnlyPending}
          disabledMessage={
            isReadOnlyPending
              ? "Comments will unlock once this feature is created."
              : undefined
          }
          isLoading={loadingComments}
          emptyMessage="No comments yet for this feature."
        />
      ) : (
        <div className="text-center py-8">
          <p className="text-sm text-gray-500">
            Save feature first to add comments
          </p>
        </div>
      ),
    },
    {
      id: "tasks",
      label: "Tasks",
      content: (
        <div className="space-y-3">
          {/* Tasks List */}
          {tasks.length ? (
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
              {tasks.map((task) => (
                <TaskListItem
                  key={task.id ?? task.title}
                  task={task}
                  onDelete={isReadOnlyPending ? undefined : onDeleteTask}
                  onClick={onSelectTask}
                  onToggleComplete={(taskId) => {
                    if (isReadOnlyPending) return;
                    const taskToUpdate = tasks.find((t) => t.id === taskId);
                    if (!taskToUpdate) return;
                    if (!onUpdateTask) return;
                    void Promise.resolve(
                      onUpdateTask({
                        ...taskToUpdate,
                        status:
                          taskToUpdate.status === "done" ? "todo" : "done",
                      }),
                    ).catch(() => undefined);
                  }}
                  onUpdateStatus={(taskId, status) => {
                    if (isReadOnlyPending) return;
                    const taskToUpdate = tasks.find((t) => t.id === taskId);
                    if (!taskToUpdate) return;
                    if (!onUpdateTask) return;
                    void Promise.resolve(
                      onUpdateTask({
                        ...taskToUpdate,
                        status,
                      }),
                    ).catch(() => undefined);
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-sm text-gray-600">No tasks yet.</p>
              <p className="text-xs text-gray-500">
                Add tasks to see them here.
              </p>
            </div>
          )}

          {/* Add Task Button */}
          {onAddTask && featureId && (
            <button
              type="button"
              onClick={() => {
                if (isReadOnlyPending) return;
                onAddTask(featureId);
              }}
              disabled={isReadOnlyPending}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg font-medium text-sm transition-colors mt-4"
            >
              <Plus className="w-4 h-4" />
              Add Task
            </button>
          )}
        </div>
      ),
    },
  ];

  const dateActionButton = !hasDates ? (
    <button
      type="button"
      onClick={openDateMenu}
      disabled={isReadOnlyPending}
      className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
    >
      <Calendar className="w-4 h-4" />
      Dates
    </button>
  ) : null;

  return (
    <>
      <RoadmapModalLayout
        isOpen={isOpen}
        onClose={handleRequestClose}
        isReadOnly={isReadOnlyPending}
        title={title}
        onTitleChange={setTitle}
        titlePlaceholder="Feature title"
        onSubmit={handleSubmit}
        actionButtons={dateActionButton}
        showDefaultDatesAction={false}
        body={body}
        footer={footer}
        canComment={Boolean(user) && !isReadOnlyPending}
        rightPanelTabs={rightPanelTabs}
        defaultRightPanelTabId="comments"
      />
      <UnsavedChangesConfirmModal
        isOpen={isOpen && showUnsavedChangesConfirm}
        isSaving={isLoading}
        isSaveDisabled={!title.trim()}
        entityLabel="feature"
        onCancel={() => setShowUnsavedChangesConfirm(false)}
        onDiscard={handleDiscardChanges}
        onSave={handleSaveBeforeClose}
      />
    </>
  );
};
