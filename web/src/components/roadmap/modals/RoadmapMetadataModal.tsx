import { useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Sparkles, Tag, X } from "lucide-react";
import { ModalPortal } from "@/components/common/ModalPortal";

export interface RoadmapMetadataFormData {
  title: string;
  description: string;
  category: string;
}

interface RoadmapMetadataModalProps {
  isOpen: boolean;
  onClose: () => void;
  formData: RoadmapMetadataFormData;
  onUpdateFormData: (updates: Partial<RoadmapMetadataFormData>) => void;
  onSubmit: () => Promise<void>;
  isSubmitting: boolean;
}

const TITLE_LIMIT = 200;
const CATEGORY_LIMIT = 80;
const DESCRIPTION_LIMIT = 1200;

const CATEGORY_SUGGESTIONS = [
  "Web Development",
  "Mobile App",
  "SaaS",
  "AI / ML",
  "E-commerce",
  "Marketing",
];

export function RoadmapMetadataModal({
  isOpen,
  onClose,
  formData,
  onUpdateFormData,
  onSubmit,
  isSubmitting,
}: RoadmapMetadataModalProps) {
  const trimmedTitle = useMemo(() => formData.title.trim(), [formData.title]);
  const isSaveDisabled = isSubmitting || trimmedTitle.length === 0;

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, isSubmitting, onClose]);

  const handleSubmit = () => {
    if (isSaveDisabled) return;
    void onSubmit();
  };

  return (
    <ModalPortal>
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-9999 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="absolute inset-0 bg-black/45 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          <motion.div
            className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-orange-100 bg-white shadow-2xl"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-roadmap-title"
          >
            <div className="absolute -top-16 -left-16 h-40 w-40 rounded-full bg-orange-100 blur-3xl" />
            <div className="absolute -bottom-16 -right-14 h-40 w-40 rounded-full bg-rose-100 blur-3xl" />

            <div className="relative px-5 py-4 border-b border-gray-100 bg-white/95 flex items-center justify-between">
              <div>
                <h2
                  id="edit-roadmap-title"
                  className="text-lg font-semibold text-gray-900 flex items-center gap-2"
                >
                  <Sparkles className="w-4 h-4 text-orange-500" />
                  Edit Roadmap
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  Update your roadmap metadata without leaving the canvas.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-50"
                aria-label="Close"
                disabled={isSubmitting}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative p-5 space-y-5 max-h-[70vh] overflow-y-auto">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-800">
                  Name
                </label>
                <input
                  type="text"
                  value={formData.title}
                  maxLength={TITLE_LIMIT}
                  onChange={(e) => onUpdateFormData({ title: e.target.value })}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                  placeholder="Untitled Roadmap"
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">
                    Give your roadmap a concise, recognizable title.
                  </p>
                  <span className="text-xs text-gray-400">
                    {formData.title.length}/{TITLE_LIMIT}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-800">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  maxLength={DESCRIPTION_LIMIT}
                  onChange={(e) =>
                    onUpdateFormData({ description: e.target.value })
                  }
                  rows={5}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                  placeholder="Describe your roadmap"
                  onKeyDown={(event) => {
                    if (
                      (event.ctrlKey || event.metaKey) &&
                      event.key === "Enter"
                    ) {
                      event.preventDefault();
                      handleSubmit();
                    }
                  }}
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">
                    Add context so collaborators understand scope and intent.
                  </p>
                  <span className="text-xs text-gray-400">
                    {formData.description.length}/{DESCRIPTION_LIMIT}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="inline-flex text-sm font-medium text-gray-800 items-center gap-1.5">
                  <Tag className="w-4 h-4 text-orange-500" />
                  Category
                </label>
                <input
                  type="text"
                  value={formData.category}
                  maxLength={CATEGORY_LIMIT}
                  onChange={(e) =>
                    onUpdateFormData({ category: e.target.value })
                  }
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                  placeholder="e.g. Web Development"
                />
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {CATEGORY_SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="px-2.5 py-1 text-xs font-medium rounded-full bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100"
                      onClick={() => onUpdateFormData({ category: suggestion })}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-end">
                  <span className="text-xs text-gray-400">
                    {formData.category.length}/{CATEGORY_LIMIT}
                  </span>
                </div>
              </div>
            </div>

            <div className="relative px-5 py-4 border-t border-gray-100 bg-white/95 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSaveDisabled}
                className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {isSubmitting ? "Saving..." : "Save"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </ModalPortal>
  );
}
