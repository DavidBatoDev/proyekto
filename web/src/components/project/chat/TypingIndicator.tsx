import { AnimatePresence, motion } from "framer-motion";

export function TypingIndicator({ names }: { names: string[] }) {
  const label =
    names.length <= 1
      ? `${names[0] ?? "Someone"} is typing...`
      : `${names.slice(0, 2).join(", ")} are typing...`;

  return (
    <AnimatePresence>
      {names.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 shadow-sm"
        >
          <div className="flex items-center gap-1">
            <motion.span
              className="h-1.5 w-1.5 rounded-full bg-orange-400"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity, delay: 0 }}
            />
            <motion.span
              className="h-1.5 w-1.5 rounded-full bg-orange-400"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity, delay: 0.2 }}
            />
            <motion.span
              className="h-1.5 w-1.5 rounded-full bg-orange-400"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity, delay: 0.4 }}
            />
          </div>
          {label}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
