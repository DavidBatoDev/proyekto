import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays } from "lucide-react";
import { type CSSProperties, forwardRef, type HTMLAttributes } from "react";
import { useRoadmapStore } from "@/stores/roadmapStore";
import type { KanbanTaskContext } from "./types";

interface KanbanCardProps {
	row: KanbanTaskContext;
	overlay?: boolean;
	onCardClick?: (taskId: string) => void;
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
		const { task, feature, epic, milestone, project } = row;

		const assigneeProfiles = task.assignees?.length
			? task.assignees
			: task.assignee
				? [task.assignee]
				: [];
		const nameOfProfile = (p: (typeof assigneeProfiles)[number]) =>
			p.display_name ||
			[p.first_name, p.last_name].filter(Boolean).join(" ") ||
			p.email ||
			"Member";

		const dueDate = task.due_date ? new Date(task.due_date) : null;
		const isOverdue =
			dueDate && task.status !== "done" && dueDate.getTime() < Date.now();

		const base =
			"bg-white rounded-lg p-3 shadow-[0_1px_1px_rgba(9,30,66,0.25)] transition-all group ring-1 ring-transparent";
		const interactive = overlay
			? "shadow-[0_8px_16px_-4px_rgba(9,30,66,0.25)] rotate-2 cursor-grabbing ring-gray-200"
			: "hover:ring-gray-300 cursor-pointer active:cursor-grabbing";
		const dim = !overlay && dragging ? "opacity-40 bg-gray-50/50" : "";

		return (
			<div
				ref={ref}
				{...rest}
				className={`${base} ${interactive} ${dim} ${className ?? ""}`}
			>
				{project && (
					<div className="mb-1.5">
						<span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500 truncate max-w-full">
							{project.title}
						</span>
					</div>
				)}
				<div className="text-sm font-medium text-gray-900 line-clamp-2">
					{task.title}
				</div>

				<div className="mt-2.5 flex flex-wrap gap-1.5 items-start">
					<span
						className="inline-flex items-center max-w-full px-2 py-0.5 rounded text-[11px] font-semibold truncate"
						style={{
							backgroundColor: `${epic.color ?? "#64748b"}26`,
							color: epic.color ?? "#334155",
						}}
						title={epic.title}
					>
						{epic.title}
					</span>
					<span
						className="inline-flex items-center max-w-full px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600 truncate group-hover:bg-slate-200 transition-colors"
						title={feature.title}
					>
						{feature.title}
					</span>
					{milestone && (
						<span className="inline-flex items-center max-w-full px-2 py-0.5 rounded text-[11px] font-medium bg-indigo-50 text-indigo-600 truncate">
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
					{assigneeProfiles.length > 0 && (
						<div className="flex items-center">
							{assigneeProfiles.slice(0, 3).map((profile, index) => {
								const label = nameOfProfile(profile);
								return profile.avatar_url ? (
									<img
										key={profile.id}
										src={profile.avatar_url}
										alt={label}
										title={label}
										className={`w-5 h-5 rounded-full ring-1 ring-white ${
											index > 0 ? "-ml-1.5" : ""
										}`}
									/>
								) : (
									<div
										key={profile.id}
										title={label}
										className={`w-5 h-5 rounded-full bg-black text-white flex items-center justify-center text-[10px] font-medium ring-1 ring-white ${
											index > 0 ? "-ml-1.5" : ""
										}`}
									>
										{label.charAt(0).toUpperCase()}
									</div>
								);
							})}
							{assigneeProfiles.length > 3 && (
								<div className="w-5 h-5 -ml-1.5 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-[9px] font-semibold ring-1 ring-white">
									+{assigneeProfiles.length - 3}
								</div>
							)}
						</div>
					)}
				</div>
			</div>
		);
	},
);

export function KanbanCard({
	row,
	overlay = false,
	onCardClick,
}: KanbanCardProps) {
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
			onClick={() => (onCardClick ?? openTaskDetail)(row.task.id)}
		/>
	);
}
