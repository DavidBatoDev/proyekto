import {
	FolderKanban,
	Loader2,
	type LucideIcon,
	Map as MapIcon,
	Users,
} from "lucide-react";
import { type CSSProperties, Fragment, useEffect, useRef } from "react";
import {
	RoadmapNodeGlyph,
	type RoadmapNodeKind,
} from "@/components/common/NodeGlyph";
import type { AiMentionCandidate, AiMentionKind } from "./aiMentions";

/**
 * Containers get a line icon; the four roadmap node kinds get the artwork the
 * rest of the app already draws them with.
 *
 * The picker used to spend generic lucide glyphs on epic/feature/task
 * (`Layers` / `Puzzle` / `SquareCheck`), which named the kind to someone who
 * already knew the mapping and told everyone else nothing. `RoadmapNodeGlyph`
 * is the same tile the canvas, the board, the left panel and global search
 * use, so a row in this list is recognisable as the thing you would click on
 * the canvas rather than as a fresh icon vocabulary to learn.
 */
const AI_MENTION_CONTAINER_ICONS: Record<
	"project" | "roadmap" | "team",
	LucideIcon
> = {
	project: FolderKanban,
	roadmap: MapIcon,
	team: Users,
};

const NODE_KINDS = new Set<string>(["epic", "feature", "task", "milestone"]);

const isNodeKind = (kind: AiMentionKind): kind is RoadmapNodeKind =>
	NODE_KINDS.has(kind);

/**
 * One mention's icon at a caller-chosen size (the picker rows use 16px, the
 * composer chips and the message refs 12px). `size` is px rather than a class
 * because the glyphs are sized artwork, not font-scaled line icons, and
 * `className` reaches only the line-icon branch — a node glyph is a coloured
 * tile and must not be dimmed to match the text around it.
 */
export function AiMentionKindIcon({
	kind,
	size = 16,
	className,
}: {
	kind: AiMentionKind;
	size?: number;
	className?: string;
}) {
	if (isNodeKind(kind)) return <RoadmapNodeGlyph kind={kind} size={size} />;
	const Icon = AI_MENTION_CONTAINER_ICONS[kind];
	return (
		<Icon
			style={{ width: size, height: size }}
			className={`shrink-0 ${className ?? ""}`}
			aria-hidden
		/>
	);
}

export const AI_MENTION_GROUP_LABELS: Record<
	"primary" | AiMentionKind,
	string
> = {
	primary: "This roadmap",
	project: "Projects",
	roadmap: "Roadmaps",
	epic: "Epics",
	feature: "Features",
	task: "Tasks",
	milestone: "Milestones",
	team: "Teams",
};

export const AI_MENTION_LOADING_LABEL = "Searching other roadmaps...";

function groupOf(candidate: AiMentionCandidate): "primary" | AiMentionKind {
	return candidate.primary ? "primary" : candidate.kind;
}

export function aiMentionOptionId(listboxId: string, index: number): string {
	return `${listboxId}-option-${index}`;
}

export interface AiMentionPickerProps {
	/** Same array the composer's keyboard indexes into — never re-filtered. */
	candidates: readonly AiMentionCandidate[];
	activeIndex: number;
	onActiveIndexChange: (index: number) => void;
	onSelect: (candidate: AiMentionCandidate) => void;
	isLoading?: boolean;
	/** DOM id of the listbox (the composer points `aria-controls` at it). */
	id: string;
	/** Horizontal anchor (px, relative to the composer) — the caret column. */
	style?: CSSProperties;
	/**
	 * Render the bare listbox without the floating container — the host
	 * provides the popover chrome (the composer's add-context popover).
	 */
	embedded?: boolean;
}

/**
 * The @-mention listbox: one flat candidate array rendered with a header row
 * (`role="presentation"`) whenever the group changes. Mouse selection uses
 * `onMouseDown` + preventDefault so the textarea never blurs.
 */
export function AiMentionPicker({
	candidates,
	activeIndex,
	onActiveIndexChange,
	onSelect,
	isLoading = false,
	id,
	style,
	embedded = false,
}: AiMentionPickerProps) {
	const listRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!listRef.current) return;
		const active = document.getElementById(aiMentionOptionId(id, activeIndex));
		if (active && typeof active.scrollIntoView === "function") {
			active.scrollIntoView({ block: "nearest" });
		}
	}, [activeIndex, id]);

	if (candidates.length === 0 && !isLoading) return null;

	let previousGroup: "primary" | AiMentionKind | null = null;

	const listbox = (
		<div
			ref={listRef}
			id={id}
			role="listbox"
			aria-label="Mention an item"
			className="thin-scrollbar max-h-64 overflow-y-auto py-1"
		>
			{candidates.map((candidate, index) => {
				const group = groupOf(candidate);
				const showHeader = group !== previousGroup;
				previousGroup = group;
				const isActive = index === activeIndex;
				const optionId = aiMentionOptionId(id, index);
				const labelId = `${optionId}-label`;
				const secondaryId = candidate.secondary
					? `${optionId}-secondary`
					: undefined;
				return (
					<Fragment key={`${candidate.kind}:${candidate.id}`}>
						{showHeader && (
							<div
								role="presentation"
								className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
							>
								{AI_MENTION_GROUP_LABELS[group]}
							</div>
						)}
						<div
							id={optionId}
							role="option"
							aria-selected={isActive}
							aria-labelledby={labelId}
							aria-describedby={secondaryId}
							tabIndex={-1}
							onMouseDown={(event) => {
								event.preventDefault();
								onSelect(candidate);
							}}
							onMouseEnter={() => onActiveIndexChange(index)}
							className={`flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm ${
								isActive
									? "bg-accent text-accent-foreground"
									: "hover:bg-accent/60"
							}`}
						>
							<AiMentionKindIcon
								kind={candidate.kind}
								className={isActive ? "" : "text-muted-foreground"}
							/>
							<span className="min-w-0 flex-1">
								<span id={labelId} className="block truncate">
									{candidate.label}
								</span>
								{candidate.secondary && (
									<span
										id={secondaryId}
										className="block truncate text-[11px] text-muted-foreground"
									>
										{candidate.secondary}
									</span>
								)}
							</span>
						</div>
					</Fragment>
				);
			})}
			{isLoading && (
				<div
					role="presentation"
					className="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground"
				>
					<Loader2 className="h-3 w-3 animate-spin" aria-hidden />
					<span>{AI_MENTION_LOADING_LABEL}</span>
				</div>
			)}
		</div>
	);

	if (embedded) return listbox;

	return (
		<div
			className="absolute bottom-full left-0 z-40 mb-2 w-80 max-w-full overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
			style={style}
		>
			{listbox}
		</div>
	);
}
