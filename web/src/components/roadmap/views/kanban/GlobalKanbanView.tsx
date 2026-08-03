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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/hooks/useToast";
import type { FullRoadmapWithProject } from "@/services/roadmap.service";
import { taskService } from "@/services/roadmap.service";
import type { TaskStatus } from "@/types/roadmap";
import { GlobalKanbanFilters } from "./GlobalKanbanFilters";
import {
	applyFilters,
	applySearch,
	GLOBAL_FILTERS_KEY,
	type GlobalBoardFilters,
	loadGlobalFilters,
	resolveFilters,
} from "./globalBoardFilters";
import {
	findGlobalTaskColumn,
	type GlobalKanbanColumnMap,
	groupGlobalRowsByStatus,
	moveGlobalTaskForDrag,
	roadmapTaskIds,
} from "./globalKanbanOrdering";
import { KanbanCard } from "./KanbanCard";
import { KanbanColumn } from "./KanbanColumn";
import { DEFAULT_KANBAN_COLUMNS, type KanbanTaskContext } from "./types";

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

// Board order is persisted per roadmap, not across roadmaps. Preserve the
// aggregate order already established by a drag while fresh row objects arrive,
// and append only genuinely new rows.
function reconcileColumns(
	prev: GlobalKanbanColumnMap,
	next: GlobalKanbanColumnMap,
): GlobalKanbanColumnMap {
	const result: GlobalKanbanColumnMap = {};
	for (const columnId of Object.keys(next)) {
		const nextById = new Map(
			(next[columnId] ?? []).map((row) => [row.task.id, row]),
		);
		const kept: KanbanTaskContext[] = [];
		for (const row of prev[columnId] ?? []) {
			const fresh = nextById.get(row.task.id);
			if (fresh) {
				kept.push(fresh);
				nextById.delete(row.task.id);
			}
		}
		kept.push(...nextById.values());
		result[columnId] = kept;
	}
	return result;
}

interface GlobalKanbanViewProps {
	roadmaps: FullRoadmapWithProject[];
	onActiveRoadmapChange?: (roadmap: FullRoadmapWithProject | null) => void;
	onTaskClick?: (row: KanbanTaskContext) => void;
}

