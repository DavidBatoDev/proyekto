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
import type { TaskStatus, WorkflowColumn } from "@/types/roadmap";
import { KanbanCard } from "./KanbanCard";
import { KanbanColumn } from "./KanbanColumn";
import { KanbanFilters } from "./KanbanFilters";
import {
	DEFAULT_KANBAN_COLUMNS,
	type KanbanColumnDef,
	type KanbanTaskContext,
} from "./types";
import {
	applyBoardFilters,
	selectAllTasksWithContext,
} from "./selectors";

type ColumnMap = Record<string, KanbanTaskContext[]>;

const ACCENT_CLASS_BY_BUCKET: Record<TaskStatus, string> = {
	todo: "bg-gray-400",
	in_progress: "bg-blue-500",
	in_review: "bg-amber-500",
	done: "bg-emerald-500",
	blocked: "bg-red-500",
};

function buildKanbanColumns(
	workflowColumns: WorkflowColumn[] | undefined,
): KanbanColumnDef[] {
	if (!Array.isArray(workflowColumns) || workflowColumns.length === 0) {
		return DEFAULT_KANBAN_COLUMNS;
	}

	return [...workflowColumns]
		.sort((a, b) => {
			if (a.position !== b.position) return a.position - b.position;
			return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
		})
		.map((column) => ({
			id: column.id,
			label: column.name,
			accent: ACCENT_CLASS_BY_BUCKET[column.bucket_status] ?? "bg-slate-400",
			bucketStatus: column.bucket_status,
			color: column.color,
			isSystem: column.is_system,
		}));
}

function firstColumnByBucket(columns: KanbanColumnDef[]): Map<TaskStatus, string> {
	const map = new Map<TaskStatus, string>();
	for (const column of columns) {
		if (!map.has(column.bucketStatus)) {
			map.set(column.bucketStatus, column.id);
		}
	}
	const firstColumnId = columns[0]?.id;
	if (firstColumnId) {
		const statuses: TaskStatus[] = [
			"todo",
			"in_progress",
			"in_review",
			"done",
			"blocked",
		];
		for (const status of statuses) {
			if (!map.has(status)) {
				map.set(status, firstColumnId);
			}
		}
	}
	return map;
}

function groupRowsByColumn(
	rows: KanbanTaskContext[],
	columns: KanbanColumnDef[],
): ColumnMap {
	const map: ColumnMap = {};
	for (const column of columns) map[column.id] = [];

	const knownColumnIds = new Set(columns.map((column) => column.id));
	const fallbackColumnByBucket = firstColumnByBucket(columns);

	for (const row of rows) {
		const explicitColumnId = row.task.workflow_column_id;
		const targetColumnId =
			explicitColumnId && knownColumnIds.has(explicitColumnId)
				? explicitColumnId
				: fallbackColumnByBucket.get(row.task.status) ?? columns[0]?.id;
		if (!targetColumnId) continue;
		if (!map[targetColumnId]) map[targetColumnId] = [];
		map[targetColumnId].push(row);
	}

	return map;
}

function findContainerForTask(
	columns: ColumnMap,
	taskId: string,
	columnDefs: KanbanColumnDef[],
): string | null {
	for (const column of columnDefs) {
		if (columns[column.id]?.some((row) => row.task.id === taskId)) {
			return column.id;
		}
	}
	return null;
}

function resolveContainer(
	columns: ColumnMap,
	overId: string | null,
	columnDefs: KanbanColumnDef[],
): string | null {
	if (!overId) return null;
	if (columnDefs.some((column) => column.id === overId)) {
		return overId;
	}
	return findContainerForTask(columns, overId, columnDefs);
}

export function KanbanView() {
	const toast = useToast();
	const { roadmap, epics, milestones, boardFilters, updateTaskStatusIntent } =
		useRoadmapStore(
			useShallow((s) => ({
				roadmap: s.roadmap,
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

	const kanbanColumns = useMemo(
		() => buildKanbanColumns(roadmap?.workflow_columns),
		[roadmap?.workflow_columns],
	);
	const columnsById = useMemo(
		() =>
			new Map<string, KanbanColumnDef>(
				kanbanColumns.map((column) => [column.id, column]),
			),
		[kanbanColumns],
	);

	const storeColumns = useMemo(
		() => groupRowsByColumn(filteredRows, kanbanColumns),
		[filteredRows, kanbanColumns],
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
		for (const column of kanbanColumns) {
			const found = columns[column.id]?.find((row) => row.task.id === activeId);
			if (found) return found;
		}
		return null;
	}, [activeId, columns, kanbanColumns]);

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

		const fromColumn = findContainerForTask(columns, activeTaskId, kanbanColumns);
		const toColumn = resolveContainer(columns, overId, kanbanColumns);
		if (!fromColumn || !toColumn || fromColumn === toColumn) return;

		setColumns((prev) => {
			const sourceList = prev[fromColumn] ?? [];
			const destList = prev[toColumn] ?? [];
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
		const finalColumnId = findContainerForTask(columns, taskId, kanbanColumns);
		setActiveId(null);
		if (!finalColumnId) return;

		const finalColumn = columnsById.get(finalColumnId);
		if (!finalColumn) return;

		const originalRow = filteredRows.find((row) => row.task.id === taskId);
		if (!originalRow) return;

		const unchanged =
			originalRow.task.status === finalColumn.bucketStatus &&
			(originalRow.task.workflow_column_id ?? null) === finalColumn.id;
		if (unchanged) return;

		void updateTaskStatusIntent(taskId, finalColumn.bucketStatus, {
			workflowColumnId: finalColumn.id,
		}).catch((error) => {
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
				<div className="flex-1 overflow-x-hidden overflow-y-hidden">
					<div className="flex gap-2 p-2 h-full w-full">
						{kanbanColumns.map((column) => (
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
	);
}
