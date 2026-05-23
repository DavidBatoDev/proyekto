import {
	closestCorners,
	DndContext,
	type DragEndEvent,
	type DragOverEvent,
	DragOverlay,
	type DragStartEvent,
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/useToast";
import type { FullRoadmapWithProject } from "@/services/roadmap.service";
import { taskService } from "@/services/roadmap.service";
import { useUser } from "@/stores/authStore";
import type { TaskStatus } from "@/types/roadmap";
import { GlobalKanbanFilters } from "./GlobalKanbanFilters";
import { KanbanCard } from "./KanbanCard";
import { KanbanColumn } from "./KanbanColumn";
import { KANBAN_COLUMNS, type KanbanTaskContext } from "./types";

export interface GlobalBoardFilters {
	projectId: string | null;
	epicId: string | null;
	featureId: string | null;
	assigneeIds: string[];
}

const EMPTY_FILTERS: GlobalBoardFilters = {
	projectId: null,
	epicId: null,
	featureId: null,
	assigneeIds: [],
};

type ColumnMap = Record<TaskStatus, KanbanTaskContext[]>;

function buildAllRows(roadmaps: FullRoadmapWithProject[]): KanbanTaskContext[] {
	const result: KanbanTaskContext[] = [];
	for (const roadmap of roadmaps) {
		const milestoneByFeatureId = new Map<
			string,
			(typeof roadmap.milestones)[0]
		>();
		for (const milestone of roadmap.milestones ?? []) {
			for (const lf of milestone.linked_features ?? []) {
				milestoneByFeatureId.set(lf.id, milestone);
			}
		}
		for (const epic of roadmap.epics ?? []) {
			for (const feature of epic.features ?? []) {
				const milestone = milestoneByFeatureId.get(feature.id) ?? null;
				for (const task of feature.tasks ?? []) {
					result.push({
						task,
						feature,
						epic,
						milestone,
						project: roadmap.project,
						roadmapId: roadmap.id,
					});
				}
			}
		}
	}
	return result;
}

function applyFilters(
	rows: KanbanTaskContext[],
	filters: GlobalBoardFilters,
): KanbanTaskContext[] {
	return rows.filter((row) => {
		if (filters.projectId && row.project?.id !== filters.projectId)
			return false;
		if (filters.epicId && row.epic.id !== filters.epicId) return false;
		if (filters.featureId && row.feature.id !== filters.featureId) return false;
		if (filters.assigneeIds.length) {
			const aid = row.task.assignee_id ?? null;
			if (!aid || !filters.assigneeIds.includes(aid)) return false;
		}
		return true;
	});
}

function groupByStatus(rows: KanbanTaskContext[]): ColumnMap {
	const map = {} as ColumnMap;
	for (const col of KANBAN_COLUMNS) map[col.id] = [];
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
	for (const col of KANBAN_COLUMNS) {
		if (columns[col.id].some((r) => r.task.id === taskId)) return col.id;
	}
	return null;
}

function resolveContainer(
	columns: ColumnMap,
	overId: string | null,
): TaskStatus | null {
	if (!overId) return null;
	if (KANBAN_COLUMNS.some((c) => c.id === overId)) return overId as TaskStatus;
	return findContainerForTask(columns, overId);
}

interface GlobalKanbanViewProps {
	roadmaps: FullRoadmapWithProject[];
}

export function GlobalKanbanView({ roadmaps }: GlobalKanbanViewProps) {
	const toast = useToast();
	const navigate = useNavigate();
	const currentUser = useUser();
	const [filters, setFilters] = useState<GlobalBoardFilters>(() => ({
		...EMPTY_FILTERS,
		assigneeIds: currentUser?.id ? [currentUser.id] : [],
	}));
	const [localRows, setLocalRows] = useState<KanbanTaskContext[]>([]);

	const allRows = useMemo(() => buildAllRows(roadmaps), [roadmaps]);

	// Sync local rows from the query data whenever not dragging
	const [activeId, setActiveId] = useState<string | null>(null);
	useEffect(() => {
		if (activeId === null) setLocalRows(allRows);
	}, [allRows, activeId]);

	const filteredRows = useMemo(
		() => applyFilters(activeId === null ? allRows : localRows, filters),
		[allRows, localRows, filters, activeId],
	);

	const storeColumns = useMemo(
		() => groupByStatus(filteredRows),
		[filteredRows],
	);
	const [columns, setColumns] = useState<ColumnMap>(storeColumns);

	useEffect(() => {
		if (activeId === null) setColumns(storeColumns);
	}, [storeColumns, activeId]);

	const activeRow = useMemo<KanbanTaskContext | null>(() => {
		if (!activeId) return null;
		for (const col of KANBAN_COLUMNS) {
			const found = columns[col.id].find((r) => r.task.id === activeId);
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
				(r) => r.task.id === activeTaskId,
			);
			if (movingIndex === -1) return prev;
			const moving = sourceList[movingIndex];
			const overIndex = destList.findIndex((r) => r.task.id === overId);
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

		const originalRow = allRows.find((r) => r.task.id === taskId);
		if (!originalRow || originalRow.task.status === finalColumn) return;

		// Optimistic update
		setLocalRows((prev) =>
			prev.map((r) =>
				r.task.id === taskId
					? { ...r, task: { ...r.task, status: finalColumn } }
					: r,
			),
		);

		taskService.update(taskId, { status: finalColumn }).catch((error) => {
			// Rollback
			setLocalRows((prev) =>
				prev.map((r) =>
					r.task.id === taskId
						? { ...r, task: { ...r.task, status: originalRow.task.status } }
						: r,
				),
			);
			toast.error(
				error instanceof Error ? error.message : "Failed to update task status",
			);
		});
	};

	const handleDragCancel = () => {
		setActiveId(null);
		setColumns(storeColumns);
	};

	const handleCardClick = (taskId: string) => {
		const row = allRows.find((r) => r.task.id === taskId);
		if (!row?.project?.id || !row.roadmapId) return;
		void navigate({
			to: "/project/$projectId/work-items/$roadmapId",
			params: { projectId: row.project.id, roadmapId: row.roadmapId },
		});
	};

	return (
		<div className="flex flex-col h-full bg-white">
			<GlobalKanbanFilters
				roadmaps={roadmaps}
				filters={filters}
				onChange={setFilters}
			/>
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
						{KANBAN_COLUMNS.map((column) => (
							<KanbanColumn
								key={column.id}
								column={column}
								rows={columns[column.id]}
								onCardClick={handleCardClick}
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
