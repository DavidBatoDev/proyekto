import { motion } from "framer-motion";
import EmojiPicker, { Theme, type EmojiClickData } from "emoji-picker-react";
import { Loader2, Send, Smile } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function ChatComposer({
  value,
  placeholder,
  isSending,
  onChange,
  onBlur,
  onSend,
}: {
  value: string;
  placeholder: string;
  isSending: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
  onSend: () => void;
}) {
  const disabled = isSending || value.trim().length === 0;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pickerContainerRef = useRef<HTMLDivElement | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const MAX_TEXTAREA_HEIGHT = 156;

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

  return (
    <footer className="sticky bottom-0 border-t border-slate-200 bg-white/95 px-3 py-3 backdrop-blur md:px-6">
      <div className="relative rounded-3xl border border-slate-300 bg-slate-50 pl-3 pr-28 py-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          onKeyDown={(event) => {
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
            {isSending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </motion.button>
        </div>
      </div>
    </footer>
  );
}
