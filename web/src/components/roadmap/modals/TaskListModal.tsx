import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { RoadmapFeature, RoadmapTask, TaskStatus } from "@/types/roadmap";
import { TaskListItem } from "../widgets/TaskListItem";

interface TaskListModalProps {
  feature: RoadmapFeature;
  onClose: () => void;
  onSelectTask?: (task: RoadmapTask) => void;
  onUpdateTask?: (task: RoadmapTask) => void;
}

export function TaskListModal({
  feature,
  onClose,
  onSelectTask,
  onUpdateTask,
}: TaskListModalProps) {
  const tasks = feature.tasks ?? [];
  const doneCount = tasks.filter((t) => t.status === "done").length;

  const handleToggleComplete = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || !onUpdateTask) return;
    onUpdateTask({ ...task, status: task.status === "done" ? "todo" : "done" });
  };

  const handleUpdateStatus = (taskId: string, status: TaskStatus) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || !onUpdateTask) return;
    onUpdateTask({ ...task, status });
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-150 bg-black/30 flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
      >
        <motion.div
          className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden"
          initial={{ opacity: 0, scale: 0.94, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 12 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900 truncate">
                {feature.title}
              </h2>
              <p className="text-sm text-gray-400 mt-0.5">
                {doneCount}/{tasks.length} tasks done
              </p>
            </div>
            <button
              onClick={onClose}
              className="ml-4 p-1.5 hover:bg-gray-100 rounded-lg transition-colors shrink-0"
              title="Close"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Task list */}
          <div className="flex-1 overflow-y-auto py-1">
            {tasks.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-sm text-gray-400">
                No tasks yet
              </div>
            ) : (
              <div>
                {tasks.map((task) => (
                  <TaskListItem
                    key={task.id}
                    task={task}
                    density="normal"
                    onClick={onSelectTask}
                    onToggleComplete={
                      onUpdateTask ? handleToggleComplete : undefined
                    }
                    onUpdateStatus={
                      onUpdateTask ? handleUpdateStatus : undefined
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
