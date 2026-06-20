import { useMemo, useState } from "react";
import {
  Archive,
  Check,
  Hash,
  Lock,
  LogOut,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Settings,
  Unlock,
  X,
} from "lucide-react";
import type { ChatMemberCandidate, ChatRoom } from "@/services/chat.service";
import {
  useChannelMembersQuery,
  useLeaveChannelMutation,
  useRemoveChannelMemberMutation,
  useUpdateChannelMutation,
} from "@/hooks/useChatQueries";
import { ChatAvatar } from "./Avatar";
import { AddChannelMembersModal } from "./AddChannelMembersModal";

// Default rooms can't be archived (mirrors backend DEFAULT_CHANNEL_SLUGS).
const DEFAULT_CHANNEL_SLUGS = new Set([
  "client-room",
  "internal-team",
  "consultant-client",
  "consultant-pm",
  "general",
]);

/**
 * Right-side panel for a channel: its real members (add/remove for managers),
 * a settings menu (rename / visibility / archive), and a self-service Leave.
 * Replaces showing project members for channels.
 */
export function ChannelDetailsPanel({
  projectId,
  room,
  members,
  currentUserId,
  canManage,
  isOpen,
  onToggle,
  onClose,
  onExitChannel,
}: {
  projectId: string;
  room: ChatRoom | null;
  members: ChatMemberCandidate[];
  currentUserId?: string;
  canManage: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  /** Navigate away after the active channel disappears (leave / archive). */
  onExitChannel: () => void;
}) {
  const roomId = room?.id ?? null;
  const membersQuery = useChannelMembersQuery(projectId, roomId, isOpen);
  const removeMember = useRemoveChannelMemberMutation(projectId);
  const updateChannel = useUpdateChannelMutation(projectId);
  const leaveChannel = useLeaveChannelMutation(projectId);

  const [showSettings, setShowSettings] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);

  const channelMembers = membersQuery.data ?? [];
  const currentMemberIds = useMemo(
    () => new Set(channelMembers.map((m) => m.user_id)),
    [channelMembers],
  );
  const addableMembers = useMemo(
    () => members.filter((m) => !currentMemberIds.has(m.user_id)),
    [members, currentMemberIds],
  );

  if (!room) return null;

  const isDefault = DEFAULT_CHANNEL_SLUGS.has(room.slug);
  const isPrivate = room.is_private;
  const channelName = room.name || room.slug;
  const isBusy =
    updateChannel.isPending ||
    leaveChannel.isPending ||
    removeMember.isPending;
  const canLeave =
    isPrivate && !!currentUserId && currentMemberIds.has(currentUserId);

  const startRename = () => {
    setNameDraft(room.name ?? room.slug);
    setRenaming(true);
  };
  const saveRename = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    updateChannel.mutate(
      { roomId: room.id, name: trimmed },
      { onSuccess: () => setRenaming(false) },
    );
  };

  return (
    <div className="h-full flex flex-col">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 px-3 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Channel Details
          </p>
          <div className="flex items-center gap-1">
            {canManage && (
              <button
                type="button"
                onClick={() => setShowSettings((v) => !v)}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors ${
                  showSettings
                    ? "border-slate-700 bg-slate-900 text-white"
                    : "border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
                aria-label="Channel settings"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onToggle}
              className="hidden h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 xl:inline-flex"
              aria-label={isOpen ? "Collapse panel" : "Expand panel"}
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
              aria-label="Close panel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-4">
        {/* Identity / rename */}
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700">
              {isPrivate ? (
                <Lock className="w-4 h-4" />
              ) : (
                <Hash className="w-5 h-5" />
              )}
            </div>
            {renaming ? (
              <div className="flex flex-1 items-center gap-1">
                {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                <input
                  autoFocus
                  value={nameDraft}
                  maxLength={120}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveRename();
                    if (e.key === "Escape") setRenaming(false);
                  }}
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-900"
                />
                <button
                  type="button"
                  onClick={saveRename}
                  disabled={isBusy || !nameDraft.trim()}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-white disabled:opacity-50"
                  aria-label="Save name"
                >
                  <Check className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {channelName}
                </p>
                <p className="text-xs text-slate-500">
                  {isPrivate ? "Private channel" : "Channel"} ·{" "}
                  {channelMembers.length} member
                  {channelMembers.length === 1 ? "" : "s"}
                </p>
              </div>
            )}
          </div>

          {canManage && showSettings && !renaming && (
            <div className="mt-3 flex flex-col gap-1 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={startRename}
                disabled={isBusy}
                className="rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Rename channel
              </button>
              <button
                type="button"
                onClick={() =>
                  updateChannel.mutate({
                    roomId: room.id,
                    is_private: !isPrivate,
                  })
                }
                disabled={isBusy}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                {isPrivate ? (
                  <Unlock className="w-4 h-4" />
                ) : (
                  <Lock className="w-4 h-4" />
                )}
                {isPrivate ? "Make public" : "Make private"}
              </button>
              {!isDefault && (
                <button
                  type="button"
                  onClick={() =>
                    updateChannel.mutate(
                      { roomId: room.id, is_archived: true },
                      { onSuccess: onExitChannel },
                    )
                  }
                  disabled={isBusy}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                >
                  <Archive className="w-4 h-4" />
                  Archive channel
                </button>
              )}
            </div>
          )}
        </div>

        {/* Members */}
        <div>
          <div className="mb-1 flex items-center justify-between px-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Members
            </p>
            {canManage && addableMembers.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-1.5">
            {membersQuery.isPending ? (
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
                    {canManage && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          removeMember.mutate({
                            roomId: room.id,
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

        {/* Leave */}
        {canLeave && (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => leaveChannel.mutate(room.id, { onSuccess: onExitChannel })}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
          >
            <LogOut className="w-4 h-4" />
            Leave channel
          </button>
        )}
      </div>

      <AddChannelMembersModal
        open={showAddModal}
        projectId={projectId}
        roomId={room.id}
        channelName={channelName}
        members={members}
        existingMemberIds={currentMemberIds}
        onClose={() => setShowAddModal(false)}
      />
    </div>
  );
}
