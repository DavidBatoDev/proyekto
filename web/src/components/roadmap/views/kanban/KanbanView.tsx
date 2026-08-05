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
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
	type KanbanBoardFilters,
	useRoadmapStore,
} from "@/stores/roadmapStore";
import { useToast } from "@/hooks/useToast";
import { KanbanCard } from "./KanbanCard";
import { KanbanColumn } from "./KanbanColumn";
import { KanbanFilters } from "./KanbanFilters";
import { KanbanListView } from "./KanbanListView";
import { DEFAULT_KANBAN_COLUMNS, type KanbanTaskContext } from "./types";
import {
	applyBoardFilters,
	applyBoardSearch,
	selectAllTasksWithContext,
} from "./selectors";

type ColumnMap = Record<string, KanbanTaskContext[]>;

function emptyBoardFilters(): KanbanBoardFilters {
	return {
		epicIds: [],
		featureIds: [],
		milestoneIds: [],
		assigneeIds: [],
	};
}

function loadBoardFilters(raw: string | null): KanbanBoardFilters {
	if (!raw) return emptyBoardFilters();
	const stored = JSON.parse(raw) as Partial<KanbanBoardFilters> | null;
	if (!stored || typeof stored !== "object") return emptyBoardFilters();
	return {
		epicIds: stored.epicIds ?? [],
		featureIds: stored.featureIds ?? [],
		milestoneIds: stored.milestoneIds ?? [],
		assigneeIds: stored.assigneeIds ?? [],
	};
}

function groupByStatus(rows: KanbanTaskContext[]): ColumnMap {
	const map: ColumnMap = {};
	for (const column of DEFAULT_KANBAN_COLUMNS) map[column.id] = [];
	for (const row of rows) {
		const columnId = row.task.status as string;
		if (!map[columnId]) map[columnId] = [];
		map[columnId].push(row);
	}
	// Stable sort: ties (e.g. board_order collisions from AI-created tasks)
	// keep their epic -> feature -> task traversal order instead of jumping
	// around on every re-render.
	for (const columnId of Object.keys(map)) {
		map[columnId]?.sort((a, b) => a.task.board_order - b.task.board_order);
	}
	return map;
}

function findContainerForTask(
	columns: ColumnMap,
	taskId: string,
): string | null {
	for (const columnId of Object.keys(columns)) {
		if (columns[columnId]?.some((row) => row.task.id === taskId)) {
			return columnId;
		}
	}
	return null;
}

function resolveContainer(
	columns: ColumnMap,
	overId: string | null,
): string | null {
	if (!overId) return null;
	if (overId in columns) return overId;
	return findContainerForTask(columns, overId);
}

