import { motion } from "framer-motion";
import { PanelRightClose, PanelRightOpen, X } from "lucide-react";
import {
  ChatMemberProfileCard,
  type ChatMemberProfilePreview,
} from "./ChatMemberProfileCard";
import { ChatAvatar } from "./Avatar";

export function ChatProfilePanel({
  member,
  isOpen,
  mode,
  projectMembers = [],
  onToggle,
  onClose,
}: {
  member: ChatMemberProfilePreview | null;
  isOpen: boolean;
  mode: "channel" | "dm";
  projectMembers?: ChatMemberProfilePreview[];
  onToggle: () => void;
  onClose: () => void;
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 px-3 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Member Details
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onToggle}
              className="hidden h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 xl:inline-flex"
              aria-label={isOpen ? "Collapse member panel" : "Expand member panel"}
            >
              {isOpen ? (
                <PanelRightClose className="w-4 h-4" />
              ) : (
                <PanelRightOpen className="w-4 h-4" />
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 xl:hidden"
              aria-label="Close member panel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="flex-1 min-h-0 overflow-y-auto"
      >
        {mode === "channel" ? (
          <div className="px-3 pt-3 pb-2">
            <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Project Members
            </p>
            <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5">
              {projectMembers.map((projectMember) => {
                return (
                  <div
                    key={projectMember.userId}
                    className="w-full rounded-lg px-2 py-2 text-left text-slate-800"
                  >
                    <div className="flex items-center gap-2">
                      <ChatAvatar
                        name={projectMember.name}
                        avatarUrl={projectMember.avatarUrl}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{projectMember.name}</p>
                        <p className="truncate text-xs text-slate-500">
                          {projectMember.positionLabel}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <ChatMemberProfileCard member={member} />
        )}
      </motion.div>
    </div>
  );
}
