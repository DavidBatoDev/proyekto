import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Map, X, Loader2 } from "lucide-react";
import { roadmapService } from "@/services/roadmap.service";
import { ModalPortal } from "@/components/common/ModalPortal";
import type { Roadmap } from "@/types/roadmap";

interface LinkRoadmapModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  onLinked: (linkedRoadmapId: string) => void;
  /**
   * When provided, the modal uses the atomic replace-for-project flow:
   * the picked roadmap is linked AND the current empty roadmap is
   * deleted server-side in one call. Required when the project already
   * has an auto-created empty roadmap attached.
   */
  currentRoadmapId?: string;
}

export function LinkRoadmapModal({
  isOpen,
  onClose,
  projectId,
  onLinked,
  currentRoadmapId,
}: LinkRoadmapModalProps) {
  const [roadmaps, setRoadmaps] = useState<Roadmap[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [selectedRoadmapId, setSelectedRoadmapId] = useState<string | null>(null);
  const [showConfirmInfo, setShowConfirmInfo] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const loadRoadmaps = async () => {
        setIsLoading(true);
        try {
          const allRoadmaps = await roadmapService.getAll();
          // Filter roadmaps that are not linked to any project
          const unlinkedRoadmaps = allRoadmaps.filter(r => !r.project_id);
          setRoadmaps(unlinkedRoadmaps);
        } catch (error) {
          console.error("Failed to load roadmaps:", error);
        } finally {
          setIsLoading(false);
        }
      };
      loadRoadmaps();
    } else {
      setSelectedRoadmapId(null);
      setShowConfirmInfo(false);
      setErrorMessage(null);
    }
  }, [isOpen]);

  const handleLink = async () => {
    if (!selectedRoadmapId) return;

    setIsLinking(true);
    setErrorMessage(null);
    try {
      if (currentRoadmapId) {
        await roadmapService.replaceProjectRoadmap(
          projectId,
          selectedRoadmapId,
        );
      } else {
        await roadmapService.update(selectedRoadmapId, { project_id: projectId });
      }
      onLinked(selectedRoadmapId);
    } catch (error) {
      console.error("Failed to link roadmap:", error);
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to link roadmap.",
      );
    } finally {
      setIsLinking(false);
      setShowConfirmInfo(false);
    }
  };

  return (
    <ModalPortal>
    <>
      <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-9999 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Dialog */}
          <motion.div
             className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full p-8"
             initial={{ opacity: 0, scale: 0.9, y: 20 }}
             animate={{ opacity: 1, scale: 1, y: 0 }}
             exit={{ opacity: 0, scale: 0.9, y: 20 }}
             transition={{ duration: 0.3, ease: "easeOut" }}
          >
            {/* Close button */}
            <button
               onClick={onClose}
               className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
               aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Header */}
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Link Existing Roadmap</h2>
              <p className="text-gray-600">
                {currentRoadmapId
                  ? "Pick an existing roadmap to use for this project. The empty roadmap currently attached will be discarded."
                  : "Select an existing roadmap to link to this project. Only roadmaps that are not currently linked to a project are shown."}
              </p>
              {errorMessage && (
                <p className="mt-3 text-sm text-red-600">{errorMessage}</p>
              )}
            </div>

            {/* Content */}
            <div className="py-2 mb-6 text-left">
              {isLoading ? (
                <div className="flex justify-center items-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-[#ff9933]" />
                </div>
              ) : roadmaps.length === 0 ? (
                <div className="text-center py-8 text-gray-500 border rounded-lg border-dashed">
                  <Map className="w-8 h-8 mx-auto mb-3 opacity-20" />
                  <p>No unlinked roadmaps found.</p>
                  <p className="text-sm mt-1">Create a new roadmap instead.</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                  {roadmaps.map((roadmap) => (
                    <div
                       key={roadmap.id}
                       onClick={() => setSelectedRoadmapId(roadmap.id)}
                       className={`p-4 rounded-lg border cursor-pointer transition-all ${
                         selectedRoadmapId === roadmap.id
                           ? "border-[#ff9933] bg-[#ff9933]/5 ring-1 ring-[#ff9933]"
                           : "border-gray-200 hover:border-[#ff9933]/50"
                       }`}
                    >
                      <div className="font-semibold text-gray-900">{roadmap.name || "Untitled Roadmap"}</div>
                      {roadmap.description && (
                        <div className="text-sm text-gray-500 mt-1 line-clamp-2">{roadmap.description}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 justify-end">
              <button
                onClick={onClose}
                disabled={isLinking}
                className="px-6 py-2.5 text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg font-semibold transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                 onClick={() => setShowConfirmInfo(true)}
                 disabled={!selectedRoadmapId || isLinking}
                 className="flex items-center justify-center gap-2 px-6 py-2.5 bg-[#ff9933] text-white rounded-lg font-semibold hover:bg-[#e68829] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLinking ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Linking...
                  </>
                ) : (
                  "Link Roadmap"
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      <AnimatePresence>
      {showConfirmInfo && (
        <motion.div
           className="fixed inset-0 z-[10001] flex items-center justify-center p-4"
           initial={{ opacity: 0 }}
           animate={{ opacity: 1 }}
           exit={{ opacity: 0 }}
        >
          <motion.div
             className="absolute inset-0 bg-black/50 backdrop-blur-sm"
             initial={{ opacity: 0 }}
             animate={{ opacity: 1 }}
             exit={{ opacity: 0 }}
             onClick={() => setShowConfirmInfo(false)}
          />

          <motion.div
             className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center"
             initial={{ opacity: 0, scale: 0.9, y: 20 }}
             animate={{ opacity: 1, scale: 1, y: 0 }}
             exit={{ opacity: 0, scale: 0.9, y: 20 }}
             transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Map className="w-6 h-6 text-[#ff9933]" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Confirm Link</h3>
            <p className="text-gray-600 mb-6">
              {currentRoadmapId
                ? "Link this roadmap to the project and discard the current empty roadmap? This cannot be undone."
                : "Are you sure you want to link this roadmap to the project? This action cannot be undone."}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowConfirmInfo(false)}
                className="flex-1 px-4 py-2 text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg font-semibold transition-colors"
                disabled={isLinking}
              >
                Cancel
              </button>
              <button
                onClick={handleLink}
                className="flex-1 px-4 py-2 bg-[#ff9933] text-white rounded-lg font-semibold hover:bg-[#e68829] transition-all"
                disabled={isLinking}
              >
                 {isLinking ? <Loader2 className="w-5 h-5 mx-auto animate-spin" /> : "Confirm"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>
    </>
    </ModalPortal>
  );
}
