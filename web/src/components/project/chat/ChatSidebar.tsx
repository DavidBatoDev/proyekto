import { motion } from "framer-motion";
import { Hash, Plus, SquarePen } from "lucide-react";
import { useMemo, useState } from "react";
import type { ChatMemberCandidate } from "@/services/chat.service";
import { ChatAvatar } from "./Avatar";

type DmEntry = {
  member: ChatMemberCandidate;
  roomId: string | null;
  preview: string;
  avatarUrl?: string | null;
  lastAt?: string;
  lastSenderId?: string;
};

export function ChatSidebar({
  show,
  dmEntries,
  members,
  currentUserId,
  activeDmUserId,
  activeChannel,
  onTogglePeoplePicker,
  onSelectMember,
  onSelectGeneral,
  showPeoplePicker,
  onCloseMobile,
}: {
  show: boolean;
  dmEntries: DmEntry[];
  members: ChatMemberCandidate[];
  currentUserId?: string;
  activeDmUserId: string | null;
  activeChannel: boolean;
  onTogglePeoplePicker: () => void;
  onSelectMember: (userId: string, roomId: string | null) => void;
  onSelectGeneral: () => void;
  showPeoplePicker: boolean;
  onCloseMobile: () => void;
}) {
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  const dmList = useMemo(() => {
    // v1: visual-only unread toggle. No filtering yet until unread state exists.
    if (showUnreadOnly) return dmEntries;
    return dmEntries;
  }, [dmEntries, showUnreadOnly]);

  const formatRowTime = (iso?: string) => {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfRow = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayDiff = Math.round(
      (startOfToday.getTime() - startOfRow.getTime()) / (24 * 60 * 60 * 1000),
    );

    if (dayDiff === 0) {
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    if (dayDiff === 1) return "Yesterday";
    if (dayDiff > 1 && dayDiff < 7) {
      return date.toLocaleDateString([], { weekday: "long" });
    }
    return date.toLocaleDateString([], { month: "numeric", day: "numeric", year: "2-digit" });
  };

  return (
    <>
      {show && (
        <button
          type="button"
          className="fixed inset-0 bg-black/30 z-30 md:hidden"
          onClick={onCloseMobile}
          aria-label="Close conversations"
        />
      )}

      <aside
        className={`${
          show ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0 fixed md:static z-40 top-0 left-0 h-full w-[320px] border-r border-gray-200 bg-[#f8f8f9] transition-transform duration-200 ease-out`}
      >
        <div className="h-full overflow-y-auto">
          <div className="px-4 py-3 border-b border-gray-200 bg-[#f8f8f9]">
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-[23px] leading-none font-semibold text-gray-900">
                Direct messages
              </h1>
              <button
                type="button"
                onClick={onTogglePeoplePicker}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-200/70"
                aria-label="Compose message"
              >
                <SquarePen className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500">Unread</span>
              <button
                type="button"
                role="switch"
                aria-checked={showUnreadOnly}
                onClick={() => setShowUnreadOnly((value) => !value)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  showUnreadOnly ? "bg-[#ff9933]" : "bg-gray-300"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    showUnreadOnly ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="p-4">
            <button
              type="button"
              onClick={onTogglePeoplePicker}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Plus className="w-4 h-4" />
              New Message
            </button>
          </div>

          {showPeoplePicker && (
            <div className="px-4 pb-2">
              <div className="rounded-xl border border-gray-200 bg-white max-h-56 overflow-y-auto">
                {members.map((member) => {
                  const label =
                    member.user?.display_name || member.user?.email || member.user_id;
                  return (
                    <button
                      key={member.user_id}
                      type="button"
                      onClick={() => onSelectMember(member.user_id, null)}
                      className="w-full px-3 py-2 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                    >
                      <p className="text-sm font-medium text-gray-900">{label}</p>
                      <p className="text-xs text-gray-500 uppercase">{member.role}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="px-4 pt-2 pb-5 border-t border-gray-200/80">
            <p className="text-xs uppercase tracking-wide text-gray-400 font-semibold mb-2">
              Channels
            </p>
            <button
              type="button"
              onClick={onSelectGeneral}
              className={`w-full rounded-lg px-3 py-2 text-left inline-flex items-center gap-2 transition-colors ${
                activeChannel
                  ? "bg-orange-100/80 text-gray-900"
                  : "text-gray-700 hover:bg-gray-200/70"
              }`}
            >
              <Hash className="w-4 h-4" />
              <span className="font-medium">general</span>
            </button>
          </div>

          <div className="px-3 pb-4">
            <p className="px-1 text-xs uppercase tracking-wide text-gray-400 font-semibold mb-1.5">
              Direct Messages
            </p>
            <div className="space-y-0.5">
              {dmList.map((entry) => {
                const label =
                  entry.member.user?.display_name ||
                  entry.member.user?.email ||
                  entry.member.user_id;
                const isActive = activeDmUserId === entry.member.user_id;
                const isUnread =
                  !isActive &&
                  !!entry.roomId &&
                  !!entry.lastSenderId &&
                  !!currentUserId &&
                  entry.lastSenderId !== currentUserId;
                return (
                  <motion.button
                    layout
                    key={entry.member.user_id}
                    type="button"
                    onClick={() => onSelectMember(entry.member.user_id, entry.roomId)}
                    className={`w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
                      isActive
                        ? "bg-orange-100/80 text-gray-900"
                        : "text-gray-800 hover:bg-gray-200/70"
                    }`}
                  >
                    <div className="flex gap-2 items-start">
                      <ChatAvatar name={label} avatarUrl={entry.avatarUrl} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p
                            className={`text-[15px] truncate ${
                              isUnread ? "font-bold text-gray-900" : "font-semibold"
                            }`}
                          >
                            {label}
                          </p>
                          <span
                            className={`text-[12px] shrink-0 ${
                              isUnread ? "font-semibold text-gray-700" : "text-gray-500"
                            }`}
                          >
                            {formatRowTime(entry.lastAt)}
                          </span>
                        </div>
                        <p
                          className={`text-[14px] truncate mt-0.5 ${
                            isUnread ? "font-semibold text-gray-700" : "text-gray-500"
                          }`}
                        >
                          {entry.preview}
                        </p>
                      </div>
                      <span className="h-5 w-5 shrink-0 inline-flex items-center justify-center" aria-hidden="true">
                        {isUnread ? (
                          <span className="h-2.5 w-2.5 rounded-full bg-[#ff9933]" />
                        ) : null}
                      </span>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
