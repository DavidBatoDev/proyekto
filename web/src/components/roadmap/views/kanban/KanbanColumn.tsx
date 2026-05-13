import { useDroppable } from "@dnd-kit/core";
import {
	SortableContext,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useMemo } from "react";
import { KanbanCard } from "./KanbanCard";
import type { KanbanColumnDef, KanbanTaskContext } from "./types";

interface KanbanColumnProps {
	column: KanbanColumnDef;
	rows: KanbanTaskContext[];
}

export function KanbanColumn({ column, rows }: KanbanColumnProps) {
	const { setNodeRef, isOver } = useDroppable({
		id: column.id,
		data: { type: "column", status: column.id },
	});

	const ids = useMemo(() => rows.map((row) => row.task.id), [rows]);

	return (
		<div className="flex-1 min-w-[260px] max-w-[320px] flex flex-col bg-gray-50 rounded-lg border border-gray-200">
			<div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
				<div className="flex items-center gap-2">
					<span className={`w-2 h-2 rounded-full ${column.accent}`} />
					<span className="text-sm font-semibold text-gray-900">
						{column.label}
					</span>
				</div>
				<span className="text-xs text-gray-500">{rows.length}</span>
			</div>
			<SortableContext items={ids} strategy={verticalListSortingStrategy}>
				<div
					ref={setNodeRef}
					className={`flex-1 p-2 space-y-2 overflow-y-auto transition-colors ${
						isOver ? "bg-orange-50/60" : ""
					}`}
				>
					{rows.map((row) => (
						<KanbanCard key={row.task.id} row={row} />
					))}
					{rows.length === 0 && (
						<div className="text-xs text-gray-400 text-center py-6 border border-dashed border-gray-200 rounded">
							Drop tasks here
						</div>
					)}
				</div>
			</SortableContext>
		</div>
	);
}
