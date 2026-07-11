import {
	DndContext,
	DragOverlay,
	MouseSensor,
	TouchSensor,
	closestCenter,
	pointerWithin,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
	type CollisionDetection,
	type DragEndEvent,
	type DragStartEvent,
} from "@dnd-kit/core";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, ChevronDown, GripVertical, Layers3, ListTree } from "lucide-react";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useToast } from "@/hooks/useToast";
import { useRoadmapStore } from "@/stores/roadmapStore";
import { DEFAULT_KANBAN_COLUMNS, type KanbanColumnDef, type KanbanTaskContext } from "./types";

// ─── Drag overlay preview ─────────────────────────────────────────────────────

function TaskDragPreview({ row }: { row: KanbanTaskContext }) {
	const { task, feature, epic } = row;
	const col = DEFAULT_KANBAN_COLUMNS.find((c) => c.id === task.status);
	return (
		<div className="w-72 rounded-xl bg-white shadow-2xl border border-slate-200/80 px-3 py-2.5 rotate-1">
			<div className="flex items-center gap-2 mb-1.5">
				<span className={`w-2 h-2 rounded-full ${col?.accent ?? "bg-gray-400"}`} />
				<span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
					{col?.label}
				</span>
			</div>
			<p className="text-sm font-semibold text-slate-900 line-clamp-2">{task.title}</p>
			<div className="mt-1.5 flex flex-wrap gap-1">
				<span
					className="kanban-epic-chip inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold truncate max-w-[130px]"
				>
					<Layers3 className="h-3 w-3 shrink-0" />
					{epic.title}
				</span>
				<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-muted text-[10px] font-medium text-foreground truncate max-w-[130px]">
					<ListTree className="h-3 w-3 shrink-0 text-muted-foreground" />
					{feature.title}
				</span>
			</div>
		</div>
	);
}

// ─── Draggable task row ───────────────────────────────────────────────────────

