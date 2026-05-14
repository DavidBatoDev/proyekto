import * as React from "react";
import { useState, useEffect } from "react";
import {
  Edit2,
  Trash2,
  Plus,
  X,
  Check,
  ChevronDown,
  ChevronUp,
  MessageSquare,
} from "lucide-react";
import { TaskListItem } from "../../../widgets/TaskListItem";
import type {
  RoadmapEpic,
  RoadmapFeature,
  RoadmapTask,
  Comment,
} from "@/types/roadmap";
import { deriveFeatureStatus } from "@/utils/featureStatus";
import { RichTextEditor } from "@/components/common/RichTextEditor";
import { FeatureModal } from "../../../modals/FeatureModal";
import { CommentsSection } from "../../../shared/CommentsSection";
import { commentsService } from "@/services/roadmap.service";
import { useUser } from "@/stores/authStore";

interface EpicTabProps {
  epic: RoadmapEpic;
  onUpdateEpic: (epic: RoadmapEpic) => void;
  onUpdateFeature: (feature: RoadmapFeature) => void | Promise<void>;
  onDeleteFeature: (featureId: string) => void | Promise<void>;
  onUpdateTask: (task: RoadmapTask) => void | Promise<void>;
  onDeleteTask: (taskId: string) => void | Promise<void>;
  onSelectTask: (task: RoadmapTask) => void;
  onAddTask?: (featureId: string) => void | Promise<void>;
  scrollToFeatureId?: string | null;
  onScrollToFeatureHandled?: () => void;
}

