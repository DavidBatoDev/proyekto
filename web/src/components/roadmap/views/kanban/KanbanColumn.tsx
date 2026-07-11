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
	onCardClick?: (taskId: string) => void;
}

export function KanbanColumn({ column, rows, onCardClick }: KanbanColumnProps) {
	const { setNodeRef, isOver } = useDroppable({
		id: column.id,
		data: { type: "column", columnId: column.id, status: column.bucketStatus },
	});

	const ids = useMemo(() => rows.map((row) => row.task.id), [rows]);

	return (
		<div className="flex-1 min-w-40 basis-0 flex flex-col bg-muted rounded-xl border border-border md:min-w-0">
			<div className="flex items-center justify-between gap-2 px-3 py-3 min-w-0">
				<div className="flex items-center gap-2 min-w-0">
					<span
						className={`w-2.5 h-2.5 rounded-full shrink-0 ${column.accent}`}
					/>
					<span className="text-sm font-semibold text-foreground truncate">
						{column.label}
					</span>
				</div>
				<span className="flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full text-xs font-medium text-slate-600 bg-slate-200/70 shrink-0">
					{rows.length}
				</span>
			</div>
			<SortableContext items={ids} strategy={verticalListSortingStrategy}>
				<div
					ref={setNodeRef}
					className={`flex-1 px-2 pb-2 space-y-2 overflow-y-auto transition-colors [scrollbar-width:thin] [scrollbar-color:var(--color-slate-300)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-400 ${
						isOver ? "bg-accent rounded-b-xl" : ""
					}`}
				>
					{rows.map((row) => (
						<KanbanCard key={row.task.id} row={row} onCardClick={onCardClick} />
					))}
					{rows.length === 0 && (
						<div className="text-xs text-muted-foreground text-center py-6 border border-dashed border-border rounded">
							Drop tasks here
						</div>
					)}
				</div>
			</SortableContext>
		</div>
	);
}
