import EmojiPicker, { Theme, type EmojiClickData } from "emoji-picker-react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ChatAvatar } from "./Avatar";
import { ThreadMessageLine } from "./ThreadMessageLine";
import type { ThreadMessageGroup as Group, ThreadUiMessage } from "./thread";

const QUICK_REACTIONS = ["👍", "❤️", "😄", "😢", "🙏", "👎", "😡"];

export function ThreadMessageGroup({
  group,
  isSelected = false,
  currentUserId,
  onSelectSender,
  onToggleReaction,
  onRequestUnsend,
}: {
  group: Group;
  isSelected?: boolean;
  currentUserId?: string;
  onSelectSender?: (userId: string) => void;
  onToggleReaction?: (messageId: string, roomId: string, emoji: string) => void;
  onRequestUnsend?: (message: ThreadUiMessage, bypassConfirm: boolean) => void;
}) {
  const canSelect = typeof onSelectSender === "function";
  const targetMessage = group.messages[group.messages.length - 1] ?? null;
  const [showPicker, setShowPicker] = useState(false);
  const [burstEmoji, setBurstEmoji] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const startedAt = new Date(group.startedAt).toLocaleString([], {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!showPicker) return;
      const target = event.target as Node | null;
      if (!target) return;
      if (pickerRef.current?.contains(target)) return;
      setShowPicker(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowPicker(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showPicker]);

  const reactWith = (emoji: string) => {
    if (!targetMessage || !onToggleReaction) return;
    onToggleReaction(targetMessage.id, targetMessage.room_id, emoji);
    setBurstEmoji(emoji);
    window.setTimeout(() => setBurstEmoji(null), 420);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className={`group relative -mx-3 px-3 py-2 rounded-md mb-1 min-w-0 transition-colors ${
        isSelected ? "bg-orange-100/70" : "hover:bg-gray-200/35"
      }`}
    >
      {targetMessage && onToggleReaction && (
        <div
          ref={pickerRef}
          className={`absolute right-2 -top-4 z-10 transition-all duration-150 ${
            showPicker
              ? "opacity-100 translate-y-0 pointer-events-auto"
              : "opacity-0 translate-y-1 pointer-events-none group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:translate-y-0 group-focus-within:pointer-events-auto"
          }`}
        >
          <div className="inline-flex items-center gap-0.5 rounded-full border border-gray-200 bg-white px-1.5 py-1 shadow-sm">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={`${targetMessage.id}-${emoji}`}
                type="button"
                onClick={() => reactWith(emoji)}
                className="h-7 w-7 inline-flex items-center justify-center rounded-full text-base hover:bg-gray-100"
                aria-label={`React with ${emoji}`}
              >
                {emoji}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowPicker((current) => !current)}
              className="h-7 w-7 inline-flex items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
              aria-label="Open emoji picker"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {showPicker && (
            <div className="absolute z-20 right-0 top-10 rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden">
              <EmojiPicker
                width={300}
                height={340}
                skinTonesDisabled
                theme={Theme.LIGHT}
                onEmojiClick={(emojiData: EmojiClickData) => {
                  reactWith(emojiData.emoji);
                  setShowPicker(false);
                }}
              />
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {burstEmoji && (
          <motion.div
            key={`burst-${burstEmoji}`}
            initial={{ opacity: 0, y: 6, scale: 0.8 }}
            animate={{ opacity: 1, y: -8, scale: 1.2 }}
            exit={{ opacity: 0, y: -18, scale: 1.35 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="absolute right-14 -top-2 pointer-events-none text-xl"
          >
            {burstEmoji}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-start gap-3 min-w-0">
        <div
          className={canSelect ? "shrink-0 rounded-full" : "shrink-0"}
          onClick={canSelect ? () => onSelectSender?.(group.senderId) : undefined}
          role={canSelect ? "button" : undefined}
          tabIndex={canSelect ? 0 : undefined}
          onKeyDown={
            canSelect
              ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectSender?.(group.senderId);
                  }
                }
              : undefined
          }
          aria-label={canSelect ? `View ${group.sender.name} profile` : undefined}
        >
          <ChatAvatar name={group.sender.name} avatarUrl={group.sender.avatarUrl} size="lg" />
        </div>
        <div className="min-w-0 flex-1">
          <div
            onClick={canSelect ? () => onSelectSender?.(group.senderId) : undefined}
            role={canSelect ? "button" : undefined}
            tabIndex={canSelect ? 0 : undefined}
            onKeyDown={
              canSelect
                ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectSender?.(group.senderId);
                    }
                  }
                : undefined
            }
            className={`flex items-baseline gap-2 rounded-md px-1 -ml-1 ${
              canSelect ? "hover:bg-gray-200/45 cursor-pointer" : ""
            }`}
          >
            <span className="text-[17px] font-semibold text-gray-900 text-left">
              {group.sender.name}
            </span>
            <span className="text-[12px] text-gray-500">{startedAt}</span>
          </div>
          <div className="mt-1 space-y-1 min-w-0">
            {group.messages.map((message) => (
              <ThreadMessageLine
                key={message.id}
                message={message}
                canUnsend={message.sender_id === currentUserId}
                onToggleReaction={onToggleReaction}
                onRequestUnsend={onRequestUnsend}
              />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
