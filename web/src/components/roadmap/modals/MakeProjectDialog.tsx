import { motion, AnimatePresence } from "framer-motion";
import { Briefcase, X } from "lucide-react";
import { ModalPortal } from "@/components/common/ModalPortal";

interface MakeProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  roadmapName: string;
}

export function MakeProjectDialog({
  isOpen,
  onClose,
  onConfirm,
  roadmapName,
}: MakeProjectDialogProps) {
  return (
    <ModalPortal>
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
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

            {/* Icon */}
            <div className="w-16 h-16 bg-gradient-to-br from-orange-100 to-orange-200 rounded-full flex items-center justify-center mx-auto mb-6">
              <Briefcase className="w-8 h-8 text-orange-600" />
            </div>

            {/* Content */}
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-3">
                Make This a Project
              </h2>
              <p className="text-gray-600 mb-4">
                Making <span className="font-semibold text-gray-900">"{roadmapName}"</span> into a project requires professional consultants and a team to bring your vision to life.
              </p>
              <p className="text-gray-600">
                You'll be able to post your project details and receive bids from qualified consultants who can help execute your roadmap.
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-6 py-3 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-lg font-semibold hover:shadow-lg transition-all"
              >
                Bid to Consultants
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </ModalPortal>
  );
}