export const EpicTab = ({
  epic,
  onUpdateEpic,
  onUpdateFeature,
  onDeleteFeature,
  onUpdateTask,
  onDeleteTask,
  onSelectTask,
  onAddTask,
  scrollToFeatureId,
  onScrollToFeatureHandled,
}: EpicTabProps) => {
  const user = useUser();
  const features = epic.features || [];
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [titleDraft, setTitleDraft] = useState(epic.title);
  const [descriptionDraft, setDescriptionDraft] = useState(
    epic.description || "",
  );
  const [isExpanded, setIsExpanded] = useState(false);
  const [showReadMore, setShowReadMore] = useState(false);
  const contentRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      setShowReadMore(contentRef.current.scrollHeight > 192); // 192px = max-h-48 (12rem)
    }
  }, [epic.description, isEditingDescription]);

  // Feature expansion state for "Show more" functionality
  const [expandedFeatures, setExpandedFeatures] = React.useState<Set<string>>(
    new Set(),
  );
  const featureRefs = React.useRef<Record<string, HTMLDivElement | null>>({});
  const featureSectionRefs = React.useRef<
    Record<string, HTMLDivElement | null>
  >({});

  // Feature modal state
  const [editingFeature, setEditingFeature] =
    React.useState<RoadmapFeature | null>(null);
  const [isFeatureModalOpen, setIsFeatureModalOpen] = React.useState(false);
  const [isFeatureLoading, setIsFeatureLoading] = React.useState(false);

  // Comments state
  const [comments, setComments] = React.useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = React.useState(false);
  const [hasLoadedComments, setHasLoadedComments] = React.useState(false);
  const [showComments, setShowComments] = React.useState(false);

  // Feature comments state (per feature)
  const [featureComments, setFeatureComments] = React.useState<
    Record<string, Comment[]>
  >({});
  const [hasLoadedFeatureComments, setHasLoadedFeatureComments] =
    React.useState<Record<string, boolean>>({});
  const [loadingFeatureComments, setLoadingFeatureComments] = React.useState<
    Record<string, boolean>
  >({});
  const [showFeatureComments, setShowFeatureComments] = React.useState<
    Set<string>
  >(new Set());

  useEffect(() => {
    if (!isEditingTitle) {
      setTitleDraft(epic.title);
    }
    if (!isEditingDescription) {
      setDescriptionDraft(epic.description || "");
    }
  }, [
    epic.id,
    epic.title,
    epic.description,
    isEditingTitle,
    isEditingDescription,
  ]);

  // Preload comments for accurate count on initial view
  useEffect(() => {
    setComments(epic.comments ?? []);
    setHasLoadedComments(Boolean(epic.comments));
    void loadComments(false);
  }, [epic.id]);

  // Ensure comments are loaded when opening comments section
  useEffect(() => {
    if (showComments && !hasLoadedComments) {
      void loadComments();
    }
  }, [showComments, hasLoadedComments]);

  const loadComments = async (withLoader = true) => {
    try {
      if (withLoader) {
        setLoadingComments(true);
      }
      const fetchedComments = await commentsService.getEpicComments(epic.id);
      setComments(fetchedComments);
      setHasLoadedComments(true);
    } catch (error) {
      console.error("Failed to load comments:", error);
      if (!hasLoadedComments) {
        setComments([]);
      }
    } finally {
      if (withLoader) {
        setLoadingComments(false);
      }
    }
  };

  const handleAddComment = async (content: string) => {
    try {
      const newComment = await commentsService.addEpicComment(epic.id, content);
      setComments((prev) => [...prev, newComment]);
    } catch (error) {
      console.error("Failed to add comment:", error);
      throw error;
    }
  };

  const handleUpdateComment = async (commentId: string, content: string) => {
    try {
      const updatedComment = await commentsService.updateEpicComment(
        epic.id,
        commentId,
        content,
      );
      setComments((prev) =>
        prev.map((comment) =>
          comment.id === commentId ? updatedComment : comment,
        ),
      );
    } catch (error) {
      console.error("Failed to update comment:", error);
      throw error;
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      await commentsService.deleteEpicComment(epic.id, commentId);
      setComments((prev) => prev.filter((comment) => comment.id !== commentId));
    } catch (error) {
      console.error("Failed to delete comment:", error);
      throw error;
    }
  };

  const toggleFeatureComments = (featureId: string) => {
    setShowFeatureComments((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(featureId)) {
        newSet.delete(featureId);
      } else {
        newSet.add(featureId);
        // Load comments if not already loaded
        if (!hasLoadedFeatureComments[featureId]) {
          void loadFeatureComments(featureId);
        }
      }
      return newSet;
    });
  };

  const loadFeatureComments = async (featureId: string, withLoader = true) => {
    try {
      if (withLoader) {
        setLoadingFeatureComments((prev) => ({ ...prev, [featureId]: true }));
      }
      const fetchedComments =
        await commentsService.getFeatureComments(featureId);
      setFeatureComments((prev) => ({ ...prev, [featureId]: fetchedComments }));
      setHasLoadedFeatureComments((prev) => ({ ...prev, [featureId]: true }));
    } catch (error) {
      console.error("Failed to load feature comments:", error);
      if (!hasLoadedFeatureComments[featureId]) {
        setFeatureComments((prev) => ({ ...prev, [featureId]: [] }));
      }
    } finally {
      if (withLoader) {
        setLoadingFeatureComments((prev) => ({ ...prev, [featureId]: false }));
      }
    }
  };

  useEffect(() => {
    const initialFeatureComments: Record<string, Comment[]> = {};
    const initialLoadedFeatureComments: Record<string, boolean> = {};

    for (const feature of features) {
      if (feature.comments) {
        initialFeatureComments[feature.id] = feature.comments;
        initialLoadedFeatureComments[feature.id] = true;
      }
    }

    if (Object.keys(initialFeatureComments).length > 0) {
      setFeatureComments((prev) => ({ ...prev, ...initialFeatureComments }));
    }

    if (Object.keys(initialLoadedFeatureComments).length > 0) {
      setHasLoadedFeatureComments((prev) => ({
        ...prev,
        ...initialLoadedFeatureComments,
      }));
    }

    for (const feature of features) {
      if (!initialLoadedFeatureComments[feature.id]) {
        void loadFeatureComments(feature.id, false);
      }
    }
  }, [epic.id]);

  const handleAddFeatureComment = async (
    featureId: string,
    content: string,
  ) => {
    try {
      const newComment = await commentsService.addFeatureComment(
        featureId,
        content,
      );
      setFeatureComments((prev) => ({
        ...prev,
        [featureId]: [...(prev[featureId] || []), newComment],
      }));
    } catch (error) {
      console.error("Failed to add feature comment:", error);
      throw error;
    }
  };

  const handleUpdateFeatureComment = async (
    featureId: string,
    commentId: string,
    content: string,
  ) => {
    try {
      const updatedComment = await commentsService.updateFeatureComment(
        featureId,
        commentId,
        content,
      );
      setFeatureComments((prev) => ({
        ...prev,
        [featureId]: (prev[featureId] || []).map((comment) =>
          comment.id === commentId ? updatedComment : comment,
        ),
      }));
    } catch (error) {
      console.error("Failed to update feature comment:", error);
      throw error;
    }
  };

  const handleDeleteFeatureComment = async (
    featureId: string,
    commentId: string,
  ) => {
    try {
      await commentsService.deleteFeatureComment(featureId, commentId);
      setFeatureComments((prev) => ({
        ...prev,
        [featureId]: (prev[featureId] || []).filter(
          (comment) => comment.id !== commentId,
        ),
      }));
    } catch (error) {
      console.error("Failed to delete feature comment:", error);
      throw error;
    }
  };

  const handleSaveTitle = () => {
    const nextTitle = titleDraft.trim();
    if (nextTitle && nextTitle !== epic.title) {
      onUpdateEpic({ ...epic, title: nextTitle });
    }
    setIsEditingTitle(false);
  };

  const handleSaveDescription = () => {
    const nextDescription = descriptionDraft.trim();
    if (nextDescription !== (epic.description || "")) {
      onUpdateEpic({ ...epic, description: nextDescription || undefined });
    }
    setIsEditingDescription(false);
  };

  const toggleFeatureExpansion = (featureId: string) => {
    setExpandedFeatures((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(featureId)) {
        newSet.delete(featureId);
      } else {
        newSet.add(featureId);
      }
      return newSet;
    });
  };

  const handleOpenFeatureModal = (feature: RoadmapFeature) => {
    setEditingFeature(feature);
    setIsFeatureModalOpen(true);
  };

  const handleCloseFeatureModal = () => {
    setIsFeatureModalOpen(false);
    setEditingFeature(null);
  };

  const handleUpdateFeatureFromModal = async (data: {
    title: string;
    description: string;
    is_deliverable: boolean;
  }) => {
    if (editingFeature) {
      setIsFeatureLoading(true);
      try {
        await onUpdateFeature({
          ...editingFeature,
          ...data,
        });
        handleCloseFeatureModal();
      } finally {
        setIsFeatureLoading(false);
      }
    }
  };

  const getStatusColor = (status: string) => {
    const colorMap: Record<string, string> = {
      not_started: "bg-gray-100 text-gray-800",
      in_progress: "bg-blue-100 text-blue-800",
      in_review: "bg-purple-100 text-purple-800",
      completed: "bg-green-100 text-green-800",
      blocked: "bg-red-100 text-red-800",
      todo: "bg-gray-100 text-gray-800",
      done: "bg-green-100 text-green-800",
    };
    return colorMap[status] || "bg-gray-100 text-gray-800";
  };

  useEffect(() => {
    if (!scrollToFeatureId) {
      return;
    }

    const targetRef = featureSectionRefs.current[scrollToFeatureId];
    if (!targetRef) {
      return;
    }

    targetRef.scrollIntoView({ behavior: "smooth", block: "start" });
    onScrollToFeatureHandled?.();
  }, [features, onScrollToFeatureHandled, scrollToFeatureId]);

  const getEpicPriorityColor = (priority: string) => {
    const colorMap: Record<string, string> = {
      critical: "bg-red-100 text-red-800",
      high: "bg-amber-100 text-amber-800",
      medium: "bg-blue-100 text-blue-800",
      low: "bg-emerald-100 text-emerald-800",
      nice_to_have: "bg-gray-100 text-gray-700",
    };
    return colorMap[priority] || "bg-gray-100 text-gray-700";
  };

  const getEpicStatusColor = (status: string) => {
    const colorMap: Record<string, string> = {
      backlog: "bg-gray-100 text-gray-800",
      planned: "bg-sky-100 text-sky-800",
      in_progress: "bg-blue-100 text-blue-800",
      in_review: "bg-purple-100 text-purple-800",
      completed: "bg-green-100 text-green-800",
      on_hold: "bg-amber-100 text-amber-800",
    };
    return colorMap[status] || "bg-gray-100 text-gray-800";
  };

  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-gray-50">
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-8">
        {/* Epic Header */}
        <div className="mb-6 flex flex-col gap-6 lg:flex-row min-w-0">
          <div className="lg:w-[70%] min-w-0">
            <div className="flex items-start justify-between gap-3 mb-2 group">
              {isEditingTitle ? (
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleSaveTitle();
                    }
                  }}
                  onBlur={handleSaveTitle}
                  className="w-full text-2xl font-bold text-gray-900 bg-transparent border-none px-0 py-0 leading-normal focus:outline-none focus:ring-0"
                />
              ) : (
                <div className="flex items-center gap-2">
                  <h2 className="text-2xl font-bold text-gray-900">
                    {epic.title}
                  </h2>
                  <button
                    onClick={() => setIsEditingTitle(true)}
                    className="p-1.5 rounded hover:bg-gray-100 transition-colors opacity-0 group-hover:opacity-100"
                    title="Edit epic title"
                  >
                    <Edit2 className="w-4 h-4 text-gray-600" />
                  </button>
                </div>
              )}
            </div>

            {(epic.priority || epic.status) && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {epic.priority && (
                  <span
                    className={`text-xs px-3 py-1 rounded-full font-semibold ${getEpicPriorityColor(epic.priority)}`}
                  >
                    Priority: {epic.priority.replace("_", " ")}
                  </span>
                )}
                {epic.status && (
                  <span
                    className={`text-xs px-3 py-1 rounded-full font-semibold ${getEpicStatusColor(epic.status)}`}
                  >
                    Status: {epic.status.replace("_", " ")}
                  </span>
                )}
              </div>
            )}

            {/* Description Container */}
            <div className="group/description relative">
              {isEditingDescription ? (
                <div className="space-y-2">
                  <RichTextEditor
                    value={descriptionDraft}
                    onChange={setDescriptionDraft}
                    placeholder="Add an epic description"
                    minHeight="100px"
                    maxHeight="300px"
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => {
                        setDescriptionDraft(epic.description || "");
                        setIsEditingDescription(false);
                      }}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveDescription}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-primary rounded hover:bg-primary/90 transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="relative group/edit">
                  <div
                    ref={contentRef}
                    className={`relative text-base text-gray-700 leading-relaxed prose prose-sm max-w-none overflow-hidden transition-[max-height] duration-300 ease-in-out [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 ${
                      isExpanded ? "max-h-[2000px]" : "max-h-48"
                    }`}
                  >
                    <div
                      dangerouslySetInnerHTML={{
                        __html: epic.description || "Add an epic description",
                      }}
                    />

                    {/* Gradient Overlay when collapsed */}
                    {!isExpanded && showReadMore && (
                      <div className="absolute bottom-0 left-0 right-0 h-12 bg-linear-to-t from-gray-50 to-transparent pointer-events-none" />
                    )}
                  </div>

                  {/* Edit Button - Top Right */}
                  <button
                    onClick={() => setIsEditingDescription(true)}
                    className="absolute top-0 right-0 p-1.5 rounded hover:bg-gray-100 transition-colors opacity-0 group-hover/edit:opacity-100"
                    title="Edit epic description"
                  >
                    <Edit2 className="w-4 h-4 text-gray-600" />
                  </button>

                  {/* Show More / Less Button */}
                  {showReadMore && (
                    <button
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
              )}
            </div>
          </div>

          <div className="lg:w-[30%] shrink-0">
            <div className="flex flex-wrap items-start justify-end gap-2">
              {epic.tags?.map((tag) => (
                <span
                  key={tag}
                  className="text-xs px-3 py-1 rounded-full font-medium bg-gray-100 text-gray-700"
                >
                  {tag}
                </span>
              ))}
            </div>

            {typeof epic.progress === "number" && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                  <span>Progress</span>
                  <span>
                    {Math.round(Math.max(0, Math.min(100, epic.progress)))}%
                  </span>
                </div>
                <div className="w-full h-2 bg-gray-200 rounded-full">
                  <div
                    className="h-2 rounded-full bg-primary"
                    style={{
                      width: `${Math.max(0, Math.min(100, epic.progress))}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <div className="mt-6 space-y-4 text-sm text-gray-600">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                  Links
                </h4>
                <p className="text-gray-500">No links added</p>
              </div>
              <div className="h-32 rounded-lg border border-gray-200 bg-white p-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                  Attachments
                </h4>
                <p className="text-gray-500">No attachments added</p>
              </div>
            </div>
          </div>
        </div>

        {/* Comments Section */}
        <div className="mb-6">
          <button
            onClick={() => setShowComments(!showComments)}
            className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
          >
            <MessageSquare className="w-4 h-4" />
            {showComments
              ? "Hide Comments"
              : hasLoadedComments
                ? `Show Comments (${comments.length})`
                : "Show Comments (...)"}
          </button>

          {showComments && (
            <div className="mt-4">
              <CommentsSection
                comments={comments}
                onAddComment={handleAddComment}
                onUpdateComment={handleUpdateComment}
                onDeleteComment={handleDeleteComment}
                currentUserId={user?.id}
                isLoading={loadingComments}
                canComment={Boolean(user)}
              />
            </div>
          )}
        </div>

        {/* Features Grid */}
        <div className="space-y-6">
          {features.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg border-2 border-dashed border-gray-300">
              <p className="text-gray-500">No features yet</p>
            </div>
          ) : (
            features.map((feature) => (
              <div
                key={feature.id}
                ref={(el) => {
                  featureSectionRefs.current[feature.id] = el;
                }}
                className="bg-gray-100 rounded-xl border-2 border-gray-200 shadow-sm overflow-hidden min-w-0 max-w-full"
              >
                {/* Feature Row */}
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3 flex-1">
                      <h3 className="text-lg font-semibold text-gray-900">
                        {feature.title}
                      </h3>
                      {(() => {
                        const derivedStatus = deriveFeatureStatus(feature.tasks);
                        return (
                          <span
                            className={`text-xs px-2 py-1 rounded-md font-medium ${getStatusColor(derivedStatus)}`}
                          >
                            {derivedStatus.replace("_", " ")}
                          </span>
                        );
                      })()}
                      {feature.is_deliverable && (
                        <span className="text-xs px-2 py-1 bg-amber-100 text-amber-800 rounded-md font-medium">
                          Deliverable
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleOpenFeatureModal(feature)}
                        className="p-1.5 hover:bg-gray-200 rounded transition-colors"
                        title="Edit feature"
                      >
                        <Edit2 className="w-4 h-4 text-gray-600" />
                      </button>
                      <button
                        onClick={() => onDeleteFeature(feature.id)}
                        className="p-1.5 hover:bg-red-100 rounded transition-colors"
                        title="Delete feature"
                      >
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </button>
                    </div>
                  </div>

                  {/* Feature Description with Show More */}
                  {feature.description && (
                    <div className="relative">
                      <div
                        ref={(el) => {
                          featureRefs.current[feature.id] = el;
                        }}
                        className={`relative text-sm text-gray-600 leading-relaxed prose prose-sm max-w-none overflow-hidden transition-[max-height] duration-300 ease-in-out ${
                          expandedFeatures.has(feature.id)
                            ? "max-h-[2000px]"
                            : "max-h-32"
                        }`}
                      >
                        <div
                          dangerouslySetInnerHTML={{
                            __html: feature.description,
                          }}
                        />

                        {/* Gradient Overlay when collapsed */}
                        {!expandedFeatures.has(feature.id) &&
                          featureRefs.current[feature.id]?.scrollHeight &&
                          featureRefs.current[feature.id]!.scrollHeight >
                            128 && (
                            <div className="absolute bottom-0 left-0 right-0 h-12 bg-linear-to-t from-gray-50 to-transparent pointer-events-none" />
                          )}
                      </div>

                      {/* Show More / Less Button */}
                      {featureRefs.current[feature.id]?.scrollHeight &&
                        featureRefs.current[feature.id]!.scrollHeight > 128 && (
                          <button
                            onClick={() => toggleFeatureExpansion(feature.id)}
                            className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
                          >
                            {expandedFeatures.has(feature.id) ? (
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
                  )}
                </div>

                {/* Tasks List */}
                <div className="border-t border-gray-200">
                  {feature.tasks && feature.tasks.length > 0 && (
                    <>
                      <div className="px-6 py-3 bg-gray-50">
                        <h3 className="text-sm font-semibold text-gray-900">
                          Tasks (
                          {
                            feature.tasks.filter((t) => t.status === "done")
                              .length
                          }
                          /{feature.tasks.length})
                        </h3>
                      </div>
                      <div className="divide-y divide-gray-100 px-4 py-2">
                        {feature.tasks.map((task) => (
                          <TaskListItem
                            key={task.id}
                            task={task}
                            onDelete={onDeleteTask}
                            onClick={onSelectTask}
                            onToggleComplete={(taskId) => {
                              const taskToUpdate = feature.tasks?.find(
                                (t) => t.id === taskId,
                              );
                              if (taskToUpdate) {
                                void Promise.resolve(
                                  onUpdateTask({
                                    ...taskToUpdate,
                                    status:
                                      taskToUpdate.status === "done"
                                        ? "todo"
                                        : "done",
                                  }),
                                ).catch(() => undefined);
                              }
                            }}
                            onUpdateStatus={(taskId, status) => {
                              const taskToUpdate = feature.tasks?.find(
                                (t) => t.id === taskId,
                              );
                              if (taskToUpdate) {
                                void Promise.resolve(
                                  onUpdateTask({
                                    ...taskToUpdate,
                                    status,
                                  }),
                                ).catch(() => undefined);
                              }
                            }}
                          />
                        ))}
                      </div>
                    </>
                  )}
                  {onAddTask && (
                    <div className="px-4 py-3">
                      <button
                        onClick={() => onAddTask(feature.id)}
                        className="pl-3 inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
                        title="Add task"
                      >
                        <Plus className="w-4 h-4" />
                        Add Task
                      </button>
                    </div>
                  )}
                </div>

                {/* Feature Comments Section */}
                <div className="px-6 py-3 border-t border-gray-200 bg-gray-50">
                  <button
                    onClick={() => toggleFeatureComments(feature.id)}
                    className="flex items-center gap-2 text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    {showFeatureComments.has(feature.id)
                      ? "Hide Comments"
                      : hasLoadedFeatureComments[feature.id]
                        ? `Show Comments (${featureComments[feature.id]?.length || 0})`
                        : "Show Comments (...)"}
                  </button>

                  {showFeatureComments.has(feature.id) && (
                    <div className="mt-3">
                      <CommentsSection
                        comments={featureComments[feature.id] || []}
                        onAddComment={(content) =>
                          handleAddFeatureComment(feature.id, content)
                        }
                        onUpdateComment={(commentId, content) =>
                          handleUpdateFeatureComment(
                            feature.id,
                            commentId,
                            content,
                          )
                        }
                        onDeleteComment={(commentId) =>
                          handleDeleteFeatureComment(feature.id, commentId)
                        }
                        currentUserId={user?.id}
                        isLoading={loadingFeatureComments[feature.id] || false}
                        canComment={Boolean(user)}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Feature Edit Modal */}
      <FeatureModal
        isOpen={isFeatureModalOpen}
        epicTitle={epic.title}
        initialData={editingFeature || undefined}
        titleText="Edit Feature"
        submitLabel="Update Feature"
        onClose={handleCloseFeatureModal}
        onSubmit={handleUpdateFeatureFromModal}
        onAddTask={onAddTask}
        onUpdateTask={onUpdateTask}
        onDeleteTask={onDeleteTask}
        onSelectTask={onSelectTask}
        isLoading={isFeatureLoading}
      />
    </div>
  );
};
