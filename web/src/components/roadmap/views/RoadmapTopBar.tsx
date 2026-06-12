import {
  X,
  Share2,
  MessageCircle,
  LayoutGrid,
  CalendarDays,
  FileText,
} from "lucide-react";
import { useMemo } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { RoadmapEpic } from "@/types/roadmap";
import { useRoadmapStore } from "@/stores/roadmapStore";
import { useShallow } from "zustand/react/shallow";

const LEFT_PANEL_WIDTH = 320;

interface SortableEpicTabProps {
  epic: RoadmapEpic;
  isActive: boolean;
  onClick: () => void;
  onClose: () => void;
}

const SortableEpicTab = ({
  epic,
  isActive,
  onClick,
  onClose,
}: SortableEpicTabProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: epic.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 border-b-2 shrink-0 cursor-pointer transition-colors text-sm font-medium ${
        isActive
          ? "text-gray-900 border-gray-900"
          : "text-gray-600 hover:text-gray-900 border-transparent"
      }`}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing"
      >
        <span className="text-sm font-medium">{epic.title}</span>
      </div>
      <button
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className="p-0.5 rounded hover:bg-gray-200 transition-colors"
        aria-label="Close tab"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
};

interface RoadmapTopBarProps {
  onEditBrief?: () => void;
  onShare?: () => void;
  onOpenChatPanel?: () => void;
}

export function RoadmapTopBar({
  onEditBrief,
  onShare,
  onOpenChatPanel,
}: RoadmapTopBarProps) {
  const {
    epics,
    viewMode,
    selectedEpicId,
    openEpicTabs,
    setViewMode,
    setSelectedEpicId,
    setOpenEpicTabs,
    closeCanvasEpicTab,
  } = useRoadmapStore(
    useShallow((state) => ({
      epics: state.epics,
      viewMode: state.canvasViewMode,
      selectedEpicId: state.canvasSelectedEpicId,
      openEpicTabs: state.canvasOpenEpicTabs,
      setViewMode: state.setCanvasViewMode,
      setSelectedEpicId: state.setCanvasSelectedEpicId,
      setOpenEpicTabs: state.setCanvasOpenEpicTabs,
      closeCanvasEpicTab: state.closeCanvasEpicTab,
    })),
  );

  const epicById = useMemo(
    () => new Map(epics.map((epic) => [epic.id, epic])),
    [epics],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setOpenEpicTabs((tabs) => {
        const oldIndex = tabs.indexOf(active.id as string);
        const newIndex = tabs.indexOf(over.id as string);
        return arrayMove(tabs, oldIndex, newIndex);
      });
    }
  };

  return (
    <div className="bg-gray-100 border-b border-gray-200 flex items-center justify-between w-full shrink-0 z-10 overflow-hidden">
      <div className="flex items-center flex-1 min-w-0 h-full overflow-hidden">
        <div
          className="flex items-center shrink-0"
          style={{ width: LEFT_PANEL_WIDTH }}
        >
          <button
            onClick={() => {
              setViewMode("roadmap");
              setSelectedEpicId(null);
            }}
            className={`w-1/2 px-3 py-3 font-medium text-sm text-center transition-colors border-b-2 shrink-0 ${
              viewMode === "roadmap"
                ? "text-gray-900 border-gray-900"
                : "text-gray-600 hover:text-gray-900 border-transparent"
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <LayoutGrid className="w-4 h-4" />
              Roadmap
            </span>
          </button>
          <button
            onClick={() => setViewMode("milestones")}
            className={`w-1/2 px-3 py-3 font-medium text-sm text-center transition-colors border-b-2 shrink-0 ${
              viewMode === "milestones"
                ? "text-gray-900 border-gray-900"
                : "text-gray-600 hover:text-gray-900 border-transparent"
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="w-4 h-4" />
              Milestones
            </span>
          </button>
        </div>

        <div className="flex-1 min-w-0 overflow-x-auto no-scrollbar h-full">
          <div className="flex items-center h-full w-max min-w-full">
            {openEpicTabs.length > 0 && (
              <div className="h-8 w-px bg-gray-300 shrink-0" />
            )}

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={openEpicTabs}
                strategy={horizontalListSortingStrategy}
              >
                <div className="flex items-center gap-2">
                  {openEpicTabs.map((epicId) => {
                    const epic = epicById.get(epicId);
                    if (!epic) return null;

                    return (
                      <SortableEpicTab
                        key={epicId}
                        epic={epic}
                        isActive={
                          viewMode === "epic" && selectedEpicId === epicId
                        }
                        onClick={() => {
                          setSelectedEpicId(epicId);
                          setViewMode("epic");
                        }}
                        onClose={() => closeCanvasEpicTab(epicId)}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>

          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 px-6 py-2 border-l border-gray-200 bg-gray-100 shrink-0 shadow-sm relative z-20">
        {onEditBrief && (
          <button
            onClick={onEditBrief}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md transition-colors"
            title="Edit Roadmap"
          >
            <FileText className="w-4 h-4" />
            Edit Roadmap
          </button>
        )}

        {onShare && (
          <button
            onClick={onShare}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md transition-colors"
            title="Share Roadmap"
          >
            <Share2 className="w-4 h-4" />
            Share
          </button>
        )}

        {onOpenChatPanel && (
          <button
            onClick={onOpenChatPanel}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md transition-colors"
            title="Toggle AI chat panel"
          >
            <MessageCircle className="w-4 h-4" />
            AI Chat
          </button>
        )}
      </div>
    </div>
  );
}
