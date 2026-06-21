import { motion } from "framer-motion";
import EmojiPicker, { Theme, type EmojiClickData } from "emoji-picker-react";
import { AtSign, FileText, Loader2, Paperclip, Send, Smile, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EVERYONE_MENTION_ID, type MentionPick } from "./mentions";

/** A file queued in the composer, not yet uploaded/sent. */
export interface PendingAttachment {
  id: string;
  file: File;
  kind: "image" | "file";
  /** Object URL for image previews (revoked after send). */
  previewUrl?: string;
}

/** A person who can be @mentioned from the composer. */
export interface MentionCandidate {
  user_id: string;
  name: string;
  avatar_url: string | null;
}

const MAX_MENTION_RESULTS = 8;

/** Locate an active `@query` token immediately before the caret. */
function getMentionContext(
  value: string,
  caret: number,
): { start: number; query: string } | null {
  let i = caret - 1;
  while (i >= 0) {
    const ch = value[i];
    if (ch === "@") {
      const prev = i > 0 ? value[i - 1] : " ";
      if (i === 0 || /\s/.test(prev)) {
        const query = value.slice(i + 1, caret);
        if (/\s/.test(query)) return null;
        return { start: i, query };
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
    i -= 1;
  }
  return null;
}

function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function ChatComposer({
  value,
  placeholder,
  isSending,
  isUploading,
  attachments,
  mentionables,
  canMention,
  onChange,
  onBlur,
  onSend,
  onAddFiles,
  onRemoveAttachment,
  onAddMention,
}: {
  value: string;
  placeholder: string;
  isSending: boolean;
  isUploading?: boolean;
  attachments: PendingAttachment[];
  mentionables?: MentionCandidate[];
  canMention?: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
  onSend: () => void;
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  onAddMention?: (pick: MentionPick) => void;
}) {
  const hasAttachments = attachments.length > 0;
  const disabled =
    isSending ||
    isUploading ||
    (value.trim().length === 0 && !hasAttachments);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pickerContainerRef = useRef<HTMLDivElement | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const MAX_TEXTAREA_HEIGHT = 156;

  // ── @mention picker state ─────────────────────────────────────────────────
  const mentionsEnabled = !!canMention && (mentionables?.length ?? 0) > 0;
  const [mention, setMention] = useState<{ start: number; query: string } | null>(
    null,
  );
  const [mentionIndex, setMentionIndex] = useState(0);

  type MentionOption = MentionCandidate & { isEveryone?: boolean };
  const mentionOptions: MentionOption[] = (() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    const people = (mentionables ?? [])
      .filter((m) => m.name.toLowerCase().includes(q))
      .slice(0, MAX_MENTION_RESULTS);
    const options: MentionOption[] = [...people];
    if ("everyone".startsWith(q)) {
      options.push({
        user_id: EVERYONE_MENTION_ID,
        name: "everyone",
        avatar_url: null,
        isEveryone: true,
      });
    }
    return options;
  })();
  const mentionOpen = mentionsEnabled && !!mention && mentionOptions.length > 0;

  const closeMention = () => setMention(null);

  const syncMention = (nextValue: string, caret: number | null) => {
    if (!mentionsEnabled || caret == null) {
      setMention(null);
      return;
    }
    const ctx = getMentionContext(nextValue, caret);
    setMention(ctx);
    setMentionIndex(0);
  };

  const selectMention = (option: MentionOption) => {
    const textarea = textareaRef.current;
    if (!mention) return;
    const label = `@${option.name}`;
    const before = value.slice(0, mention.start);
    const after = value.slice(
      mention.start + 1 + mention.query.length, // skip "@" + query
    );
    const insert = `${label} `;
    const nextValue = `${before}${insert}${after}`;
    onChange(nextValue);
    onAddMention?.({ user_id: option.user_id, name: option.name });
    closeMention();

    requestAnimationFrame(() => {
      if (!textarea) return;
      textarea.focus();
      const caret = before.length + insert.length;
      textarea.setSelectionRange(caret, caret);
      adjustTextareaHeight();
    });
  };

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const next = Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT);
    textarea.style.height = `${Math.max(40, next)}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [value]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!showEmojiPicker) return;
      const target = event.target as Node | null;
      if (!target) return;
      if (pickerContainerRef.current?.contains(target)) return;
      setShowEmojiPicker(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowEmojiPicker(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showEmojiPicker]);

  const insertEmoji = (emojiData: EmojiClickData) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      onChange(`${value}${emojiData.emoji}`);
      return;
    }

    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? value.length;
    const nextValue = `${value.slice(0, start)}${emojiData.emoji}${value.slice(end)}`;
    onChange(nextValue);

    requestAnimationFrame(() => {
      textarea.focus();
      const caret = start + emojiData.emoji.length;
      textarea.setSelectionRange(caret, caret);
      adjustTextareaHeight();
    });
  };

  const handlePickedFiles = (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (files.length > 0) onAddFiles(files);
  };

  return (
    <footer
      className="sticky bottom-0 border-t border-slate-200 bg-white/95 px-3 py-3 backdrop-blur md:px-6"
      onDragOver={(event) => {
        if (event.dataTransfer?.types?.includes("Files")) {
          event.preventDefault();
          setIsDragging(true);
        }
      }}
      onDragLeave={(event) => {
        // Only clear when the pointer actually leaves the footer.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
          return;
        }
        setIsDragging(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer?.types?.includes("Files")) return;
        event.preventDefault();
        setIsDragging(false);
        handlePickedFiles(event.dataTransfer.files);
      }}
    >
      <div className="relative">
        {mentionOpen && (
          <div className="absolute bottom-full left-0 z-40 mb-2 w-72 max-w-[calc(100%-1rem)] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
            <ul className="max-h-60 overflow-y-auto">
              {mentionOptions.map((option, idx) => (
                <li key={option.user_id}>
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      selectMention(option);
                    }}
                    onMouseEnter={() => setMentionIndex(idx)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                      idx === mentionIndex
                        ? "bg-violet-50 text-violet-700"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {option.isEveryone ? (
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                        <AtSign className="h-4 w-4" />
                      </span>
                    ) : option.avatar_url ? (
                      <img
                        src={option.avatar_url}
                        alt={option.name}
                        className="h-7 w-7 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-600">
                        {initialsOf(option.name)}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{option.name}</span>
                    {option.isEveryone && (
                      <span className="shrink-0 text-xs text-slate-400">
                        Notify everyone
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div
          className={`relative rounded-3xl border bg-slate-50 pl-3 pr-36 py-2 transition-colors ${
            isDragging ? "border-violet-400 bg-violet-50" : "border-slate-300"
          }`}
        >
          {hasAttachments && (
            <div className="mb-2 flex flex-wrap gap-2 pt-1">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="group/att relative">
                  {attachment.kind === "image" && attachment.previewUrl ? (
                    <img
                      src={attachment.previewUrl}
                      alt={attachment.file.name}
                      className="h-20 w-20 rounded-lg border border-slate-300 object-cover"
                    />
                  ) : (
                    <div className="flex h-20 w-44 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3">
                      <FileText className="h-7 w-7 shrink-0 text-slate-500" />
                      <span className="truncate text-xs text-slate-700">
                        {attachment.file.name}
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemoveAttachment(attachment.id)}
                    className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-white shadow hover:bg-slate-900"
                    aria-label={`Remove ${attachment.file.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
              syncMention(event.target.value, event.target.selectionStart);
            }}
            onClick={(event) =>
              syncMention(
                event.currentTarget.value,
                event.currentTarget.selectionStart,
              )
            }
            onBlur={() => {
              closeMention();
              onBlur();
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData?.files ?? []);
              if (files.length > 0) {
                event.preventDefault();
                onAddFiles(files);
              }
            }}
            onKeyDown={(event) => {
              if (mentionOpen) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setMentionIndex((i) => (i + 1) % mentionOptions.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setMentionIndex(
                    (i) => (i - 1 + mentionOptions.length) % mentionOptions.length,
                  );
                  return;
                }
                if (event.key === "Enter" || event.key === "Tab") {
                  event.preventDefault();
                  selectMention(mentionOptions[mentionIndex] ?? mentionOptions[0]);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeMention();
                  return;
                }
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder={placeholder}
            rows={1}
            className="w-full resize-none bg-transparent px-1 py-1 text-sm leading-6 text-slate-900 placeholder:text-slate-500 focus:outline-none"
          />

          <div className="absolute right-3 top-2 inline-flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                handlePickedFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200 hover:text-slate-700"
              aria-label="Attach files"
              title="Attach files"
            >
              <Paperclip className="w-5 h-5" />
            </button>

            <div ref={pickerContainerRef} className="relative hidden md:block">
              <button
                type="button"
                onClick={() => setShowEmojiPicker((current) => !current)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                aria-label="Open emoji picker"
              >
                <Smile className="w-5 h-5" />
              </button>

              {showEmojiPicker && (
                <div className="absolute bottom-10 right-0 z-30 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                  <EmojiPicker
                    lazyLoadEmojis
                    searchDisabled={false}
                    skinTonesDisabled
                    width={320}
                    height={380}
                    theme={Theme.LIGHT}
                    onEmojiClick={(emojiData) => insertEmoji(emojiData)}
                  />
                </div>
              )}
            </div>

            <motion.button
              whileTap={{ scale: 0.96 }}
              type="button"
              onClick={onSend}
              disabled={disabled}
              className="app-cta inline-flex h-9 w-9 items-center justify-center rounded-full text-white disabled:opacity-55"
            >
              {isSending || isUploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </motion.button>
          </div>
        </div>
      </div>
    </footer>
  );
}
