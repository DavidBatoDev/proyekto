import { motion } from "framer-motion";
import { ChatAvatar } from "./Avatar";
import { ThreadMessageLine } from "./ThreadMessageLine";
import type { ThreadMessageGroup as Group } from "./thread";

export function ThreadMessageGroup({
  group,
  isSelected = false,
  onSelectSender,
}: {
  group: Group;
  isSelected?: boolean;
  onSelectSender?: (userId: string) => void;
}) {
  const canSelect = typeof onSelectSender === "function";
  const startedAt = new Date(group.startedAt).toLocaleString([], {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className={`group -mx-3 px-3 py-2 rounded-md mb-1 transition-colors ${
        isSelected ? "bg-orange-100/70" : "hover:bg-gray-200/35"
      }`}
    >
      <div className="flex items-start gap-3">
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
          <div className="mt-1 space-y-1">
            {group.messages.map((message) => (
              <ThreadMessageLine key={message.id} message={message} />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
