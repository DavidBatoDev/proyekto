import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Plus, Edit2, ChevronDown, ChevronUp, Calendar, X } from "lucide-react";
import type {
  EpicPriority,
  Comment,
  RoadmapFeature,
  RoadmapTask,
} from "@/types/roadmap";
import { deriveFeatureStatus } from "@/utils/featureStatus";
import { useUser } from "@/auth";
import { RoadmapModalLayout } from "./RoadmapModalLayout";
import { RichTextEditor } from "@/components/common/RichTextEditor";
import { LabelSelector } from "@/components/common/LabelSelector";
import { TaskListItem } from "../widgets/TaskListItem";
import { CommentsSection } from "../shared/CommentsSection";
import { commentsService } from "@/services/roadmap.service";
import type { Label } from "@/types/label";
import { LABEL_COLORS } from "@/types/label";
import { UnsavedChangesConfirmModal } from "../shared/UnsavedChangesConfirmModal";

interface EpicModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    title: string;
    description: string;
    priority: EpicPriority;
    tags: string[];
    labels?: Label[]; // Add labels field
    start_date?: string;
    end_date?: string;
  }) => void;
  onAddFeature?: () => void;
  onSelectFeature?: (feature: RoadmapFeature) => void;
  onAddTask?: (featureId: string) => void | Promise<void>;
  onUpdateTask?: (task: RoadmapTask) => void | Promise<void>;
  onDeleteTask?: (taskId: string) => void | Promise<void>;
  onSelectTask?: (task: RoadmapTask) => void;
  initialData?: {
    id?: string;
    title?: string;
    description?: string;
    priority?: EpicPriority;
    tags?: string[];
    labels?: Label[]; // Add labels field
    features?: RoadmapFeature[];
    start_date?: string;
    end_date?: string;
  };
  titleText?: string;
  submitLabel?: string;
  isLoading?: boolean;
  isPendingCreate?: boolean;
}

const resolveInitialLabels = (initialData?: EpicModalProps["initialData"]) => {
  if (initialData?.labels) return initialData.labels;
  if (initialData?.tags) {
    return initialData.tags.map((tag, idx) => ({
      id: `label-${idx}`,
      name: tag,
      color: LABEL_COLORS[idx % LABEL_COLORS.length],
    }));
  }
  return [];
};

const labelsSignature = (items: Label[]) =>
  items.map((item) => `${item.name}|${item.color ?? ""}`).join("||");

