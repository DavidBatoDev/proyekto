import { arrayMove } from "@dnd-kit/sortable";
import type { TaskStatus } from "@/types/roadmap";
import { DEFAULT_KANBAN_COLUMNS, type KanbanTaskContext } from "./types";

export type GlobalKanbanColumnMap = Record<string, KanbanTaskContext[]>;

export function groupGlobalRowsByStatus(
	rows: KanbanTaskContext[],
): GlobalKanbanColumnMap {
	const columns: GlobalKanbanColumnMap = {};
	for (const column of DEFAULT_KANBAN_COLUMNS) columns[column.id] = [];
	for (const row of rows) {
		const bucket = columns[row.task.status];
		if (bucket) bucket.push(row);
	}

	// The all-full endpoint normalizes tasks by their feature-list position.
	// Kanban order is a separate axis, so restore the persisted board order here.
	for (const columnId of Object.keys(columns)) {
		columns[columnId]?.sort((a, b) => a.task.board_order - b.task.board_order);
	}
	return columns;
}

export function findGlobalTaskColumn(
	columns: GlobalKanbanColumnMap,
	taskId: string,
): TaskStatus | null {
	for (const column of DEFAULT_KANBAN_COLUMNS) {
		if (columns[column.id]?.some((row) => row.task.id === taskId)) {
			return column.id as TaskStatus;
		}
	}
	return null;
}

function resolveGlobalTaskColumn(
	columns: GlobalKanbanColumnMap,
	overId: string,
): TaskStatus | null {
	if (DEFAULT_KANBAN_COLUMNS.some((column) => column.id === overId)) {
		return overId as TaskStatus;
	}
	return findGlobalTaskColumn(columns, overId);
}

export function moveGlobalTaskForDrag(
	columns: GlobalKanbanColumnMap,
	activeTaskId: string,
	overId: string,
): GlobalKanbanColumnMap {
	if (activeTaskId === overId) return columns;

	const fromColumn = findGlobalTaskColumn(columns, activeTaskId);
	const toColumn = resolveGlobalTaskColumn(columns, overId);
	if (!fromColumn || !toColumn) return columns;

	const sourceList = columns[fromColumn] ?? [];
	const activeIndex = sourceList.findIndex(
		(row) => row.task.id === activeTaskId,
	);
	if (activeIndex === -1) return columns;

	if (fromColumn === toColumn) {
		const overIndex = sourceList.findIndex((row) => row.task.id === overId);
		if (overIndex === -1 || activeIndex === overIndex) return columns;
		return {
			...columns,
			[fromColumn]: arrayMove(sourceList, activeIndex, overIndex),
		};
	}

	const destinationList = columns[toColumn] ?? [];
	const moving = sourceList[activeIndex];
	const overIndex = destinationList.findIndex((row) => row.task.id === overId);
	const insertAt = overIndex === -1 ? destinationList.length : overIndex;
	return {
		...columns,
		[fromColumn]: sourceList.filter((_, index) => index !== activeIndex),
		[toColumn]: [
			...destinationList.slice(0, insertAt),
			moving,
			...destinationList.slice(insertAt),
		],
	};
}

export function roadmapTaskIds(
	rows: KanbanTaskContext[],
	roadmapId: string,
): string[] {
	return rows
		.filter((row) => row.roadmapId === roadmapId)
		.map((row) => row.task.id);
}
