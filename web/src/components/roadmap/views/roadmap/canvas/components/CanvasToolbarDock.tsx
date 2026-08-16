import { useDraggable } from "@dnd-kit/core";
import { GripHorizontal, Layers3, ListTodo } from "lucide-react";
import type { DragEvent } from "react";
import type { DockAvatar } from "@/hooks/useRecentAssignees";
import type { ToolbarItemType } from "../model/toolbar";

/**
 * The floating "Drag To Add" dock: HTML5-draggable chips for epic / feature /
 * task, plus recent-assignee avatars that can be dropped onto a task.
 *
 * Renderer-independent — it uses native HTML5 drag-and-drop (and dnd-kit for the
 * avatars), never the canvas engine. It is `fixed`-positioned, so it is not even
 * inside the canvas container.
 *
 * Colours are carried over verbatim from the original inline JSX, including the
 * hard-coded `bg-white` / `gray-*` / `emerald-*` palette classes. They should
 * move to theme tokens (the dock is unreadable in dark mode), but that is a
 * visual change and this extraction is deliberately behaviour-neutral.
 */

const getAvatarInitials = (name: string) =>
	name
		.split(/\s+/)
		.map((part) => part[0] ?? "")
		.join("")
		.slice(0, 2)
		.toUpperCase() || "?";

function ToolbarAssigneeChip({ avatar }: { avatar: DockAvatar }) {
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: `dock-avatar-${avatar.userId}`,
		data: {
			type: "assignee",
			userId: avatar.userId,
			displayName: avatar.displayName,
			avatarUrl: avatar.avatarUrl,
		},
	});

	const tooltip = avatar.isSelf
		? `${avatar.displayName} (you)`
		: avatar.displayName;
	const ringClass = avatar.isSelf ? "ring-orange-400" : "ring-white";

	return (
		<button
			ref={setNodeRef}
			type="button"
			{...attributes}
			{...listeners}
			title={`Drag to assign ${tooltip}`}
			aria-label={`Drag to assign ${tooltip}`}
			className={`relative shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 transition-opacity cursor-grab active:cursor-grabbing ${
				isDragging ? "opacity-40" : "opacity-100"
			}`}
		>
			{avatar.avatarUrl ? (
				<img
					src={avatar.avatarUrl}
					alt=""
					draggable={false}
					className={`w-7 h-7 rounded-full object-cover ring-2 ${ringClass} shadow-sm`}
				/>
			) : (
				<div
					className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold bg-linear-to-br from-slate-200 to-slate-300 text-slate-700 ring-2 ${ringClass} shadow-sm`}
				>
					{getAvatarInitials(avatar.displayName)}
				</div>
			)}
		</button>
	);
}

/** The three chips were byte-identical apart from these three fields. */
const CHIPS: Array<{
	type: ToolbarItemType;
	label: string;
	title: string;
	Icon: typeof Layers3;
}> = [
	{
		type: "epic",
		label: "Epic",
		title: "Drop on an epic card to add a new epic below it",
		Icon: Layers3,
	},
	{
		type: "feature",
		label: "Feature",
		title: "Drop on an epic card to add a feature",
		Icon: Layers3,
	},
	{
		type: "task",
		label: "Task",
		title: "Drop on a feature card to add a task",
		Icon: ListTodo,
	},
];

export interface CanvasToolbarDockProps {
	/** The chip currently being dragged, or null. Drives the active highlight. */
	draggingType: ToolbarItemType | null;
	onDragStart: (
		itemType: ToolbarItemType,
		event: DragEvent<HTMLElement>,
	) => void;
	onDragEnd: () => void;
	assigneeAvatars: DockAvatar[];
}

export function CanvasToolbarDock({
	draggingType,
	onDragStart,
	onDragEnd,
	assigneeAvatars,
}: CanvasToolbarDockProps) {
	return (
		<div
			className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-2xl border border-gray-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur select-none"
			data-testid="roadmap-canvas-toolbar-dock"
		>
			<div className="flex items-center gap-2">
				<div className="mr-1 inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
					<GripHorizontal className="h-3 w-3" />
					Drag To Add
				</div>
				{CHIPS.map(({ type, label, title, Icon }) => (
					<button
						key={type}
						type="button"
						draggable
						onDragStart={(event) => onDragStart(type, event)}
						onDragEnd={onDragEnd}
						className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all duration-200 ${
							draggingType === type
								? "border-emerald-500 bg-emerald-50 text-emerald-700 shadow-[0_0_0_3px_rgba(34,197,94,0.2)]"
								: "border-gray-200 bg-white text-gray-700 hover:border-emerald-300 hover:bg-emerald-50/70 hover:text-emerald-700 hover:shadow-sm"
						}`}
						title={title}
						data-testid={`roadmap-canvas-toolbar-${type}`}
					>
						<Icon className="h-3.5 w-3.5" />
						{label}
					</button>
				))}
				{assigneeAvatars.length > 0 && (
					<>
						<span
							aria-hidden="true"
							className="mx-1 h-5 w-px shrink-0 bg-gray-200"
						/>
						<span className="mr-1 inline-flex items-center text-[11px] font-medium uppercase tracking-wide text-gray-500">
							Assignee
						</span>
						{assigneeAvatars.map((avatar) => (
							<ToolbarAssigneeChip key={avatar.userId} avatar={avatar} />
						))}
					</>
				)}
			</div>
		</div>
	);
}
