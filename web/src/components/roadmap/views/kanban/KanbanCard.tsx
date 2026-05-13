import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays } from "lucide-react";
import { useRoadmapStore } from "@/stores/roadmapStore";
import type { KanbanTaskContext } from "./types";

interface KanbanCardProps {
	row: KanbanTaskContext;
}

export function KanbanCard({ row }: KanbanCardProps) {
	const openTaskDetail = useRoadmapStore((s) => s.openTaskDetail);
	const { task, feature, epic, milestone } = row;

	const { attributes, listeners, setNodeRef, transform, isDragging } =
		useDraggable({ id: task.id });

	const style = {
		transform: CSS.Translate.toString(transform),
		opacity: isDragging ? 0.5 : 1,
	};

	const assigneeLabel =
		task.assignee?.display_name ||
		[task.assignee?.first_name, task.assignee?.last_name]
			.filter(Boolean)
			.join(" ") ||
		task.assignee?.email;

	const dueDate = task.due_date ? new Date(task.due_date) : null;
	const isOverdue =
		dueDate && task.status !== "done" && dueDate.getTime() < Date.now();

	return (
		<div
			ref={setNodeRef}
			style={style}
			{...attributes}
			{...listeners}
			onDoubleClick={() => openTaskDetail(task.id)}
			className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm hover:shadow-md transition cursor-grab active:cursor-grabbing"
		>
			<div className="text-sm font-medium text-gray-900 line-clamp-2">
				{task.title}
			</div>

			<div className="mt-2 flex flex-wrap gap-1.5">
				<span
					className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium"
					style={{
						backgroundColor: (epic.color ?? "#e5e7eb") + "33",
						color: epic.color ?? "#374151",
					}}
				>
					{epic.title}
				</span>
				{milestone && (
					<span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-indigo-50 text-indigo-700">
						{milestone.title}
					</span>
				)}
				<span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] text-gray-500 bg-gray-50">
					{feature.title}
				</span>
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
}
