import { useEffect, useMemo, useState } from "react";
import { Lock, X } from "lucide-react";
import type { ChatMemberCandidate } from "@/services/chat.service";
import { useAddChannelMemberMutation } from "@/hooks/useChatQueries";
import { ModalPortal } from "@/components/common/ModalPortal";
import { ChatAvatar } from "./Avatar";

/**
 * Multi-select modal for adding project members to a channel. Filters out anyone
 * already in the channel; adds the selected members on confirm.
 */
export function AddChannelMembersModal({
  open,
  projectId,
  roomId,
  channelName,
  members,
  existingMemberIds,
  onClose,
}: {
  open: boolean;
  projectId: string;
  roomId: string | null;
  channelName: string;
  members: ChatMemberCandidate[];
  existingMemberIds: Set<string>;
  onClose: () => void;
}) {
  const addMember = useAddChannelMemberMutation(projectId);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (open) setSelected([]);
  }, [open]);

  const addable = useMemo(
    () => members.filter((m) => !existingMemberIds.has(m.user_id)),
    [members, existingMemberIds],
  );

  if (!open) return null;

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const canSubmit = selected.length > 0 && !addMember.isPending && !!roomId;

  const submit = async () => {
    if (!canSubmit || !roomId) return;
    await Promise.all(
      selected.map((userId) =>
        addMember.mutateAsync({ roomId, userId }).catch(() => null),
      ),
    );
    onClose();
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
        <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div className="flex min-w-0 items-center gap-2">
              <Lock className="h-4 w-4 shrink-0 text-slate-400" />
              <h2 className="truncate text-base font-semibold text-slate-900">
                Add members · {channelName}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={addMember.isPending}
              aria-label="Close"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-5 py-4">
            <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
              {addable.length === 0 ? (
                <p className="px-3 py-4 text-sm text-slate-400">
                  Everyone in the project is already a member.
                </p>
              ) : (
                addable.map((member) => {
                  const label =
                    member.user?.display_name ||
                    member.user?.email ||
                    member.user_id;
                  const checked = selected.includes(member.user_id);
                  return (
                    <button
                      key={member.user_id}
                      type="button"
                      onClick={() => toggle(member.user_id)}
                      className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        readOnly
                        checked={checked}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      <ChatAvatar
                        name={label}
                        avatarUrl={member.user?.avatar_url ?? null}
                        size="sm"
                      />
                      <span className="truncate text-sm text-slate-800">
                        {label}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={addMember.isPending}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {addMember.isPending
                ? "Adding…"
                : `Add${selected.length ? ` (${selected.length})` : ""}`}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
