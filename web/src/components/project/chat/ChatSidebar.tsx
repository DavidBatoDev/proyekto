import { motion } from "framer-motion";
import { Hash, Lock, Plus, SquarePen } from "lucide-react";
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
  hasUnread?: boolean;
};

type ChannelEntry = {
  roomId: string;
  title: string;
  isPrivate: boolean;
  hasUnread: boolean;
};

export function ChatSidebar({
  show,
  dmEntries,
  members,
  currentUserId,
  channels,
  activeChannelRoomId,
  canCreateChannels,
  onCreateChannel,
  onSelectChannel,
  activeDmUserId,
  onTogglePeoplePicker,
  onSelectMember,
  showPeoplePicker,
  onCloseMobile,
}: {
  show: boolean;
  dmEntries: DmEntry[];
  members: ChatMemberCandidate[];
  currentUserId?: string;
  channels: ChannelEntry[];
  activeChannelRoomId: string | null;
  canCreateChannels: boolean;
  onCreateChannel: () => void;
  onSelectChannel: (roomId: string) => void;
  activeDmUserId: string | null;
  onTogglePeoplePicker: () => void;
  onSelectMember: (userId: string, roomId: string | null) => void;
  showPeoplePicker: boolean;
  onCloseMobile: () => void;
}) {
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  const dmList = useMemo(() => {
    if (showUnreadOnly) return dmEntries.filter((entry) => !!entry.hasUnread);
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
        } fixed left-0 top-0 z-40 h-full w-[320px] border-r border-slate-200 bg-slate-50 transition-transform duration-200 ease-out md:static md:translate-x-0`}
      >
        <div className="h-full overflow-y-auto">
          <div className="border-b border-slate-200 bg-white/70 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-[23px] font-semibold leading-none text-slate-900">
                Direct messages
              </h1>
              <button
                type="button"
                onClick={onTogglePeoplePicker}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200"
                aria-label="Compose message"
              >
                <SquarePen className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">Unread</span>
              <button
                type="button"
                role="switch"
                aria-checked={showUnreadOnly}
                onClick={() => setShowUnreadOnly((value) => !value)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  showUnreadOnly ? "bg-slate-900" : "bg-slate-300"
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
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              <Plus className="w-4 h-4" />
              New Message
            </button>
          </div>

          {showPeoplePicker && (
            <div className="px-4 pb-2">
              <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white">
                {members.map((member) => {
                  const label =
                    member.user?.display_name || member.user?.email || member.user_id;
                  return (
                    <button
                      key={member.user_id}
                      type="button"
                      onClick={() => onSelectMember(member.user_id, null)}
                      className="w-full border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50 last:border-b-0"
                    >
                      <p className="text-sm font-medium text-slate-900">{label}</p>
                      <p className="text-xs uppercase text-slate-500">{member.role}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="border-t border-slate-200/80 px-4 pb-5 pt-2">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Channels
              </p>
              {canCreateChannels && (
                <button
                  type="button"
                  onClick={onCreateChannel}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200"
                  aria-label="Create channel"
                  title="Create channel"
                >
                  <Plus className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="space-y-0.5">
              {channels.map((channel) => {
                const isActive = activeChannelRoomId === channel.roomId;
                const isUnread = !isActive && channel.hasUnread;
                return (
                  <button
                    key={channel.roomId}
                    type="button"
                    onClick={() => onSelectChannel(channel.roomId)}
                    className={`inline-flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                      isActive
                        ? "bg-slate-900 text-white"
                        : "text-slate-700 hover:bg-slate-200/80"
                    }`}
                  >
                    {channel.isPrivate ? (
                      <Lock className="h-4 w-4 shrink-0" />
                    ) : (
                      <Hash className="h-4 w-4 shrink-0" />
                    )}
                    <span
                      className={`truncate font-medium ${
                        isUnread ? "font-bold text-slate-900" : ""
                      }`}
                    >
                      {channel.title}
                    </span>
                    {isUnread ? (
                      <span className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full bg-slate-900" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="px-3 pb-4">
            <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Direct Messages
            </p>
            <div className="space-y-0.5">
              {dmList.map((entry) => {
                const label =
                  entry.member.user?.display_name ||
                  entry.member.user?.email ||
                  entry.member.user_id;
                const isActive = activeDmUserId === entry.member.user_id;
                const isUnread = !isActive && !!entry.hasUnread;
                const shouldPrefixYou =
                  !!entry.lastSenderId &&
                  !!currentUserId &&
                  entry.lastSenderId === currentUserId &&
                  entry.preview !== "Start a conversation";
                const previewText = shouldPrefixYou
                  ? `You: ${entry.preview}`
                  : entry.preview;
                return (
                  <motion.button
                    layout
                    key={entry.member.user_id}
                    type="button"
                    onClick={() => onSelectMember(entry.member.user_id, entry.roomId)}
                    className={`w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
                      isActive
                        ? "bg-slate-900 text-white"
                        : "text-slate-800 hover:bg-slate-200/70"
                    }`}
                  >
                    <div className="flex gap-2 items-start">
                      <ChatAvatar name={label} avatarUrl={entry.avatarUrl} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p
                            className={`text-[15px] truncate ${
                              isUnread
                                ? isActive
                                  ? "font-bold text-white"
                                  : "font-bold text-slate-900"
                                : "font-semibold"
                            }`}
                          >
                            {label}
                          </p>
                          <span
                            className={`text-[12px] shrink-0 ${
                              isUnread
                                ? isActive
                                  ? "font-semibold text-white/80"
                                  : "font-semibold text-slate-700"
                                : isActive
                                  ? "text-white/70"
                                  : "text-slate-500"
                            }`}
                          >
                            {formatRowTime(entry.lastAt)}
                          </span>
                        </div>
                        <p
                          className={`text-[14px] truncate mt-0.5 ${
                            isUnread
                              ? isActive
                                ? "font-semibold text-white/90"
                                : "font-semibold text-slate-700"
                              : isActive
                                ? "text-white/70"
                                : "text-slate-500"
                          }`}
                        >
                          {previewText}
                        </p>
                      </div>
                      <span className="h-5 w-5 shrink-0 inline-flex items-center justify-center" aria-hidden="true">
                        {isUnread ? (
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${isActive ? "bg-white" : "bg-slate-900"}`}
                          />
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
