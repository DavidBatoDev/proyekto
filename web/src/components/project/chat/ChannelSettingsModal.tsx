import { useEffect, useState } from "react";
import { Archive, Hash, Lock, X } from "lucide-react";
import type { ChatRoom } from "@/services/chat.service";
import { useUpdateChannelMutation } from "@/hooks/useChatQueries";
import { ModalPortal } from "@/components/common/ModalPortal";

/**
 * Channel settings modal (rename + public/private + archive). Replaces the
 * inline gear dropdown in ChannelDetailsPanel. Name + visibility are applied
 * together via one "Save changes"; archive is a separate destructive action
 * (hidden for default rooms like #general).
 */
export function ChannelSettingsModal({
  open,
  projectId,
  room,
  isDefault,
  onClose,
  onArchived,
}: {
  open: boolean;
  projectId: string;
  room: ChatRoom | null;
  isDefault: boolean;
  onClose: () => void;
  /** Called after a successful archive so the caller can navigate away. */
  onArchived: () => void;
}) {
  const updateChannel = useUpdateChannelMutation(projectId);
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);

  // Re-seed drafts from the room each time the modal opens.
  useEffect(() => {
    if (open && room) {
      setName(room.name ?? room.slug);
      setIsPrivate(room.is_private);
    }
  }, [open, room]);

  if (!open || !room) return null;

  const currentName = room.name ?? room.slug;
  const trimmed = name.trim();
  const dirty =
    trimmed.length > 0 &&
    (trimmed !== currentName || isPrivate !== room.is_private);
  const isBusy = updateChannel.isPending;

  const saveChanges = () => {
    if (!dirty || isBusy) return;
    updateChannel.mutate(
      { roomId: room.id, name: trimmed, is_private: isPrivate },
      { onSuccess: onClose },
    );
  };

  const archive = () => {
    if (isBusy) return;
    updateChannel.mutate(
      { roomId: room.id, is_archived: true },
      {
        onSuccess: () => {
          onArchived();
          onClose();
        },
      },
    );
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
        <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div className="flex min-w-0 items-center gap-2">
              {isPrivate ? (
                <Lock className="h-4 w-4 shrink-0 text-slate-400" />
              ) : (
                <Hash className="h-4 w-4 shrink-0 text-slate-400" />
              )}
              <h2 className="truncate text-base font-semibold text-slate-900">
                Channel settings
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isBusy}
              aria-label="Close"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-4 px-5 py-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Channel name
              </label>
              <div className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 focus-within:border-slate-900">
                {isPrivate ? (
                  <Lock className="h-4 w-4 text-slate-400" />
                ) : (
                  <Hash className="h-4 w-4 text-slate-400" />
                )}
                <input
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveChanges();
                  }}
                  className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                />
              </div>
            </div>

            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <span>
                <span className="block text-sm font-medium text-slate-800">
                  Make private
                </span>
                <span className="block text-xs text-slate-500">
                  Only invited members (and the consultant) can see this channel.
                </span>
              </span>
            </label>

            {!isDefault && (
              <div className="border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={archive}
                  disabled={isBusy}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                >
                  <Archive className="h-4 w-4" />
                  Archive channel
                </button>
                <p className="px-2 text-xs text-slate-400">
                  Hides the channel for everyone. Messages are kept.
                </p>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isBusy}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveChanges}
              disabled={!dirty || isBusy}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {isBusy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
