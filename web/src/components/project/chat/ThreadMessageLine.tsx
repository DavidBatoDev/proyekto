import { motion } from "framer-motion";
import { Download, FileText, Trash2 } from "lucide-react";
import type { ChatAttachment } from "@/services/chat.service";
import { resolveAttachmentSrc } from "./attachmentPreviewCache";
import { mentionsCurrentUser, renderMentionContent } from "./mentions";
import type { ThreadUiMessage } from "./thread";

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

function AttachmentBlock({ attachment }: { attachment: ChatAttachment }) {
  const isImage = attachment.content_type.startsWith("image/");

  if (isImage) {
    // Render just-sent images from their local blob (already decoded) so the
    // optimistic→CDN swap doesn't reload the <img> and flash blank.
    const displaySrc = resolveAttachmentSrc(attachment.url);
    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block w-fit"
      >
        <img
          src={displaySrc}
          alt={attachment.name}
          loading="lazy"
          className="max-h-80 max-w-xs rounded-lg border border-slate-200 object-cover transition-opacity hover:opacity-95"
        />
      </a>
    );
  }

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      download={attachment.name}
      className="flex w-fit max-w-xs items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 transition-colors hover:bg-slate-100"
    >
      <FileText className="h-8 w-8 shrink-0 text-slate-500" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-800">
          {attachment.name}
        </p>
        <p className="text-xs text-slate-500">{formatBytes(attachment.size)}</p>
      </div>
      <Download className="h-4 w-4 shrink-0 text-slate-400" />
    </a>
  );
}

export function ThreadMessageLine({
  message,
  canUnsend,
  isHighlighted,
  currentUserId,
  onToggleReaction,
  onRequestUnsend,
}: {
  message: ThreadUiMessage;
  canUnsend?: boolean;
  isHighlighted?: boolean;
  currentUserId?: string;
  onToggleReaction?: (messageId: string, roomId: string, emoji: string) => void;
  onRequestUnsend?: (message: ThreadUiMessage, bypassConfirm: boolean) => void;
}) {
  const isSending = message.optimisticStatus === "sending";
  const hasText = message.content.trim().length > 0;
  const attachments = message.attachments ?? [];
  // Highlight the line when the viewer is pinged (directly or via @everyone),
  // but not for their own messages — mirrors Discord.
  const pingsViewer =
    message.sender_id !== currentUserId &&
    mentionsCurrentUser(message.mentions, currentUserId);
  return (
    <div
      data-message-id={message.id}
      className={`group/line relative min-w-0 overflow-hidden rounded-md transition-colors ${
        isSending ? "opacity-70" : ""
      } ${
        isHighlighted
          ? "bg-amber-100 ring-2 ring-inset ring-amber-300"
          : pingsViewer
            ? "bg-violet-50"
            : ""
      }`}
    >
      {hasText && (
        <p className="text-[15px] leading-relaxed text-slate-900 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {renderMentionContent(message.content, message.mentions, {
            currentUserId,
          })}
        </p>
      )}

      {attachments.length > 0 && (
        <div className={`flex flex-col gap-2 ${hasText ? "mt-1.5" : ""}`}>
          {attachments.map((attachment, index) => (
            <AttachmentBlock
              key={`${message.id}-att-${index}`}
              attachment={attachment}
            />
          ))}
        </div>
      )}

      {canUnsend && !message.optimisticStatus && (
        <button
          type="button"
          onClick={(event) => onRequestUnsend?.(message, event.shiftKey)}
          className="absolute -right-1 -top-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 opacity-0 transition-opacity hover:bg-slate-200 hover:text-red-600 group-hover/line:opacity-100"
          aria-label="Unsend message"
          title="Unsend message"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}

      {message.reactions && message.reactions.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {message.reactions.map((reaction, index) => (
            <motion.button
              key={`${message.id}-${reaction.emoji}`}
              type="button"
              initial={{ opacity: 0, y: 6, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.18, ease: "easeOut", delay: index * 0.02 }}
              onClick={() =>
                onToggleReaction?.(message.id, message.room_id, reaction.emoji)
              }
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                reaction.reacted_by_me
                  ? "border-slate-400 bg-slate-200 text-slate-800"
                  : "border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              <span>{reaction.emoji}</span>
              <span>{reaction.count}</span>
            </motion.button>
          ))}
        </div>
      )}

      {message.optimisticStatus === "failed" && (
        <p className="text-[11px] text-red-500 mt-0.5">Failed to send</p>
      )}
    </div>
  );
}
