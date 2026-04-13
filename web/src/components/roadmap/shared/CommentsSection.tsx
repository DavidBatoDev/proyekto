import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Comment } from "@/types/roadmap";
import { formatDistanceToNow } from "date-fns";
import { RichTextEditor } from "@/components/common/RichTextEditor";
import { cleanHTML } from "@/components/common/RichTextEditor/utils/formatting";

interface CommentsSectionProps {
  comments: Comment[];
  onAddComment: (content: string) => Promise<void>;
  onUpdateComment?: (commentId: string, content: string) => Promise<void>;
  onDeleteComment?: (commentId: string) => Promise<void>;
  currentUserId?: string;
  canComment: boolean;
  disabledMessage?: string;
  isLoading?: boolean;
  emptyMessage?: string;
}

export const CommentsSection = ({
  comments,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
  currentUserId,
  canComment,
  disabledMessage = "You need commenter or editor access to add comments",
  isLoading = false,
  emptyMessage = "No comments yet. Be the first to comment!",
}: CommentsSectionProps) => {
  const [commentInput, setCommentInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [isPreparingComposer, setIsPreparingComposer] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [preparingEditCommentId, setPreparingEditCommentId] = useState<
    string | null
  >(null);
  const [isMutatingCommentId, setIsMutatingCommentId] = useState<string | null>(
    null,
  );

  const sanitizeCommentHtml = (rawHtml: string) => {
    const cleaned = cleanHTML(rawHtml);
    return cleaned
      .replace(/javascript\s*:/gi, "")
      .replace(/<a\b([^>]*)>/gi, (match) => {
        if (/target=/i.test(match)) return match;
        return match.replace(
          ">",
          ' target="_blank" rel="noopener noreferrer">',
        );
      });
  };

  const hasMeaningfulContent = (html: string) => {
    const stripped = html
      .replace(/<br\s*\/?>/gi, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/<[^>]+>/g, "")
      .trim();
    return stripped.length > 0;
  };

  const canSubmitNewComment = useMemo(
    () => hasMeaningfulContent(commentInput) && !isSubmitting,
    [commentInput, isSubmitting],
  );

  const openComposer = () => {
    if (isPreparingComposer) return;
    setIsPreparingComposer(true);
    setTimeout(() => {
      setIsComposerOpen(true);
      setIsPreparingComposer(false);
    }, 120);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!hasMeaningfulContent(commentInput) || isSubmitting) return;

    try {
      setIsSubmitting(true);
      await onAddComment(sanitizeCommentHtml(commentInput));
      setCommentInput("");
      setIsComposerOpen(false);
    } catch (error) {
      console.error("Failed to add comment:", error);
      alert("Failed to add comment. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const canManageComment = (comment: Comment) => {
    if (!currentUserId) return false;
    return (
      comment.user_id === currentUserId ||
      comment.author_id === currentUserId ||
      comment.user?.id === currentUserId
    );
  };

  const handleStartEdit = (comment: Comment) => {
    if (preparingEditCommentId || editingCommentId === comment.id) return;
    setPreparingEditCommentId(comment.id);
    setTimeout(() => {
      setEditingCommentId(comment.id);
      setEditingContent(comment.content);
      setPreparingEditCommentId(null);
    }, 120);
  };

  const handleCancelEdit = () => {
    setEditingCommentId(null);
    setEditingContent("");
  };

  const handleSaveEdit = async () => {
    if (
      !editingCommentId ||
      !onUpdateComment ||
      !hasMeaningfulContent(editingContent)
    )
      return;

    try {
      setIsMutatingCommentId(editingCommentId);
      await onUpdateComment(
        editingCommentId,
        sanitizeCommentHtml(editingContent),
      );
      handleCancelEdit();
    } catch (error) {
      console.error("Failed to update comment:", error);
      alert("Failed to update comment. Please try again.");
    } finally {
      setIsMutatingCommentId(null);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (!onDeleteComment) return;
    const confirmed = window.confirm("Delete this comment?");
    if (!confirmed) return;

    try {
      setIsMutatingCommentId(commentId);
      await onDeleteComment(commentId);
      if (editingCommentId === commentId) handleCancelEdit();
    } catch (error) {
      console.error("Failed to delete comment:", error);
      alert("Failed to delete comment. Please try again.");
    } finally {
      setIsMutatingCommentId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Comment Compose */}
      {canComment && (
        <div className="space-y-2">
          {!isComposerOpen && !isPreparingComposer ? (
            <button
              type="button"
              onClick={openComposer}
              className="w-full text-left px-3 py-2.5 text-sm text-gray-500 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Write a comment...
            </button>
          ) : isPreparingComposer ? (
            <div className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm text-gray-500 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
              Opening editor...
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-2">
              <RichTextEditor
                value={commentInput}
                onChange={setCommentInput}
                placeholder="Write a comment..."
                minHeight="96px"
                maxHeight="240px"
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
                disabled={isSubmitting}
                autoFocus
              />

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={!canSubmitNewComment}
                  className="px-3 py-1.5 text-sm font-medium bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                >
                  {isSubmitting && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  {isSubmitting ? "Posting..." : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsComposerOpen(false);
                    setCommentInput("");
                  }}
                  disabled={isSubmitting}
                  className="px-3 py-1.5 text-sm font-medium bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {!canComment && (
        <div className="text-center py-4 bg-gray-50 border border-gray-200 rounded-md">
          <p className="text-sm text-gray-500">{disabledMessage}</p>
        </div>
      )}

      {/* Comments List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : comments.length === 0 ? (
        <div className="text-center py-8 text-sm text-gray-500">
          {emptyMessage}
        </div>
      ) : (
        <div className="space-y-3">
          {comments.map((comment) => {
            const displayName =
              comment.user?.display_name ||
              [comment.user?.first_name, comment.user?.last_name]
                .filter(Boolean)
                .join(" ") ||
              "Unknown User";

            const timeAgo = formatDistanceToNow(new Date(comment.created_at), {
              addSuffix: true,
            });

            return (
              <div key={comment.id} className="flex gap-3">
                {/* Avatar */}
                {comment.user?.avatar_url ? (
                  <img
                    src={comment.user.avatar_url}
                    alt={displayName}
                    className="w-8 h-8 rounded-full shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-sm font-medium text-primary">
                      {displayName[0].toUpperCase()}
                    </span>
                  </div>
                )}

                {/* Comment Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-sm font-medium text-gray-900">
                      {displayName}
                    </span>
                    <span className="text-xs text-blue-600 underline underline-offset-2">
                      {timeAgo}
                    </span>
                    {comment.edited_at && (
                      <span className="text-xs text-gray-400">(edited)</span>
                    )}
                  </div>

                  {editingCommentId === comment.id ? (
                    <div className="space-y-2 border border-gray-300 rounded-xl p-3 bg-white">
                      <RichTextEditor
                        value={editingContent}
                        onChange={setEditingContent}
                        minHeight="96px"
                        maxHeight="240px"
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
                        disabled={isMutatingCommentId === comment.id}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleSaveEdit}
                          disabled={
                            !hasMeaningfulContent(editingContent) ||
                            isMutatingCommentId === comment.id
                          }
                          className="px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-md disabled:opacity-50 inline-flex items-center gap-1.5"
                        >
                          {isMutatingCommentId === comment.id && (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          )}
                          {isMutatingCommentId === comment.id
                            ? "Saving..."
                            : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          disabled={isMutatingCommentId === comment.id}
                          className="px-3 py-1.5 text-xs font-medium border border-gray-300 text-gray-600 rounded-md"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : preparingEditCommentId === comment.id ? (
                    <div className="rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-500 flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                      Opening editor...
                    </div>
                  ) : (
                    <>
                      <div className="border border-gray-300 rounded-xl bg-white px-4 py-3">
                        <div
                          className="text-sm text-gray-700 max-w-none wrap-break-word [&_p]:my-0 [&_a]:text-blue-600 [&_a]:underline [&_strong]:font-semibold [&_b]:font-semibold [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1"
                          dangerouslySetInnerHTML={{
                            __html: sanitizeCommentHtml(comment.content),
                          }}
                        />
                      </div>

                      {canManageComment(comment) &&
                        (onUpdateComment || onDeleteComment) && (
                          <div className="mt-2 flex items-center gap-2 text-xs">
                            <span className="text-gray-400">•</span>
                            {onUpdateComment && (
                              <button
                                type="button"
                                onClick={() => handleStartEdit(comment)}
                                disabled={isMutatingCommentId === comment.id}
                                className="text-blue-700 underline underline-offset-2 disabled:opacity-50"
                              >
                                Edit
                              </button>
                            )}
                            <span className="text-gray-400">•</span>
                            {onDeleteComment && (
                              <button
                                type="button"
                                onClick={() => handleDelete(comment.id)}
                                disabled={isMutatingCommentId === comment.id}
                                className="text-blue-700 underline underline-offset-2 disabled:opacity-50"
                              >
                                {isMutatingCommentId === comment.id
                                  ? "Deleting..."
                                  : "Delete"}
                              </button>
                            )}
                          </div>
                        )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
