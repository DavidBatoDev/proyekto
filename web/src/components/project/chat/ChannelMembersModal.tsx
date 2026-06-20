import { useMemo } from "react";
import { Lock, Plus, X } from "lucide-react";
import type { ChatMemberCandidate, ChatRoom } from "@/services/chat.service";
import {
  useAddChannelMemberMutation,
  useChannelMembersQuery,
  useRemoveChannelMemberMutation,
} from "@/hooks/useChatQueries";
import { ModalPortal } from "@/components/common/ModalPortal";
import { ChatAvatar } from "./Avatar";

/**
 * Manage the membership of an existing (private) channel. Visibility is pure
 * membership, so this is how the private default rooms get populated as people
 * join the project.
 */
export function ChannelMembersModal({
  open,
  projectId,
  room,
  members,
  currentUserId,
  onClose,
}: {
  open: boolean;
  projectId: string;
  room: ChatRoom | null;
  members: ChatMemberCandidate[];
  currentUserId?: string;
  onClose: () => void;
}) {
  const roomId = room?.id ?? null;
  const membersQuery = useChannelMembersQuery(projectId, roomId, open);
  const addMember = useAddChannelMemberMutation(projectId);
  const removeMember = useRemoveChannelMemberMutation(projectId);

  const currentMemberIds = useMemo(
    () => new Set((membersQuery.data ?? []).map((m) => m.user_id)),
    [membersQuery.data],
  );

  const addableMembers = useMemo(
    () => members.filter((m) => !currentMemberIds.has(m.user_id)),
    [members, currentMemberIds],
  );

  if (!open || !room) return null;

  const isBusy = addMember.isPending || removeMember.isPending;
  const channelLabel = room.name || room.slug;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
        <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-2 min-w-0">
              {room.is_private && <Lock className="h-4 w-4 shrink-0 text-slate-400" />}
              <h2 className="truncate text-base font-semibold text-slate-900">
                Members · {channelLabel}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-4 px-5 py-4">
            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">
                Current members
              </p>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200">
                {membersQuery.isPending ? (
                  <p className="px-3 py-3 text-sm text-slate-400">Loading…</p>
                ) : (membersQuery.data ?? []).length === 0 ? (
                  <p className="px-3 py-3 text-sm text-slate-400">No members yet.</p>
                ) : (
                  (membersQuery.data ?? []).map((participant) => {
                    const label =
                      participant.user?.display_name ||
                      participant.user?.email ||
                      participant.user_id;
                    return (
                      <div
                        key={participant.user_id}
                        className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0"
                      >
                        <ChatAvatar
                          name={label}
                          avatarUrl={participant.user?.avatar_url ?? null}
                        />
                        <span className="flex-1 truncate text-sm text-slate-800">
                          {label}
                          {participant.user_id === currentUserId && (
                            <span className="ml-1 text-xs text-slate-400">(you)</span>
                          )}
                        </span>
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
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">Add members</p>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200">
                {addableMembers.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-slate-400">
                    Everyone in the project is already a member.
                  </p>
                ) : (
                  addableMembers.map((member) => {
                    const label =
                      member.user?.display_name ||
                      member.user?.email ||
                      member.user_id;
                    return (
                      <button
                        key={member.user_id}
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          addMember.mutate({
                            roomId: room.id,
                            userId: member.user_id,
                          })
                        }
                        className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <ChatAvatar
                          name={label}
                          avatarUrl={member.user?.avatar_url ?? null}
                        />
                        <span className="flex-1 truncate text-sm text-slate-800">
                          {label}
                        </span>
                        <Plus className="h-4 w-4 text-slate-400" />
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end border-t border-slate-200 px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
