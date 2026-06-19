import { Pencil } from "lucide-react";
import type { CollaboratorInfo } from "@/hooks/useRoadmapCollaboration";

/**
 * "Someone is editing this" indicators for the roadmap canvas. Driven by
 * collaboration presence (`editingNodeId`): when a peer opens an epic/feature/
 * task detail, the card is outlined in their collaboration color (same palette
 * as their cursor) and their avatar floats at the card's top-right corner.
 */

const initials = (name: string) =>
	name
		.split(/\s+/)
		.map((part) => part[0] ?? "")
		.join("")
		.slice(0, 2)
		.toUpperCase() || "?";

/** The card border/outline color to use, or undefined when nobody is editing. */
export function editingBorderColor(
	editors?: CollaboratorInfo[],
): string | undefined {
	return editors && editors.length > 0 ? editors[0].color : undefined;
}

function EditorAvatar({
	editor,
	size = "w-6 h-6",
}: {
	editor: CollaboratorInfo;
	size?: string;
}) {
	// White inner ring + the actor's color ring, so stacked avatars stay legible.
	const ring = `0 0 0 2px #fff, 0 0 0 3.5px ${editor.color}`;
	return editor.avatarUrl ? (
		<img
			src={editor.avatarUrl}
			alt={editor.name}
			draggable={false}
			className={`${size} rounded-full object-cover`}
			style={{ boxShadow: ring }}
		/>
	) : (
		<div
			className={`${size} rounded-full flex items-center justify-center text-[9px] font-semibold text-white`}
			style={{ backgroundColor: editor.color, boxShadow: ring }}
		>
			{initials(editor.name)}
		</div>
	);
}

/**
 * Floating "Editing" pill at the card's top-right corner (epic/feature widgets):
 * the editor avatar(s) plus an "Editing" label, on a white chip outlined in the
 * (first) actor's color.
 */
export function EditingAvatars({ editors }: { editors?: CollaboratorInfo[] }) {
	if (!editors || editors.length === 0) return null;
	const first = editors[0];
	const shown = editors.slice(0, 3);
	const extra = editors.length - shown.length;
	const names = editors.map((e) => e.name).join(", ");
	return (
		<div
			className="absolute -top-3 right-4 z-20 flex items-center gap-1 rounded-full bg-white py-0.5 pl-0.5 pr-2 shadow-md"
			style={{ border: `1.5px solid ${first.color}` }}
			title={`${names} editing`}
		>
			<div className="flex items-center">
				{shown.map((editor, i) => (
					<div key={editor.userId} className={i > 0 ? "-ml-2" : ""}>
						<EditorAvatar editor={editor} size="w-5 h-5" />
					</div>
				))}
				{extra > 0 && (
					<div
						className="-ml-2 w-5 h-5 rounded-full bg-slate-700 text-white text-[9px] font-semibold flex items-center justify-center"
						style={{ boxShadow: "0 0 0 2px #fff" }}
					>
						+{extra}
					</div>
				)}
			</div>
			<span
				className="text-[10px] font-semibold leading-none"
				style={{ color: first.color }}
			>
				Editing
			</span>
		</div>
	);
}

/** Compact avatar for a task row (no room for a corner stack). */
export function EditingTaskAvatar({
	editors,
}: {
	editors?: CollaboratorInfo[];
}) {
	if (!editors || editors.length === 0) return null;
	const first = editors[0];
	const extra = editors.length - 1;
	const names = editors.map((e) => e.name).join(", ");
	return (
		<span className="shrink-0 flex items-center" title={`${names} editing`}>
			<span className="relative inline-flex">
				<EditorAvatar editor={first} size="w-5 h-5" />
				{/* Pencil glyph distinguishes "editing" from the assignee avatar. */}
				<span
					className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-white flex items-center justify-center"
					style={{ boxShadow: `0 0 0 1px ${first.color}` }}
				>
					<Pencil className="w-2 h-2" style={{ color: first.color }} />
				</span>
			</span>
			{extra > 0 && (
				<span
					className="ml-0.5 text-[9px] font-semibold"
					style={{ color: first.color }}
				>
					+{extra}
				</span>
			)}
		</span>
	);
}