export const EpicModal = ({
  isOpen,
  onClose,
  onSubmit,
  onAddFeature,
  onSelectFeature,
  onAddTask,
  onUpdateTask,
  onDeleteTask,
  onSelectTask,
  initialData,
  titleText: _titleText = "Add Epic",
  submitLabel = "Create Epic",
  isLoading = false,
  isPendingCreate = false,
}: EpicModalProps) => {
  const user = useUser();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<EpicPriority>("medium");
  const [labels, setLabels] = useState<Label[]>([]);
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
    priority: EpicPriority;
    labels: Label[];
    startDate: string;
    endDate: string;
  } | null>(null);

  const epicId = initialData?.id;
  const isReadOnlyPending = isPendingCreate;

  useEffect(() => {
    if (isOpen) {
      const nextInitialValues = {
        title: initialData?.title ?? "",
        description: initialData?.description ?? "",
        priority: initialData?.priority ?? "medium",
        labels: resolveInitialLabels(initialData),
        startDate: initialData?.start_date?.slice(0, 10) ?? "",
        endDate: initialData?.end_date?.slice(0, 10) ?? "",
      };
      initialSnapshotRef.current = nextInitialValues;

      setTitle(nextInitialValues.title);
      setDescription(nextInitialValues.description);
      setPriority(nextInitialValues.priority);
      setStartDate(nextInitialValues.startDate);
      setEndDate(nextInitialValues.endDate);
      setDraftStartDate(nextInitialValues.startDate);
      setDraftEndDate(nextInitialValues.endDate);
      setIsDateMenuOpen(false);
      setShowUnsavedChangesConfirm(false);

      setLabels(nextInitialValues.labels);

      // Reset description editing state when modal opens
      setIsEditingDescription(false);
      setIsExpanded(false);
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

  const loadComments = async () => {
    if (!epicId) return;

    try {
      setLoadingComments(true);
      const fetched = await commentsService.getEpicComments(epicId);
      setComments(fetched);
    } catch (error) {
      console.error("Failed to load epic comments:", error);
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

    if (epicId) {
      void loadComments();
    }
  }, [isOpen, epicId]);

  const handleAddComment = async (content: string) => {
    if (!epicId) return;
    const created = await commentsService.addEpicComment(epicId, content);
    setComments((prev) => [...prev, created]);
  };

  const handleUpdateComment = async (commentId: string, content: string) => {
    if (!epicId) return;
    const updated = await commentsService.updateEpicComment(
      epicId,
      commentId,
      content,
    );
    setComments((prev) =>
      prev.map((comment) => (comment.id === commentId ? updated : comment)),
    );
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!epicId) return;
    await commentsService.deleteEpicComment(epicId, commentId);
    setComments((prev) => prev.filter((comment) => comment.id !== commentId));
  };

  const submitCurrentValues = () => {
    // Submit both labels and tags for backward compatibility
    const tags = labels.map((label) => label.name);

    onSubmit({
      title,
      description,
      priority,
      tags,
      labels, // Include full label objects with colors
      start_date: startDate || undefined,
      end_date: endDate || undefined,
    });
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
      priority !== snapshot.priority ||
      startDate !== snapshot.startDate ||
      endDate !== snapshot.endDate ||
      labelsSignature(labels) !== labelsSignature(snapshot.labels)
    );
  }, [description, endDate, labels, priority, startDate, title]);

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

  const features = initialData?.features ?? [];

  const getFeatureStatusColor = (status?: string) => {
    const colorMap: Record<string, string> = {
      not_started: "bg-gray-100 text-gray-800",
      in_progress: "bg-blue-100 text-blue-800",
      in_review: "bg-purple-100 text-purple-800",
      completed: "bg-green-100 text-green-800",
      blocked: "bg-red-100 text-red-800",
    };
    return colorMap[status ?? ""] || "bg-gray-100 text-gray-800";
  };

  const body = (
    <>
      <div
        className={
          isReadOnlyPending ? "pointer-events-none opacity-70" : undefined
        }
      >
        {/* Labels and Priority Row */}
        <div className="flex flex-col gap-4 mb-6 md:flex-row md:gap-6">
          {/* Labels */}
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Labels</h3>
            <LabelSelector
              selectedLabels={labels}
              onLabelsChange={setLabels}
              availableLabels={[]}
            />
          </div>

          {/* Priority */}
          <div className="w-full md:w-48">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">
              Priority
            </h3>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as EpicPriority)}
              className="w-full px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-white"
            >
              <option value="nice_to_have">Nice to Have</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
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

      {/* Features Section */}
      <div className="space-y-3 border-t border-gray-200 pt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Features</h3>
          {onAddFeature && (
            <button
              type="button"
              onClick={onAddFeature}
              disabled={isReadOnlyPending}
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 rounded transition-colors disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Feature
            </button>
          )}
        </div>

        {features.length ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3">
            <div className="space-y-2">
              {features.map((feature) => (
                <div key={feature.id ?? feature.title}>
                  <div
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm hover:border-primary hover:shadow-md transition-all cursor-pointer"
                    onClick={() => {
                      if (isReadOnlyPending) return;
                      onSelectFeature?.(feature);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-gray-900">
                        {feature.title}
                      </p>
                      {(() => {
                        const derivedStatus = deriveFeatureStatus(feature.tasks);
                        return (
                          <span
                            className={`text-xs px-2 py-1 rounded-md font-medium ${getFeatureStatusColor(derivedStatus)}`}
                          >
                            {derivedStatus.replace("_", " ")}
                          </span>
                        );
                      })()}
                    </div>
                    {feature.description ? (
                      <div className="mt-1 text-xs text-gray-600 line-clamp-2 prose prose-sm max-w-none">
                        <div
                          dangerouslySetInnerHTML={{ __html: feature.description }}
                        />
                      </div>
                    ) : null}
                  </div>

                  {feature.tasks && feature.tasks.length > 0 && (
                    <div className="ml-3 mt-2 space-y-1 border-l-2 border-gray-200 pl-3">
                      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                        {feature.tasks.map((task) => (
                          <TaskListItem
                            key={task.id ?? task.title}
                            task={task as RoadmapTask}
                            onDelete={isReadOnlyPending ? undefined : onDeleteTask}
                            onClick={onSelectTask}
                            density="compact"
                            onToggleComplete={(taskId) => {
                              if (isReadOnlyPending) return;
                              if (!onUpdateTask) return;
                              const taskToUpdate = feature.tasks?.find(
                                (t) => t.id === taskId,
                              );
                              if (!taskToUpdate) return;
                              void Promise.resolve(
                                onUpdateTask({
                                  ...taskToUpdate,
                                  status:
                                    taskToUpdate.status === "done"
                                      ? "todo"
                                      : "done",
                                } as RoadmapTask),
                              ).catch(() => undefined);
                            }}
                            onUpdateStatus={(taskId, status) => {
                              if (isReadOnlyPending) return;
                              if (!onUpdateTask) return;
                              const taskToUpdate = feature.tasks?.find(
                                (t) => t.id === taskId,
                              );
                              if (!taskToUpdate) return;
                              void Promise.resolve(
                                onUpdateTask({ ...taskToUpdate, status } as RoadmapTask),
                              ).catch(() => undefined);
                            }}
                          />
                        ))}
                      </div>
                      {onAddTask && feature.id && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isReadOnlyPending) return;
                            onAddTask(feature.id!);
                          }}
                          disabled={isReadOnlyPending}
                          className="w-full flex items-center justify-center gap-1 px-2 py-1.5 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-md text-xs font-medium transition-colors mt-1"
                        >
                          <Plus className="w-3 h-3" />
                          Add Task
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-6 border border-dashed border-gray-200 rounded-lg">
            <p className="text-sm text-gray-500">No features yet.</p>
          </div>
        )}
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
      content: epicId ? (
        <CommentsSection
          comments={comments}
          onAddComment={handleAddComment}
          onUpdateComment={isReadOnlyPending ? undefined : handleUpdateComment}
          onDeleteComment={isReadOnlyPending ? undefined : handleDeleteComment}
          currentUserId={user?.id}
          canComment={Boolean(user) && !isReadOnlyPending}
          disabledMessage={
            isReadOnlyPending
              ? "Comments will unlock once this epic is created."
              : undefined
          }
          isLoading={loadingComments}
          emptyMessage="No comments yet for this epic."
        />
      ) : (
        <div className="text-center py-8">
          <p className="text-sm text-gray-500">
            Save epic first to add comments
          </p>
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
        titlePlaceholder="Title"
        onSubmit={handleSubmit}
        actionButtons={dateActionButton}
        showDefaultDatesAction={false}
        body={body}
        footer={footer}
        canComment={Boolean(user) && !isReadOnlyPending}
        rightPanelTabs={rightPanelTabs}
        defaultRightPanelTabId="comments"
        autoFocusTitle={true}
      />
      <UnsavedChangesConfirmModal
        isOpen={isOpen && showUnsavedChangesConfirm}
        isSaving={isLoading}
        isSaveDisabled={!title.trim()}
        entityLabel="epic"
        onCancel={() => setShowUnsavedChangesConfirm(false)}
        onDiscard={handleDiscardChanges}
        onSave={handleSaveBeforeClose}
      />
    </>
  );
};