export function GlobalKanbanView({
	roadmaps,
	onActiveRoadmapChange,
	onTaskClick,
}: GlobalKanbanViewProps) {
	const toast = useToast();
	const [filters, setFilters] = useState<GlobalBoardFilters>(loadGlobalFilters);
	// Ephemeral free-text search — intentionally NOT persisted, so the board
	// isn't mysteriously filtered on the next visit.
	const [searchQuery, setSearchQuery] = useState("");

	const effectiveFilters = useMemo<GlobalBoardFilters>(
		() => resolveFilters(filters, roadmaps),
		[filters, roadmaps],
	);
	const effectiveProjectId = effectiveFilters.projectId;

	useEffect(() => {
		try {
			sessionStorage.setItem(
				GLOBAL_FILTERS_KEY,
				JSON.stringify(effectiveFilters),
			);
		} catch {}
	}, [effectiveFilters]);

	useEffect(() => {
		if (!onActiveRoadmapChange) return;
		if (roadmaps.length === 1) {
			onActiveRoadmapChange(roadmaps[0]);
			return;
		}
		const active = effectiveProjectId
			? (roadmaps.find((r) => r.project?.id === effectiveProjectId) ?? null)
			: null;
		onActiveRoadmapChange(active);
	}, [effectiveProjectId, roadmaps, onActiveRoadmapChange]);

	const [localRows, setLocalRows] = useState<KanbanTaskContext[]>([]);
	const allRows = useMemo(() => buildAllRows(roadmaps), [roadmaps]);

	// Tracks in-flight status updates so a background refetch can't overwrite them.
	const pendingUpdates = useRef(new Map<string, TaskStatus>());

	// Sync from server data; preserve any in-flight optimistic statuses.
	const [activeId, setActiveId] = useState<string | null>(null);
	useEffect(() => {
		setLocalRows(
			allRows.map((row) => {
				const pending = pendingUpdates.current.get(row.task.id);
				return pending !== undefined
					? { ...row, task: { ...row.task, status: pending } }
					: row;
			}),
		);
	}, [allRows]);

	const filteredRows = useMemo(
		() => applySearch(applyFilters(localRows, effectiveFilters), searchQuery),
		[localRows, effectiveFilters, searchQuery],
	);

	const storeColumns = useMemo(
		() => groupGlobalRowsByStatus(filteredRows),
		[filteredRows],
	);
	const [columns, setColumns] = useState<GlobalKanbanColumnMap>(storeColumns);

	useEffect(() => {
		if (activeId !== null) return;
		setColumns((prev) => reconcileColumns(prev, storeColumns));
	}, [storeColumns, activeId]);

	const activeRow = useMemo<KanbanTaskContext | null>(() => {
		if (!activeId) return null;
		for (const col of DEFAULT_KANBAN_COLUMNS) {
			const found = columns[col.id]?.find((r) => r.task.id === activeId);
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
		setColumns((prev) => moveGlobalTaskForDrag(prev, activeTaskId, overId));
	};

	const handleDragEnd = (event: DragEndEvent) => {
		const { active } = event;
		const taskId = String(active.id);
		const finalColumn = findGlobalTaskColumn(columns, taskId);
		setActiveId(null);
		if (!finalColumn) return;

		// Use localRows (current displayed state) — not allRows (server state) — so
		// we don't silently skip a drag whose target matches the server's stale status.
		const currentRow = localRows.find((r) => r.task.id === taskId);
		const roadmapId = currentRow?.roadmapId;
		if (!currentRow || !roadmapId) return;

		const orderedIds = roadmapTaskIds(columns[finalColumn] ?? [], roadmapId);
		const previousBoardOrderById = new Map(
			localRows
				.filter((row) => row.roadmapId === roadmapId)
				.map((row) => [row.task.id, row.task.board_order]),
		);
		const nextBoardOrderById = new Map(
			orderedIds.map((id, index) => [id, index]),
		);

		if (currentRow.task.status === finalColumn) {
			const currentOrder = roadmapTaskIds(
				storeColumns[finalColumn] ?? [],
				roadmapId,
			);
			const orderChanged =
				currentOrder.length !== orderedIds.length ||
				currentOrder.some((id, index) => id !== orderedIds[index]);
			if (!orderChanged) return;

			setLocalRows((prev) =>
				prev.map((row) => {
					const boardOrder = nextBoardOrderById.get(row.task.id);
					return boardOrder === undefined
						? row
						: { ...row, task: { ...row.task, board_order: boardOrder } };
				}),
			);

			void taskService
				.reorderByStatus(
					roadmapId,
					finalColumn,
					orderedIds.map((id, index) => ({
						task_id: id,
						new_order_index: index,
					})),
				)
				.catch((error) => {
					setLocalRows((prev) =>
						prev.map((row) => {
							const boardOrder = previousBoardOrderById.get(row.task.id);
							return boardOrder === undefined
								? row
								: { ...row, task: { ...row.task, board_order: boardOrder } };
						}),
					);
					setColumns(storeColumns);
					toast.error(
						error instanceof Error
							? error.message
							: "Failed to update task order",
					);
				});
			return;
		}

		const previousStatus = currentRow.task.status;

		// Register pending update before optimistic state change so any concurrent
		// server refetch preserves our intended status.
		pendingUpdates.current.set(taskId, finalColumn);

		setLocalRows((prev) =>
			prev.map((row) => {
				const boardOrder = nextBoardOrderById.get(row.task.id);
				if (row.task.id === taskId) {
					return {
						...row,
						task: {
							...row.task,
							status: finalColumn,
							board_order: boardOrder ?? row.task.board_order,
						},
					};
				}
				return boardOrder === undefined
					? row
					: { ...row, task: { ...row.task, board_order: boardOrder } };
			}),
		);

		const safeBoardOrder = orderedIds.length * 1000 + 5000;
		void taskService
			.update(taskId, {
				status: finalColumn,
				board_order: safeBoardOrder,
			})
			.then(() =>
				taskService.reorderByStatus(
					roadmapId,
					finalColumn,
					orderedIds.map((id, index) => ({
						task_id: id,
						new_order_index: index,
					})),
				),
			)
			.then(() => {
				pendingUpdates.current.delete(taskId);
			})
			.catch((error) => {
				pendingUpdates.current.delete(taskId);
				setLocalRows((prev) =>
					prev.map((row) => {
						const boardOrder = previousBoardOrderById.get(row.task.id);
						if (row.task.id === taskId) {
							return {
								...row,
								task: {
									...row.task,
									status: previousStatus,
									board_order: boardOrder ?? row.task.board_order,
								},
							};
						}
						return boardOrder === undefined
							? row
							: { ...row, task: { ...row.task, board_order: boardOrder } };
					}),
				);
				setColumns(storeColumns);
				toast.error(
					error instanceof Error
						? error.message
						: "Failed to update task status and order",
				);
			});
	};

	const handleDragCancel = () => {
		setActiveId(null);
		setColumns(storeColumns);
	};

	const handleCardClick = useCallback(
		(taskId: string) => {
			const row = allRows.find((r) => r.task.id === taskId);
			if (!row) return;
			onTaskClick?.(row);
		},
		[allRows, onTaskClick],
	);

	return (
		<div className="flex flex-col h-full bg-background text-foreground">
			<GlobalKanbanFilters
				roadmaps={roadmaps}
				filters={effectiveFilters}
				onChange={setFilters}
				searchQuery={searchQuery}
				onSearchChange={setSearchQuery}
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
						{DEFAULT_KANBAN_COLUMNS.map((column) => (
							<KanbanColumn
								key={column.id}
								column={column}
								rows={columns[column.id] ?? []}
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
