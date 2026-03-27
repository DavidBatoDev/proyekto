import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { ChatAvatar } from "./Avatar";

export function ChatUnsendConfirmModal({
  open,
  senderName,
  senderAvatarUrl,
  sentAt,
  content,
  isSubmitting,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  senderName: string;
  senderAvatarUrl?: string | null;
  sentAt: string;
  content: string;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="fixed inset-0 z-[90] bg-black/45"
            aria-label="Close unsend confirmation"
          />

          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed z-[91] left-1/2 top-1/2 w-[92vw] max-w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-gray-700 bg-[#1f2128] p-5 text-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-4 font-semibold text-white">Delete Message</h3>
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-300 hover:bg-white/10 hover:text-white"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="mt-3 text-[31px] text-gray-300">
              Are you sure you want to delete this message?
            </p>

            <div className="mt-5 rounded-xl bg-[#181a21] px-4 py-4">
              <div className="flex items-start gap-3">
                <ChatAvatar name={senderName} avatarUrl={senderAvatarUrl} size="lg" />
                <div className="min-w-0">
                  <p className="text-[32px] font-semibold text-white truncate">
                    {senderName}
                    <span className="ml-2 text-xs font-normal text-gray-400">{sentAt}</span>
                  </p>
                  <p className="mt-1 text-sm text-gray-200 whitespace-pre-wrap break-words">
                    {content}
                  </p>
                </div>
              </div>
            </div>

            <p className="mt-5 text-sm text-gray-200">
              <span className="font-semibold text-green-400">PROTIP:</span>{" "}
              Hold <span className="font-semibold">Shift</span> when clicking unsend to
              bypass this confirmation.
            </p>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={onCancel}
                disabled={isSubmitting}
                className="h-12 rounded-xl bg-white/8 text-white hover:bg-white/14 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={isSubmitting}
                className="h-12 rounded-xl bg-red-600 text-white hover:bg-red-500 disabled:opacity-60"
              >
                {isSubmitting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
