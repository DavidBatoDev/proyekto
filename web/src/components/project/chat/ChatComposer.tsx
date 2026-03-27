import { motion } from "framer-motion";
import { Loader2, Send, Smile, ThumbsUp } from "lucide-react";

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

  return (
    <footer className="sticky bottom-0 border-t border-gray-200 bg-white px-3 py-3 md:px-6">
      <div className="flex items-center gap-2 rounded-full border border-gray-300 bg-[#f6f7f8] px-3 py-2">
        <button
          type="button"
          className="hidden md:inline-flex text-gray-500 hover:text-gray-700"
          aria-label="Quick reaction"
        >
          <Smile className="w-5 h-5" />
        </button>

        <input
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
          className="flex-1 bg-transparent px-1 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none"
        />

        <button
          type="button"
          className="hidden md:inline-flex text-blue-500 hover:text-blue-600"
          aria-label="Like"
        >
          <ThumbsUp className="w-5 h-5" />
        </button>

        <motion.button
          whileTap={{ scale: 0.96 }}
          type="button"
          onClick={onSend}
          disabled={disabled}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#ff9933] text-white hover:bg-[#e68829] disabled:opacity-55"
        >
          {isSending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </motion.button>
      </div>
    </footer>
  );
}
