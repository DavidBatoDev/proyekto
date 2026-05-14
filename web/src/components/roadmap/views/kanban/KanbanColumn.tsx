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
		<div className="flex-1 min-w-0 basis-0 flex flex-col bg-gray-50 rounded-lg border border-gray-200">
			<div className="flex items-center justify-between gap-1 px-2 py-1.5 border-b border-gray-200 min-w-0">
				<div className="flex items-center gap-1.5 min-w-0">
					<span className={`w-2 h-2 rounded-full shrink-0 ${column.accent}`} />
					<span className="text-xs font-semibold text-gray-900 truncate">
						{column.label}
					</span>
				</div>
				<span className="text-[11px] text-gray-500 shrink-0">{rows.length}</span>
			</div>
			<SortableContext items={ids} strategy={verticalListSortingStrategy}>
				<div
					ref={setNodeRef}
					className={`flex-1 p-2 space-y-2 overflow-y-auto transition-colors [scrollbar-width:thin] [scrollbar-color:theme(colors.slate.300)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-400 ${
						isOver ? "bg-slate-100" : ""
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
