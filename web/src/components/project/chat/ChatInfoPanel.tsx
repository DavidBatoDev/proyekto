import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Download,
  ExternalLink,
  FileText,
  Hash,
  Loader2,
  Lock,
  LogOut,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  Settings,
  X,
} from "lucide-react";
import type { ChatMemberCandidate, ChatRoom } from "@/services/chat.service";
import {
  useChannelMembersQuery,
  useLeaveChannelMutation,
  useRemoveChannelMemberMutation,
  useRoomLibraryQuery,
  useRoomMessageSearchQuery,
} from "@/hooks/useChatQueries";
import { ChatAvatar } from "./Avatar";
import { AddChannelMembersModal } from "./AddChannelMembersModal";
import { ChannelSettingsModal } from "./ChannelSettingsModal";
import { ChatInfoSection } from "./ChatInfoSection";
import { resolveAttachmentSrc } from "./attachmentPreviewCache";
import type { ChatMemberProfilePreview } from "./ChatMemberProfileCard";

const DEFAULT_CHANNEL_SLUGS = new Set(["general"]);

type LibraryTab = "media" | "files" | "links";

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes < 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

/** A member row in the DM "Chat members" list (counterpart + self). */
function DmMemberRow({
  name,
  sub,
  avatarUrl,
}: {
  name: string;
  sub?: string;
  avatarUrl: string | null;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-2">
      <ChatAvatar name={name} avatarUrl={avatarUrl} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-800">{name}</p>
        {sub && <p className="truncate text-xs text-slate-500">{sub}</p>}
      </div>
    </div>
  );
}

