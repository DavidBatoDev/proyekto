import {
	closestCorners,
	DndContext,
	DragOverlay,
	type DragEndEvent,
	type DragOverEvent,
	type DragStartEvent,
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useRoadmapStore } from "@/stores/roadmapStore";
import { useToast } from "@/hooks/useToast";
import type { TaskStatus } from "@/types/roadmap";
import { KanbanCard } from "./KanbanCard";
import { KanbanColumn } from "./KanbanColumn";
import { KanbanFilters } from "./KanbanFilters";
import { KANBAN_COLUMNS, type KanbanTaskContext } from "./types";
import {
	applyBoardFilters,
	selectAllTasksWithContext,
} from "./selectors";

type ColumnMap = Record<TaskStatus, KanbanTaskContext[]>;

function groupRowsByStatus(rows: KanbanTaskContext[]): ColumnMap {
	const map = {} as ColumnMap;
	for (const column of KANBAN_COLUMNS) map[column.id] = [];
	for (const row of rows) {
		const bucket = map[row.task.status];
		if (bucket) bucket.push(row);
	}
	return map;
}

function findContainerForTask(
	columns: ColumnMap,
	taskId: string,
): TaskStatus | null {
	for (const column of KANBAN_COLUMNS) {
		if (columns[column.id].some((row) => row.task.id === taskId)) {
			return column.id;
		}
	}
	return null;
}

function resolveContainer(
	columns: ColumnMap,
	overId: string | null,
): TaskStatus | null {
	if (!overId) return null;
	if (KANBAN_COLUMNS.some((column) => column.id === overId)) {
		return overId as TaskStatus;
	}
	return findContainerForTask(columns, overId);
}

export function KanbanView() {
	const toast = useToast();
	const { epics, milestones, boardFilters, updateTaskStatusIntent } =
		useRoadmapStore(
			useShallow((s) => ({
				epics: s.epics,
				milestones: s.milestones,
				boardFilters: s.boardFilters,
				updateTaskStatusIntent: s.updateTaskStatusIntent,
			})),
		);

	const allRows = useMemo(
		() => selectAllTasksWithContext(epics, milestones),
		[epics, milestones],
	);
	const filteredRows = useMemo(
		() => applyBoardFilters(allRows, boardFilters),
		[allRows, boardFilters],
	);

	const storeColumns = useMemo(
		() => groupRowsByStatus(filteredRows),
		[filteredRows],
	);

	// Local mirror so cross-column drag-over can render movement before commit.
	const [columns, setColumns] = useState<ColumnMap>(storeColumns);
	const [activeId, setActiveId] = useState<string | null>(null);

	// Re-sync from store whenever not actively dragging.
	useEffect(() => {
		if (activeId === null) setColumns(storeColumns);
	}, [storeColumns, activeId]);

	const activeRow = useMemo<KanbanTaskContext | null>(() => {
		if (!activeId) return null;
		for (const column of KANBAN_COLUMNS) {
			const found = columns[column.id].find((row) => row.task.id === activeId);
			if (found) return found;
		}
		return null;
	}, [activeId, columns]);

	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 150, tolerance: 5 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const handleDragStart = (event: DragStartEvent) => {
		setActiveId(String(event.active.id));
	};

	const handleDragOver = (event: DragOverEvent) => {
		const { active, over } = event;
		if (!over) return;
		const activeTaskId = String(active.id);
		const overId = String(over.id);

		const fromColumn = findContainerForTask(columns, activeTaskId);
		const toColumn = resolveContainer(columns, overId);
		if (!fromColumn || !toColumn || fromColumn === toColumn) return;

		setColumns((prev) => {
			const sourceList = prev[fromColumn];
			const destList = prev[toColumn];
			const movingIndex = sourceList.findIndex(
				(row) => row.task.id === activeTaskId,
			);
			if (movingIndex === -1) return prev;
			const moving = sourceList[movingIndex];
			// Drop at end of column when hovering the column itself, otherwise
			// insert before the hovered card.
			const overIndex = destList.findIndex((row) => row.task.id === overId);
			const insertAt = overIndex === -1 ? destList.length : overIndex;
			return {
				...prev,
				[fromColumn]: sourceList.filter((_, i) => i !== movingIndex),
				[toColumn]: [
					...destList.slice(0, insertAt),
					moving,
					...destList.slice(insertAt),
				],
			};
		});
	};

	const handleDragEnd = (event: DragEndEvent) => {
		const { active } = event;
		const taskId = String(active.id);
		const finalColumn = findContainerForTask(columns, taskId);
		setActiveId(null);
		if (!finalColumn) return;

		const originalRow = filteredRows.find((row) => row.task.id === taskId);
		if (!originalRow || originalRow.task.status === finalColumn) return;

		void updateTaskStatusIntent(taskId, finalColumn).catch((error) => {
			toast.error(
				error instanceof Error
					? error.message
					: "Failed to update task status",
			);
		});
	};

	const handleDragCancel = () => {
		setActiveId(null);
		setColumns(storeColumns);
	};

	return (
		<div className="flex flex-col h-full bg-white">
			<KanbanFilters />
			<DndContext
				sensors={sensors}
				collisionDetection={closestCorners}
				onDragStart={handleDragStart}
				onDragOver={handleDragOver}
				onDragEnd={handleDragEnd}
				onDragCancel={handleDragCancel}
			>
				<div className="flex-1 overflow-x-auto">
					<div className="flex gap-3 p-3 h-full min-w-max">
						{KANBAN_COLUMNS.map((column) => (
							<KanbanColumn
								key={column.id}
								column={column}
								rows={columns[column.id]}
							/>
						))}
					</div>
				</div>
				<DragOverlay dropAnimation={{ duration: 200 }}>
					{activeRow ? <KanbanCard row={activeRow} overlay /> : null}
				</DragOverlay>
			</DndContext>
		</div>
	);
}