export function KanbanView() {
	const toast = useToast();
	const {
		epics,
		milestones,
		boardFilters,
		reorderTasksInColumn,
		moveTaskToColumn,
		setBoardFilters,
	} = useRoadmapStore(
		useShallow((s) => ({
			epics: s.epics,
			milestones: s.milestones,
			boardFilters: s.boardFilters,
			reorderTasksInColumn: s.reorderTasksInColumn,
			moveTaskToColumn: s.moveTaskToColumn,
			setBoardFilters: s.setBoardFilters,
		})),
	);
	const roadmapId = useRoadmapStore((s) => s.roadmap?.id ?? "");
	// Ephemeral free-text search — intentionally NOT persisted.
	const [searchQuery, setSearchQuery] = useState("");

	// Restore persisted filters when roadmap changes
	useEffect(() => {
		if (!roadmapId) return;
		try {
			const raw = sessionStorage.getItem(`wi_filters_${roadmapId}`);
			setBoardFilters(loadBoardFilters(raw));
		} catch {
			setBoardFilters(emptyBoardFilters());
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [roadmapId]);

	// Persist filters whenever they change
	useEffect(() => {
		if (!roadmapId) return;
		try {
			sessionStorage.setItem(
				`wi_filters_${roadmapId}`,
				JSON.stringify(boardFilters),
			);
		} catch {}
	}, [roadmapId, boardFilters]);

	const allRows = useMemo(
		() => selectAllTasksWithContext(epics, milestones),
		[epics, milestones],
	);
	const filteredRows = useMemo(
		() =>
			applyBoardSearch(applyBoardFilters(allRows, boardFilters), searchQuery),
		[allRows, boardFilters, searchQuery],
	);

	const storeColumns = useMemo(
		() => groupByStatus(filteredRows),
		[filteredRows],
	);

	const [columns, setColumns] = useState<ColumnMap>(storeColumns);
	const [activeId, setActiveId] = useState<string | null>(null);

	useEffect(() => {
		if (activeId === null) setColumns(storeColumns);
	}, [storeColumns, activeId]);

	const activeRow = useMemo<KanbanTaskContext | null>(() => {
		if (!activeId) return null;
		for (const columnId of Object.keys(columns)) {
			const found = columns[columnId]?.find((row) => row.task.id === activeId);
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
		if (activeTaskId === overId) return;

		const fromColumn = findContainerForTask(columns, activeTaskId);
		const toColumn = resolveContainer(columns, overId);
		if (!fromColumn || !toColumn) return;

		if (fromColumn === toColumn) {
			setColumns((prev) => {
				const list = prev[fromColumn] ?? [];
				const activeIndex = list.findIndex(
					(row) => row.task.id === activeTaskId,
				);
				const overIndex = list.findIndex((row) => row.task.id === overId);
				if (
					activeIndex === -1 ||
					overIndex === -1 ||
					activeIndex === overIndex
				) {
					return prev;
				}
				return {
					...prev,
					[fromColumn]: arrayMove(list, activeIndex, overIndex),
				};
			});
			return;
		}

		setColumns((prev) => {
			const sourceList = prev[fromColumn] ?? [];
			const destList = prev[toColumn] ?? [];
			const movingIndex = sourceList.findIndex(
				(row) => row.task.id === activeTaskId,
			);
			if (movingIndex === -1) return prev;
			const moving = sourceList[movingIndex];
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
		const finalColumnId = findContainerForTask(columns, taskId);
		setActiveId(null);
		if (!finalColumnId) return;

		const finalColumn = DEFAULT_KANBAN_COLUMNS.find(
			(c) => c.id === finalColumnId,
		);
		if (!finalColumn) return;

		const originalRow = filteredRows.find((row) => row.task.id === taskId);
		if (!originalRow) return;

		const orderedIds = (columns[finalColumnId] ?? []).map((row) => row.task.id);

		const handleError = (error: unknown) => {
			toast.error(
				error instanceof Error ? error.message : "Failed to update task order",
			);
		};

		if (originalRow.task.status === finalColumn.bucketStatus) {
			// Same column: only persist if the drag actually changed the order.
			const currentOrder = (storeColumns[finalColumnId] ?? []).map(
				(row) => row.task.id,
			);
			const orderChanged =
				currentOrder.length !== orderedIds.length ||
				currentOrder.some((id, index) => id !== orderedIds[index]);
			if (!orderChanged) return;
			void reorderTasksInColumn(
				roadmapId,
				finalColumn.bucketStatus,
				orderedIds,
			).catch(handleError);
			return;
		}

		void moveTaskToColumn(taskId, finalColumn.bucketStatus, orderedIds).catch(
			handleError,
		);
	};

	const handleDragCancel = () => {
		setActiveId(null);
		setColumns(storeColumns);
	};

	return (
		<div className="flex flex-col h-full bg-background text-foreground">
			<KanbanFilters
				searchQuery={searchQuery}
				onSearchChange={setSearchQuery}
			/>

			{/* Mobile: grouped list view */}
			<div className="flex-1 min-h-0 overflow-y-auto md:hidden">
				<KanbanListView rows={filteredRows} />
			</div>

			{/* Desktop: drag-and-drop kanban board */}
			<div className="hidden md:flex flex-col flex-1 min-h-0">
				<DndContext
					sensors={sensors}
					collisionDetection={closestCorners}
					onDragStart={handleDragStart}
					onDragOver={handleDragOver}
					onDragEnd={handleDragEnd}
					onDragCancel={handleDragCancel}
				>
					<div className="flex-1 overflow-x-auto overflow-y-hidden">
						<div className="flex gap-2 p-2 h-full w-full">
							{DEFAULT_KANBAN_COLUMNS.map((column) => (
								<KanbanColumn
									key={column.id}
									column={column}
									rows={columns[column.id] ?? []}
								/>
							))}
						</div>
					</div>
					<DragOverlay dropAnimation={{ duration: 200 }}>
						{activeRow ? <KanbanCard row={activeRow} overlay /> : null}
					</DragOverlay>
				</DndContext>
			</div>
		</div>
	);
}
