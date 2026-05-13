import {
	DndContext,
	type DragEndEvent,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useRoadmapStore } from "@/stores/roadmapStore";
import { useToast } from "@/hooks/useToast";
import type { TaskStatus } from "@/types/roadmap";
import { KanbanColumn } from "./KanbanColumn";
import { KanbanFilters } from "./KanbanFilters";
import { KANBAN_COLUMNS, type KanbanTaskContext } from "./types";
import {
	applyBoardFilters,
	selectAllTasksWithContext,
} from "./selectors";

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

	const grouped = useMemo(() => {
		const map = new Map<TaskStatus, KanbanTaskContext[]>();
		for (const column of KANBAN_COLUMNS) map.set(column.id, []);
		for (const row of filteredRows) {
			const bucket = map.get(row.task.status);
			if (bucket) bucket.push(row);
		}
		return map;
	}, [filteredRows]);

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
	);

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		if (!over) return;
		const taskId = String(active.id);
		const nextStatus = String(over.id) as TaskStatus;
		const row = filteredRows.find((r) => r.task.id === taskId);
		if (!row || row.task.status === nextStatus) return;
		void updateTaskStatusIntent(taskId, nextStatus).catch((error) => {
			toast.error(
				error instanceof Error
					? error.message
					: "Failed to update task status",
			);
		});
	};

	return (
		<div className="flex flex-col h-full bg-white">
			<KanbanFilters />
			<DndContext sensors={sensors} onDragEnd={handleDragEnd}>
				<div className="flex-1 overflow-x-auto">
					<div className="flex gap-3 p-3 h-full min-w-max">
						{KANBAN_COLUMNS.map((column) => (
							<KanbanColumn
								key={column.id}
								column={column}
								rows={grouped.get(column.id) ?? []}
							/>
						))}
					</div>
				</div>
			</DndContext>
		</div>
	);
}
