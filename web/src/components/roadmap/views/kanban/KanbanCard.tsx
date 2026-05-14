import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays } from "lucide-react";
import { forwardRef, type CSSProperties, type HTMLAttributes } from "react";
import { useRoadmapStore } from "@/stores/roadmapStore";
import type { KanbanTaskContext } from "./types";

interface KanbanCardProps {
	row: KanbanTaskContext;
	overlay?: boolean;
}

interface CardSurfaceProps extends HTMLAttributes<HTMLDivElement> {
	row: KanbanTaskContext;
	overlay?: boolean;
	dragging?: boolean;
}

/**
 * Pure visual layer for the card. Used both inside SortableContext (with drag
 * handlers wired via useSortable) and inside DragOverlay (no handlers).
 */
const CardSurface = forwardRef<HTMLDivElement, CardSurfaceProps>(
	function CardSurface({ row, overlay, dragging, className, ...rest }, ref) {
		const { task, feature, epic, milestone } = row;

		const assigneeLabel =
			task.assignee?.display_name ||
			[task.assignee?.first_name, task.assignee?.last_name]
				.filter(Boolean)
				.join(" ") ||
			task.assignee?.email;

		const dueDate = task.due_date ? new Date(task.due_date) : null;
		const isOverdue =
			dueDate && task.status !== "done" && dueDate.getTime() < Date.now();

		const base =
			"bg-white border border-gray-200 rounded-lg p-3 shadow-sm transition";
		const interactive = overlay
			? "shadow-lg rotate-1 cursor-grabbing"
			: "hover:shadow-md cursor-pointer active:cursor-grabbing";
		const dim = !overlay && dragging ? "opacity-40" : "";

		return (
			<div
				ref={ref}
				{...rest}
				className={`${base} ${interactive} ${dim} ${className ?? ""}`}
			>
				<div className="text-sm font-medium text-gray-900 line-clamp-2">
					{task.title}
				</div>

				<div className="mt-2 flex flex-col gap-1 items-start">
					<span
						className="inline-flex items-center max-w-full px-2 py-0.5 rounded-md text-[11px] font-semibold border truncate"
						style={{
							backgroundColor: (epic.color ?? "#64748b") + "1f",
							color: epic.color ?? "#334155",
							borderColor: (epic.color ?? "#64748b") + "4d",
						}}
						title={epic.title}
					>
						{epic.title}
					</span>
					<div className="flex items-center gap-1 pl-2 max-w-full">
						<span className="text-slate-300 text-xs leading-none select-none">
							└
						</span>
						<span
							className="inline-flex items-center max-w-full px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200 truncate"
							title={feature.title}
						>
							{feature.title}
						</span>
					</div>
					{milestone && (
						<span className="inline-flex items-center max-w-full px-2 py-0.5 rounded-md text-[11px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-100 truncate">
							{milestone.title}
						</span>
					)}
				</div>

				<div className="mt-2 flex items-center justify-between text-[11px] text-gray-500">
					<div className="flex items-center gap-1.5">
						{dueDate && (
							<span
								className={`inline-flex items-center gap-1 ${
									isOverdue ? "text-red-600" : ""
								}`}
							>
								<CalendarDays className="w-3 h-3" />
								{dueDate.toLocaleDateString()}
							</span>
						)}
					</div>
					{assigneeLabel && (
						<div className="flex items-center gap-1">
							{task.assignee?.avatar_url ? (
								<img
									src={task.assignee.avatar_url}
									alt={assigneeLabel}
									className="w-5 h-5 rounded-full"
								/>
							) : (
								<div className="w-5 h-5 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-[10px] font-medium">
									{assigneeLabel.charAt(0).toUpperCase()}
								</div>
							)}
						</div>
					)}
				</div>
			</div>
		);
	},
);

export function KanbanCard({ row, overlay = false }: KanbanCardProps) {
	const openTaskDetail = useRoadmapStore((s) => s.openTaskDetail);

	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({
		id: row.task.id,
		data: { type: "task", status: row.task.status },
		disabled: overlay,
	});

	const style: CSSProperties = {
		transform: CSS.Translate.toString(transform),
		transition,
	};

	if (overlay) {
		return <CardSurface row={row} overlay />;
	}

	return (
		<CardSurface
			ref={setNodeRef}
			row={row}
			dragging={isDragging}
			style={style}
			{...attributes}
			{...listeners}
			onClick={() => openTaskDetail(row.task.id)}
		/>
	);
}
