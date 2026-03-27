import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import type { ThreadUiMessage } from "./thread";

export function ThreadMessageLine({
  message,
  canUnsend,
  onToggleReaction,
  onRequestUnsend,
}: {
  message: ThreadUiMessage;
  canUnsend?: boolean;
  onToggleReaction?: (messageId: string, roomId: string, emoji: string) => void;
  onRequestUnsend?: (message: ThreadUiMessage, bypassConfirm: boolean) => void;
}) {
  return (
    <div className="group/line relative">
      <p className="text-[15px] leading-relaxed text-gray-900 whitespace-pre-wrap break-words">
        {message.content}
      </p>

      {canUnsend && !message.optimisticStatus && (
        <button
          type="button"
          onClick={(event) => onRequestUnsend?.(message, event.shiftKey)}
          className="absolute -right-1 -top-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 opacity-0 transition-opacity hover:bg-gray-200 hover:text-red-600 group-hover/line:opacity-100"
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
                  ? "border-orange-300 bg-orange-100 text-orange-700"
                  : "border-gray-300 bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              <span>{reaction.emoji}</span>
              <span>{reaction.count}</span>
            </motion.button>
          ))}
        </div>
      )}

      {message.optimisticStatus === "sending" && (
        <p className="text-[11px] text-orange-500 mt-0.5">Sending...</p>
      )}
      {message.optimisticStatus === "failed" && (
        <p className="text-[11px] text-red-500 mt-0.5">Failed to send</p>
      )}
    </div>
  );
}
