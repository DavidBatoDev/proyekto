import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, Loader2, Sparkles } from "lucide-react";
import { ModalPortal } from "@/components/common/ModalPortal";
import type { Roadmap } from "@/types/roadmap";

interface MigrationModalProps {
  isOpen: boolean;
  roadmaps: Roadmap[];
  isMigrating: boolean;
  onClose: () => void;
}

export function MigrationModal({
  isOpen,
  roadmaps,
  isMigrating,
  onClose,
}: MigrationModalProps) {
  return (
    <ModalPortal>
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50"
            onClick={isMigrating ? undefined : onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-8 pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-pink-500 flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    {isMigrating ? "Saving Your Work..." : "All Set! 🎉"}
                  </h2>
                  <p className="text-sm text-gray-600">
                    {isMigrating
                      ? "Please wait..."
                      : "Your roadmaps are now in your account"}
                  </p>
                </div>
              </div>

              {/* Roadmap List */}
              <div className="mb-6">
                <p className="text-gray-700 mb-4">
                  {isMigrating ? "Migrating" : "We migrated"}{" "}
                  <strong>{roadmaps.length}</strong> roadmap
                  {roadmaps.length !== 1 ? "s" : ""}{" "}
                  {isMigrating ? "from your guest session" : "to your account"}:
                </p>

                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {roadmaps.map((roadmap) => (
                    <div
                      key={roadmap.id}
                      className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200"
                    >
                      {isMigrating ? (
                        <Loader2 className="w-5 h-5 text-primary animate-spin flex-shrink-0 mt-0.5" />
                      ) : (
                        <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">
                          {roadmap.name}
                        </p>
                        {roadmap.description && (
                          <p className="text-sm text-gray-600 truncate">
                            {roadmap.description}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action */}
              <div className="flex justify-center">
                <button
                  onClick={onClose}
                  disabled={isMigrating}
                  className="w-full px-6 py-3 bg-primary text-white font-semibold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isMigrating ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Migrating...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-5 h-5" />
                      Sounds Good!
                    </>
                  )}
                </button>
              </div>

              <p className="text-xs text-gray-500 text-center mt-4">
                {isMigrating
                  ? "This will only take a moment..."
                  : "You can find all your roadmaps in your dashboard"}
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
    </ModalPortal>
  );
}
