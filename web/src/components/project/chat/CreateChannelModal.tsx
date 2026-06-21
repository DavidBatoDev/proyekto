import { useEffect, useMemo, useState } from "react";
import { Hash, Lock, X } from "lucide-react";
import type { ChatMemberCandidate } from "@/services/chat.service";
import { ModalPortal } from "@/components/common/ModalPortal";
import { ChatAvatar } from "./Avatar";
import { CHANNEL_SUGGESTIONS } from "./channelSuggestions";

/** Mirror of the backend `uniqueChannelSlug` base slugify (for dedupe). */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "channel"
  );
}

export function CreateChannelModal({
  open,
  members,
  currentUserId,
  existingChannels,
  isSubmitting,
  onClose,
  onCreate,
}: {
  open: boolean;
  members: ChatMemberCandidate[];
  currentUserId?: string;
  /** Existing project channels — used to hide already-created suggestions. */
  existingChannels: { slug: string; name: string | null }[];
  isSubmitting: boolean;
  onClose: () => void;
  onCreate: (payload: {
    name: string;
    isPrivate: boolean;
    memberIds: string[];
  }) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [memberIds, setMemberIds] = useState<string[]>([]);

  // Reset whenever the modal (re)opens.
  useEffect(() => {
    if (open) {
      setName("");
      setIsPrivate(false);
      setMemberIds([]);
    }
  }, [open]);

  const selectableMembers = useMemo(
    () => members.filter((member) => member.user_id !== currentUserId),
    [members, currentUserId],
  );

  // Hide a suggestion once a matching channel exists (by slug, by name-derived
  // slug, or by case-insensitive name).
  const availableSuggestions = useMemo(() => {
    const takenSlugs = new Set(
      existingChannels.map((c) => c.slug.toLowerCase()),
    );
    const takenNames = new Set(
      existingChannels.map((c) => (c.name ?? "").trim().toLowerCase()),
    );
    return CHANNEL_SUGGESTIONS.filter(
      (s) =>
        !takenSlugs.has(s.slug) &&
        !takenSlugs.has(slugify(s.name)) &&
        !takenNames.has(s.name.toLowerCase()),
    );
  }, [existingChannels]);

  if (!open) return null;

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !isSubmitting;

  const toggleMember = (id: string) =>
    setMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const submit = () => {
    if (!canSubmit) return;
    void onCreate({ name: trimmed, isPrivate, memberIds });
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
        <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">
            Create channel
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {availableSuggestions.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-600">
                Suggested channels
              </p>
              <div className="flex flex-wrap gap-2">
                {availableSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.slug}
                    type="button"
                    title={suggestion.description}
                    onClick={() => {
                      setName(suggestion.name);
                      setIsPrivate(suggestion.isPrivate);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-100"
                  >
                    {suggestion.isPrivate ? (
                      <Lock className="h-3.5 w-3.5 text-slate-400" />
                    ) : (
                      <Hash className="h-3.5 w-3.5 text-slate-400" />
                    )}
                    {suggestion.name}
                  </button>
                ))}
              </div>
            </div>
          )}

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
              {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
              <input
                autoFocus
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                placeholder="e.g. design-review"
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

          {isPrivate && selectableMembers.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">
                Add members
              </p>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200">
                {selectableMembers.map((member) => {
                  const label =
                    member.user?.display_name ||
                    member.user?.email ||
                    member.user_id;
                  const checked = memberIds.includes(member.user_id);
                  return (
                    <button
                      key={member.user_id}
                      type="button"
                      onClick={() => toggleMember(member.user_id)}
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
                      />
                      <span className="truncate text-sm text-slate-800">
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {isSubmitting ? "Creating…" : "Create"}
          </button>
        </div>
        </div>
      </div>
    </ModalPortal>
  );
}