function DraggableTaskRow({
	row,
	col,
}: {
	row: KanbanTaskContext;
	col: KanbanColumnDef;
}) {
	const openTaskDetail = useRoadmapStore((s) => s.openTaskDetail);
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: row.task.id,
		data: { fromStatus: row.task.status },
	});

	const { task, feature, epic } = row;
	const assigneeLabel =
		task.assignee?.display_name ||
		[task.assignee?.first_name, task.assignee?.last_name].filter(Boolean).join(" ") ||
		task.assignee?.email;
	const dueDate = task.due_date ? new Date(task.due_date) : null;
	const isOverdue = dueDate && task.status !== "done" && dueDate.getTime() < Date.now();

	return (
		// Listeners on the whole row — same pattern as KanbanCard.
		// Quick tap (< 250 ms) still fires onClick; 250 ms hold activates drag.
		<div
			ref={setNodeRef}
			{...attributes}
			{...listeners}
			onClick={() => openTaskDetail(task.id)}
			className={`flex items-center gap-2.5 px-3 py-3 bg-white border-b border-slate-50 last:border-0 cursor-pointer active:bg-slate-50 transition-opacity select-none ${
				isDragging ? "opacity-30" : "opacity-100"
			}`}
		>
			{/* Visual drag affordance (non-interactive) */}
			<GripVertical className="w-4 h-4 text-slate-200 shrink-0" />

			<span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 self-start ${col.accent}`} />

			<div className="flex-1 min-w-0">
				<p className="text-sm font-medium text-slate-900 line-clamp-2">{task.title}</p>
				<div className="mt-1.5 flex flex-wrap gap-1">
					<span
						className="kanban-epic-chip inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold truncate max-w-[130px]"
					>
						<Layers3 className="h-3 w-3 shrink-0" />
						{epic.title}
					</span>
					<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-muted text-[10px] font-medium text-foreground truncate max-w-[130px]">
						<ListTree className="h-3 w-3 shrink-0 text-muted-foreground" />
						{feature.title}
					</span>
				</div>
				{dueDate && (
					<p
						className={`mt-1 text-[11px] flex items-center gap-1 ${
							isOverdue ? "text-red-500" : "text-slate-400"
						}`}
					>
						<CalendarDays className="w-3 h-3" />
						{dueDate.toLocaleDateString()}
					</p>
				)}
			</div>

			{assigneeLabel && (
				<div className="shrink-0">
					{task.assignee?.avatar_url ? (
						<img
							src={task.assignee.avatar_url}
							alt={assigneeLabel}
							className="w-6 h-6 rounded-full"
						/>
					) : (
						<div className="w-6 h-6 rounded-full bg-slate-700 text-white flex items-center justify-center text-[10px] font-medium shrink-0">
							{assigneeLabel.charAt(0).toUpperCase()}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

// ─── Droppable status section ─────────────────────────────────────────────────

function StatusSection({
	col,
	rows,
	isCollapsed,
	onToggle,
	isAnyDragging,
}: {
	col: KanbanColumnDef;
	rows: KanbanTaskContext[];
	isCollapsed: boolean;
	onToggle: () => void;
	isAnyDragging: boolean;
}) {
	const { setNodeRef, isOver } = useDroppable({ id: col.id });
	const dropping = isOver && isAnyDragging;

	// Auto-expand collapsed sections when something is dragged over them
	const showContent = !isCollapsed || dropping;

	return (
		<div ref={setNodeRef} className="border-b border-slate-100 last:border-0">
			{/* Section header */}
			<button
				type="button"
				onClick={onToggle}
				className={`w-full flex items-center gap-2.5 px-4 py-3 transition-colors ${
					dropping ? "bg-primary/10" : "bg-slate-50 hover:bg-slate-100"
				}`}
			>
				<motion.span
					className={`w-2.5 h-2.5 rounded-full shrink-0 ${col.accent}`}
					animate={{ scale: dropping ? 1.4 : 1 }}
					transition={{ type: "spring", stiffness: 500, damping: 20 }}
				/>
				<span
					className={`flex-1 text-left text-xs font-semibold transition-colors ${
						dropping ? "text-primary" : "text-slate-700"
					}`}
				>
					{col.label}
				</span>
				<span className="min-w-6 h-5 px-1.5 rounded-full bg-slate-200/70 text-[11px] font-medium text-slate-600 flex items-center justify-center">
					{rows.length}
				</span>
				<motion.span
					animate={{ rotate: showContent ? 0 : -90 }}
					transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
					className="shrink-0 text-slate-400"
				>
					<ChevronDown className="w-3.5 h-3.5" />
				</motion.span>
			</button>

			{/* Animated content area */}
			<AnimatePresence initial={false}>
				{showContent && (
					<motion.div
						key="content"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
						className="overflow-hidden"
					>
						{rows.length === 0 ? (
							<div
								className={`mx-3 my-2 px-4 py-5 text-xs text-center border border-dashed rounded-lg transition-colors ${
									dropping
										? "border-primary/40 text-primary/70 bg-primary/5"
										: "border-slate-200 text-slate-400"
								}`}
							>
								{dropping ? "Drop here to move" : "No tasks"}
							</div>
						) : (
							<>
								{rows.map((row) => (
									<DraggableTaskRow key={row.task.id} row={row} col={col} />
								))}
								<AnimatePresence>
									{dropping && (
										<motion.div
											initial={{ height: 0, opacity: 0 }}
											animate={{ height: "auto", opacity: 1 }}
											exit={{ height: 0, opacity: 0 }}
											transition={{ duration: 0.15 }}
											className="px-4 py-2 text-xs text-center text-primary bg-primary/5 border-t border-primary/20"
										>
											Drop here to move
										</motion.div>
									)}
								</AnimatePresence>
							</>
						)}
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

// Prefer pointer position (intuitive on mobile); fall back to closest center
// when the pointer is in a gap or outside all sections.
const detectCollision: CollisionDetection = (args) => {
	const hits = pointerWithin(args);
	return hits.length > 0 ? hits : closestCenter(args);
};

// ─── Main component ───────────────────────────────────────────────────────────

interface KanbanListViewProps {
	rows: KanbanTaskContext[];
}

export function KanbanListView({ rows }: KanbanListViewProps) {
	const toast = useToast();
	const { updateTaskStatusIntent } = useRoadmapStore(
		useShallow((s) => ({ updateTaskStatusIntent: s.updateTaskStatusIntent })),
	);

	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const [activeId, setActiveId] = useState<string | null>(null);

	const toggle = (id: string) =>
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	const allCollapsed = DEFAULT_KANBAN_COLUMNS.every((c) => collapsed.has(c.id));

	const grouped = useMemo(
		() =>
			Object.fromEntries(
				DEFAULT_KANBAN_COLUMNS.map((col) => [
					col.id,
					rows.filter((r) => r.task.status === col.bucketStatus),
				]),
			),
		[rows],
	);

	const activeRow = useMemo<KanbanTaskContext | null>(
		() => (activeId ? (rows.find((r) => r.task.id === activeId) ?? null) : null),
		[activeId, rows],
	);

	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
		useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
	);

	const handleDragStart = ({ active }: DragStartEvent) => {
		setActiveId(String(active.id));
	};

	const handleDragEnd = ({ active, over }: DragEndEvent) => {
		setActiveId(null);
		if (!over) return;

		const taskId = String(active.id);
		const fromStatus = String(active.data.current?.fromStatus ?? "");
		const toColumnId = String(over.id);

		if (fromStatus === toColumnId) return;

		const targetCol = DEFAULT_KANBAN_COLUMNS.find((c) => c.id === toColumnId);
		if (!targetCol) return;

		void updateTaskStatusIntent(taskId, targetCol.bucketStatus).catch((err) => {
			toast.error(err instanceof Error ? err.message : "Failed to update task status");
		});
	};

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={detectCollision}
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
			onDragCancel={() => setActiveId(null)}
		>
			{/* Sticky toolbar */}
			<div className="flex items-center justify-between px-4 py-2 bg-white border-b border-slate-100 sticky top-0 z-10">
				<span className="text-[11px] font-medium text-slate-400">
					{rows.length} task{rows.length !== 1 ? "s" : ""}
				</span>
				<button
					type="button"
					onClick={() =>
						allCollapsed
							? setCollapsed(new Set())
							: setCollapsed(new Set(DEFAULT_KANBAN_COLUMNS.map((c) => c.id)))
					}
					className="text-[11px] font-medium text-slate-500 hover:text-slate-900 transition-colors"
				>
					{allCollapsed ? "Expand all" : "Collapse all"}
				</button>
			</div>

			{/* Status sections */}
			{DEFAULT_KANBAN_COLUMNS.map((col) => (
				<StatusSection
					key={col.id}
					col={col}
					rows={grouped[col.id] ?? []}
					isCollapsed={collapsed.has(col.id)}
					onToggle={() => toggle(col.id)}
					isAnyDragging={activeId !== null}
				/>
			))}

			<DragOverlay dropAnimation={{ duration: 200, easing: "ease-out" }}>
				{activeRow ? <TaskDragPreview row={activeRow} /> : null}
			</DragOverlay>
		</DndContext>
	);
}
