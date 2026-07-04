import { useState, useEffect, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createPortal } from "react-dom";
import { GripVertical } from "lucide-react";
import type { RoadmapTask, TaskStatus } from "@/types/roadmap";
import { TaskListItem } from "./TaskListItem";
import type { CollaboratorInfo } from "@/hooks/useRoadmapCollaboration";

interface TaskItemSharedProps {
  density?: "normal" | "compact";
  onDelete?: (taskId: string) => void;
  onClick?: (task: RoadmapTask) => void;
  onToggleComplete?: (taskId: string) => void;
  onUpdateStatus?: (taskId: string, status: TaskStatus) => void;
}

// Lightweight floating preview — deliberately NOT a full TaskListItem so we
// don't mount store subscriptions / member queries mid-drag (that jank was
// disrupting the very first grab).
function TaskDragOverlay({
  task,
  density,
}: {
  task: RoadmapTask;
  density?: "normal" | "compact";
}) {
  const isCompact = density === "compact";
  return (
    <div
      className={`flex items-center gap-2 rounded-lg bg-white shadow-xl ring-1 ring-gray-200 ${
        isCompact ? "px-2 py-1 text-xs" : "px-4 py-2 text-sm"
      }`}
    >
      <GripVertical className="w-4 h-4 text-gray-300 shrink-0" />
      <span className="font-medium text-gray-900 truncate">{task.title}</span>
    </div>
  );
}

interface SortableTaskListItemProps extends TaskItemSharedProps {
  task: RoadmapTask;
  pulseToken?: number;
  isRunning?: boolean;
  editors?: CollaboratorInfo[];
}

function SortableTaskListItem({ task, ...props }: SortableTaskListItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0 : 1,
        position: "relative",
      }}
    >
      <TaskListItem
        task={task}
        dragHandleProps={{ attributes, listeners, setActivatorNodeRef }}
        {...props}
      />
    </div>
  );
}

interface SortableTaskListProps extends TaskItemSharedProps {
  tasks: RoadmapTask[];
  featureId: string;
  onReorder: (featureId: string, orderedTaskIds: string[]) => void;
  pulseTaskId?: string | null;
  pulseTaskToken?: number;
  runningTaskId?: string | null;
  taskEditorsByNodeId?: Map<string, CollaboratorInfo[]>;
}

export function SortableTaskList({
  tasks,
  featureId,
  density = "normal",
  onReorder,
  onDelete,
  onClick,
  onToggleComplete,
  onUpdateStatus,
  pulseTaskId,
  pulseTaskToken,
  runningTaskId,
  taskEditorsByNodeId,
}: SortableTaskListProps) {
  // Local copy so reorder is instant without waiting for store propagation
  const [localTasks, setLocalTasks] = useState(tasks);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Sync from parent when tasks change externally (new task, status change,
  // etc.) — but never mid-drag, or the list would jump under the cursor.
  useEffect(() => {
    if (!activeId) {
      setLocalTasks(tasks);
    }
  }, [tasks, activeId]);

  const activeTask = activeId ? localTasks.find((t) => t.id === activeId) : null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // TaskListItem registers a SECOND droppable per row (`task-drop-<id>`, for
  // drag-to-assign) in this same DndContext. Left unfiltered, closestCenter
  // resolves `over` to that droppable, so `over.id` is never a task id — which
  // kills both the make-space animation and the reorder. Restrict collision to
  // the sortable task ids only.
  const taskIdSet = useMemo(
    () => new Set(localTasks.map((t) => t.id)),
    [localTasks],
  );
  const collisionDetection: CollisionDetection = (args) =>
    closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) =>
        taskIdSet.has(String(c.id)),
      ),
    });

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localTasks.findIndex((t) => t.id === active.id);
    const newIndex = localTasks.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(localTasks, oldIndex, newIndex);
    setLocalTasks(reordered); // instant visual update
    onReorder(
      featureId,
      reordered.map((t) => t.id),
    );
  };

  const sharedProps: TaskItemSharedProps = {
    density,
    onDelete,
    onClick,
    onToggleComplete,
    onUpdateStatus,
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext
        items={localTasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        {localTasks.map((task) => (
          <SortableTaskListItem
            key={task.id}
            task={task}
            pulseToken={pulseTaskId === task.id ? pulseTaskToken : undefined}
            isRunning={runningTaskId === task.id}
            editors={taskEditorsByNodeId?.get(task.id)}
            {...sharedProps}
          />
        ))}
      </SortableContext>

      {createPortal(
        <DragOverlay>
          {activeTask ? (
            <TaskDragOverlay task={activeTask} density={density} />
          ) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}
