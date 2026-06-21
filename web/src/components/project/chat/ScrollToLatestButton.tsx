import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";

/**
 * Floating "jump to latest" control, shown when the thread is scrolled up.
 * Expands into a "New messages" pill when messages arrived below the fold.
 */
export function ScrollToLatestButton({
  show,
  hasNew,
  onClick,
}: {
  show: boolean;
  hasNew: boolean;
  onClick: () => void;
}) {
  return (
    <AnimatePresence>
      {show && (
        <motion.button
          type="button"
          onClick={onClick}
          initial={{ opacity: 0, y: 10, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.9 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className={`absolute bottom-4 right-4 z-10 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white text-sm font-medium text-slate-700 shadow-lg transition-colors hover:bg-slate-50 ${
            hasNew ? "px-3 py-2" : "h-10 w-10 justify-center"
          }`}
          aria-label="Jump to latest messages"
        >
          {hasNew && <span className="h-2 w-2 rounded-full bg-violet-500" />}
          {hasNew && <span>New messages</span>}
          <ChevronDown className="h-5 w-5" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
