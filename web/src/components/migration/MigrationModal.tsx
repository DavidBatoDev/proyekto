import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, Trash2 } from "lucide-react";
import { ModalPortal } from "@/components/common/ModalPortal";
import type { Roadmap } from "@/types/roadmap";

interface MigrationModalProps {
  isOpen: boolean;
  roadmaps: Roadmap[];
  onCreateProject: () => void;
  onDiscard: () => void;
}

export function MigrationModal({
  isOpen,
  roadmaps,
  onCreateProject,
  onDiscard,
}: MigrationModalProps) {
  const primaryRoadmap = roadmaps[0];

  return (
    <ModalPortal>
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/50"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div
                className="pointer-events-auto w-full max-w-lg rounded-2xl bg-white p-8 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="mb-6 flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white">
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">
                      We found an unfinished roadmap.
                    </h2>
                    <p className="text-sm text-gray-600">
                      You created it before signing in.
                    </p>
                  </div>
                </div>

                {primaryRoadmap && (
                  <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <p className="font-semibold text-gray-900">
                      {primaryRoadmap.name}
                    </p>
                    {primaryRoadmap.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-gray-600">
                        {primaryRoadmap.description}
                      </p>
                    )}
                    {roadmaps.length > 1 && (
                      <p className="mt-2 text-xs font-medium text-gray-500">
                        {roadmaps.length - 1} more guest roadmap
                        {roadmaps.length === 2 ? "" : "s"} available.
                      </p>
                    )}
                  </div>
                )}

                <p className="mb-6 text-sm leading-6 text-gray-700">
                  Turn it into a collaborative project now, or discard this
                  browser's guest recovery state.
                </p>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={onCreateProject}
                    className="inline-flex flex-1 items-center justify-center rounded-full bg-slate-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-800"
                  >
                    Create Project
                  </button>
                  <button
                    type="button"
                    onClick={onDiscard}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-gray-300 px-5 py-3 text-sm font-bold text-gray-700 transition hover:border-gray-500 hover:bg-gray-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    Discard
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </ModalPortal>
  );
}