/** Highlight the first case-insensitive occurrence of `query` in `text`. */
function highlightMatch(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-amber-200 text-slate-900">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

export function ChatInfoPanel({
  mode,
  roomId,
  room,
  projectId,
  members,
  currentUserId,
  currentUser,
  canManage,
  dmMember,
  isOpen,
  onToggle,
  onClose,
  onExitChannel,
  onJumpToMessage,
}: {
  mode: "channel" | "dm";
  roomId: string | null;
  room: ChatRoom | null;
  projectId: string;
  members: ChatMemberCandidate[];
  currentUserId?: string;
  currentUser: { name: string; avatarUrl: string | null; positionLabel: string } | null;
  canManage: boolean;
  dmMember: ChatMemberProfilePreview | null;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onExitChannel: () => void;
  onJumpToMessage: (messageId: string) => void;
}) {
  const isChannel = mode === "channel";

  const channelMembersQuery = useChannelMembersQuery(
    projectId,
    isChannel ? room?.id ?? null : null,
    isOpen && isChannel,
  );
  const removeMember = useRemoveChannelMemberMutation(projectId);
  const leaveChannel = useLeaveChannelMutation(projectId);

  const libraryQuery = useRoomLibraryQuery(roomId ?? "", isOpen && Boolean(roomId));

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("media");

  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchInput.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);
  // Reset the search when switching conversations.
  useEffect(() => {
    setSearchInput("");
    setDebouncedQuery("");
  }, [roomId]);

  const searchQuery = useRoomMessageSearchQuery(
    roomId ?? "",
    debouncedQuery,
    isOpen && Boolean(roomId),
  );
  const isSearching = debouncedQuery.trim().length >= 2;

  const channelMembers = channelMembersQuery.data ?? [];
  const currentMemberIds = useMemo(
    () => new Set(channelMembers.map((m) => m.user_id)),
    [channelMembers],
  );
  const addableMembers = useMemo(
    () => members.filter((m) => !currentMemberIds.has(m.user_id)),
    [members, currentMemberIds],
  );

  const senderLookup = useMemo(() => {
    const map = new Map<string, { name: string; avatarUrl: string | null }>();
    for (const m of members) {
      map.set(m.user_id, {
        name: m.user?.display_name || m.user?.email || m.user_id,
        avatarUrl: m.user?.avatar_url ?? null,
      });
    }
    for (const m of channelMembers) {
      if (!map.has(m.user_id)) {
        map.set(m.user_id, {
          name: m.user?.display_name || m.user?.email || m.user_id,
          avatarUrl: m.user?.avatar_url ?? null,
        });
      }
    }
    if (dmMember) {
      map.set(dmMember.userId, {
        name: dmMember.name,
        avatarUrl: dmMember.avatarUrl ?? null,
      });
    }
    return map;
  }, [members, channelMembers, dmMember]);

  const senderInfo = (id: string) =>
    id === currentUserId
      ? { name: "You", avatarUrl: null }
      : senderLookup.get(id) ?? { name: "Member", avatarUrl: null };

  const isDefault = !!room && DEFAULT_CHANNEL_SLUGS.has(room.slug);
  const isPrivate = !!room?.is_private;
  const channelName = room?.name || room?.slug || "Channel";
  const isBusy = leaveChannel.isPending || removeMember.isPending;
  const canLeave =
    isPrivate && !!currentUserId && currentMemberIds.has(currentUserId);

  const title = isChannel ? channelName : dmMember?.name ?? "Conversation";
  const subtitle = isChannel
    ? `${isPrivate ? "Private channel" : "Channel"} · ${channelMembers.length} member${
        channelMembers.length === 1 ? "" : "s"
      }`
    : dmMember?.roleLabel ?? "Direct message";

  const library = libraryQuery.data;
  const results = searchQuery.data?.results ?? [];

  return (
    <div className="flex h-full flex-col">
      {/* Chrome */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-200 bg-white/90 px-3 py-3 backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Details
        </p>
        <div className="flex items-center gap-1">
          {isChannel && canManage && (
            <button
              type="button"
              onClick={() => setShowSettingsModal(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100"
              aria-label="Channel settings"
            >
              <Settings className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onToggle}
            className="hidden h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 xl:inline-flex"
            aria-label={isOpen ? "Collapse panel" : "Expand panel"}
          >
            {isOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 xl:hidden"
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Identity */}
        <div className="flex flex-col items-center gap-2 px-4 pt-5 pb-4 text-center">
          {isChannel ? (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-600">
              {isPrivate ? <Lock className="h-7 w-7" /> : <Hash className="h-8 w-8" />}
            </div>
          ) : (
            <ChatAvatar name={title} avatarUrl={dmMember?.avatarUrl} size="lg" />
          )}
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-slate-900">{title}</p>
            <p className="truncate text-xs text-slate-500">{subtitle}</p>
          </div>
        </div>

        {/* Search */}
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search in conversation"
              disabled={!roomId}
              className="w-full rounded-full border border-slate-200 bg-slate-50 py-2 pl-9 pr-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-300 focus:bg-white focus:outline-none disabled:opacity-60"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {isSearching ? (
          <div className="px-3 pb-4">
            {searchQuery.isFetching && results.length === 0 ? (
              <div className="flex items-center justify-center py-6 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : results.length === 0 ? (
              <p className="px-1 py-4 text-center text-sm text-slate-400">
                No messages found.
              </p>
            ) : (
              <ul className="space-y-1">
                {results.map((message) => {
                  const sender = senderInfo(message.sender_id);
                  return (
                    <li key={message.id}>
                      <button
                        type="button"
                        onClick={() => onJumpToMessage(message.id)}
                        className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-slate-100"
                      >
                        <ChatAvatar
                          name={sender.name}
                          avatarUrl={sender.avatarUrl}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-xs font-medium text-slate-700">
                              {sender.name}
                            </span>
                            <span className="shrink-0 text-[11px] text-slate-400">
                              {formatDate(message.created_at)}
                            </span>
                          </div>
                          <p className="line-clamp-2 text-sm text-slate-600">
                            {message.content
                              ? highlightMatch(message.content, debouncedQuery)
                              : "📎 Attachment"}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : (
          <>
            {/* Chat members */}
            <ChatInfoSection title="Chat members" defaultOpen>
              {isChannel ? (
                <div>
                  {canManage && addableMembers.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAddModal(true)}
                      className="mb-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add people
                    </button>
                  )}
                  <div className="rounded-xl border border-slate-200 bg-white p-1.5">
                    {channelMembersQuery.isPending ? (
                      <p className="px-2 py-2 text-sm text-slate-400">Loading…</p>
                    ) : channelMembers.length === 0 ? (
                      <p className="px-2 py-2 text-sm text-slate-400">No members yet.</p>
                    ) : (
                      channelMembers.map((participant) => {
                        const label =
                          participant.user?.display_name ||
                          participant.user?.email ||
                          participant.user_id;
                        return (
                          <div
                            key={participant.user_id}
                            className="flex items-center gap-2 rounded-lg px-2 py-2"
                          >
                            <ChatAvatar
                              name={label}
                              avatarUrl={participant.user?.avatar_url ?? null}
                              size="sm"
                            />
                            <span className="flex-1 truncate text-sm text-slate-800">
                              {label}
                              {participant.user_id === currentUserId && (
                                <span className="ml-1 text-xs text-slate-400">(you)</span>
                              )}
                            </span>
                            {canManage && participant.user_id !== currentUserId && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  removeMember.mutate({
                                    roomId: room?.id ?? "",
                                    userId: participant.user_id,
                                  })
                                }
                                className="rounded-md px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white p-1.5">
                  {dmMember && (
                    <DmMemberRow
                      name={dmMember.name}
                      sub={dmMember.positionLabel}
                      avatarUrl={dmMember.avatarUrl ?? null}
                    />
                  )}
                  {currentUser && (
                    <DmMemberRow
                      name={`${currentUser.name} (You)`}
                      sub={currentUser.positionLabel}
                      avatarUrl={currentUser.avatarUrl}
                    />
                  )}
                </div>
              )}
            </ChatInfoSection>

            {/* Media, files and links */}
            <ChatInfoSection title="Media, files and links">
              <div className="mb-3 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
                {(["media", "files", "links"] as LibraryTab[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setLibraryTab(tab)}
                    className={`rounded-md px-2 py-1.5 text-xs font-medium capitalize transition-colors ${
                      libraryTab === tab
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {libraryQuery.isPending ? (
                <div className="flex items-center justify-center py-6 text-slate-400">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : libraryTab === "media" ? (
                library && library.media.length > 0 ? (
                  <div className="grid grid-cols-3 gap-1.5">
                    {library.media.map((item, index) => (
                      <a
                        key={`${item.url}-${index}`}
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block overflow-hidden rounded-lg border border-slate-200"
                      >
                        <img
                          src={resolveAttachmentSrc(item.url)}
                          alt={item.name ?? "media"}
                          loading="lazy"
                          className="aspect-square w-full object-cover transition-opacity hover:opacity-90"
                        />
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="py-4 text-center text-sm text-slate-400">No media yet.</p>
                )
              ) : libraryTab === "files" ? (
                library && library.files.length > 0 ? (
                  <div className="space-y-1.5">
                    {library.files.map((item, index) => (
                      <a
                        key={`${item.url}-${index}`}
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        download={item.name ?? undefined}
                        className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50"
                      >
                        <FileText className="h-7 w-7 shrink-0 text-slate-500" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800">
                            {item.name ?? "File"}
                          </p>
                          <p className="text-xs text-slate-500">
                            {formatBytes(item.size)}
                          </p>
                        </div>
                        <Download className="h-4 w-4 shrink-0 text-slate-400" />
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="py-4 text-center text-sm text-slate-400">No files yet.</p>
                )
              ) : library && library.links.length > 0 ? (
                <div className="space-y-1.5">
                  {library.links.map((item, index) => (
                    <a
                      key={`${item.url}-${index}`}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50"
                    >
                      <ExternalLink className="h-5 w-5 shrink-0 text-slate-500" />
                      <span className="min-w-0 flex-1 truncate text-sm text-sky-700">
                        {item.url}
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-400">
                        {formatDate(item.created_at)}
                      </span>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="py-4 text-center text-sm text-slate-400">No links yet.</p>
              )}
            </ChatInfoSection>

            {/* Privacy & support */}
            <ChatInfoSection title="Privacy & support">
              <div className="space-y-1.5">
                {!isChannel && dmMember && (
                  <Link
                    to="/profile/$profileId"
                    params={{ profileId: dmMember.userId }}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <ExternalLink className="h-4 w-4 text-slate-500" />
                    View full profile
                  </Link>
                )}
                {isChannel && canManage && (
                  <button
                    type="button"
                    onClick={() => setShowSettingsModal(true)}
                    className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Settings className="h-4 w-4 text-slate-500" />
                    Channel settings
                  </button>
                )}
                {isChannel && canLeave && room && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() =>
                      leaveChannel.mutate(room.id, { onSuccess: onExitChannel })
                    }
                    className="flex w-full items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                  >
                    <LogOut className="h-4 w-4" />
                    Leave channel
                  </button>
                )}
              </div>
            </ChatInfoSection>
          </>
        )}
      </div>

      {isChannel && room && (
        <>
          <AddChannelMembersModal
            open={showAddModal}
            projectId={projectId}
            roomId={room.id}
            channelName={channelName}
            members={members}
            existingMemberIds={currentMemberIds}
            onClose={() => setShowAddModal(false)}
          />
          <ChannelSettingsModal
            open={showSettingsModal}
            projectId={projectId}
            room={room}
            isDefault={isDefault}
            onClose={() => setShowSettingsModal(false)}
            onArchived={onExitChannel}
          />
        </>
      )}
    </div>
  );
}
