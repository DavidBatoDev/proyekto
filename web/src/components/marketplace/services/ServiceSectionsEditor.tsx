import {
	AlignLeft,
	ArrowDown,
	ArrowUp,
	Columns3,
	Plus,
	Trash2,
	X,
} from "lucide-react";
import { useRef, useState } from "react";
import { AutoTextarea } from "@/components/common/InlineEditable";
import { isRichTextEmpty } from "@/lib/richText";
import { cn } from "@/lib/utils";
import type {
	ServiceDescriptionSection,
	ServiceSectionColumn,
} from "@/queries/serviceOfferings";
import { InlineServiceRichText } from "./InlineServiceRichText";
import { gridFor } from "./ServiceSectionView";

export interface SectionDraft {
	/** Stable local key — sections have no ids, they are a jsonb array. */
	key: string;
	layout: "prose" | "columns";
	heading: string;
	body: string;
	columns: ServiceSectionColumn[];
}

export const MAX_SECTIONS = 12;
export const MAX_COLUMNS = 3;

let keyCounter = 0;
export function emptySectionDraft(
	layout: "prose" | "columns" = "prose",
	heading = "",
): SectionDraft {
	keyCounter += 1;
	return {
		key: `sec-${keyCounter}`,
		layout,
		heading,
		body: "",
		columns: layout === "columns" ? [{ label: "", body: "" }] : [],
	};
}

export function toSectionDrafts(
	sections: ServiceDescriptionSection[],
): SectionDraft[] {
	return sections.map((section) => ({
		...emptySectionDraft(),
		layout: section.layout === "columns" ? "columns" : "prose",
		heading: section.heading ?? "",
		body: section.body ?? "",
		columns: section.columns ?? [],
	}));
}

/** What actually gets saved: empty sections and empty columns are dropped. */
export function toSectionPayload(
	sections: SectionDraft[],
): ServiceDescriptionSection[] {
	const payload: ServiceDescriptionSection[] = [];

	for (const section of sections) {
		const heading = section.heading.trim();

		if (section.layout === "columns") {
			const columns = section.columns
				.map((column) => ({
					label: column.label.trim(),
					body: column.body.trim(),
				}))
				.filter((column) => column.label && column.body);
			if (columns.length === 0) continue;
			const entry: ServiceDescriptionSection = { layout: "columns", columns };
			if (heading) entry.heading = heading;
			payload.push(entry);
			continue;
		}

		// `.trim()` is not enough now that bodies are editor HTML: an untouched
		// editor leaves "<p><br></p>", which is truthy and blank.
		if (isRichTextEmpty(section.body)) continue;
		const entry: ServiceDescriptionSection = {
			layout: "prose",
			body: section.body.trim(),
		};
		if (heading) entry.heading = heading;
		payload.push(entry);
	}

	return payload;
}

const inline =
	"rounded-lg bg-transparent outline-none transition-colors placeholder:text-muted-foreground/50 hover:bg-muted/60 focus:bg-muted/60";

/** Starters, so an empty About is a shape to fill rather than a blank page. */
const SUGGESTED = [
	"About this service",
	"What you get",
	"My skills",
	"How I work",
	"Why me",
];

/**
 * The About area as sections, each in one of two layouts: prose (a heading
 * over a rich-text body) or columns (up to three labelled facts side by side).
 *
 * WYSIWYG all the way down: a closed prose section renders through the very
 * component the public page uses, and clicking it opens the rich-text editor
 * in place — the brief editor's behaviour. There is no preview toggle any
 * more, because the closed state is the preview.
 */
export function ServiceSectionsEditor({
	sections,
	onChange,
}: {
	sections: SectionDraft[];
	onChange: (sections: SectionDraft[]) => void;
}) {
	// One open body at a time: two editors is two toolbars and no answer to
	// "which one does Escape close?".
	const [editingKey, setEditingKey] = useState<string | null>(null);

	const patch = (key: string, partial: Partial<SectionDraft>) =>
		onChange(
			sections.map((section) =>
				section.key === key ? { ...section, ...partial } : section,
			),
		);

	const move = (index: number, delta: number) => {
		const target = index + delta;
		if (target < 0 || target >= sections.length) return;
		const next = [...sections];
		[next[index], next[target]] = [next[target], next[index]];
		onChange(next);
	};

	const add = (layout: "prose" | "columns") => {
		const draft = emptySectionDraft(
			layout,
			layout === "prose" ? (SUGGESTED[sections.length] ?? "") : "",
		);
		onChange([...sections, draft]);
		// A new prose section is added in order to write in it — open it rather
		// than making the seller click the thing they just created.
		if (layout === "prose") setEditingKey(draft.key);
	};

	if (sections.length === 0) {
		return (
			<section>
				<h2 className="text-lg font-semibold text-foreground">
					About this service
				</h2>
				<div className="mt-3 rounded-2xl border-2 border-dashed border-input px-5 py-8 text-center">
					<p className="text-sm text-muted-foreground">
						Break the pitch into sections — what you get, how you work, why you.
						Write prose, or lay facts out in columns.
					</p>
					<div className="mt-4 flex flex-wrap justify-center gap-2">
						<AddButton layout="prose" onClick={() => add("prose")} />
						<AddButton layout="columns" onClick={() => add("columns")} />
					</div>
				</div>
			</section>
		);
	}

	return (
		<div className="space-y-8">
			{sections.map((section, index) => (
				<SectionBlock
					key={section.key}
					section={section}
					index={index}
					count={sections.length}
					editing={editingKey === section.key}
					onEdit={() => setEditingKey(section.key)}
					onDone={() =>
						setEditingKey((current) =>
							current === section.key ? null : current,
						)
					}
					onPatch={(partial) => patch(section.key, partial)}
					onMove={(delta) => move(index, delta)}
					onRemove={() => {
						setEditingKey(null);
						onChange(sections.filter((item) => item.key !== section.key));
					}}
				/>
			))}

			{sections.length < MAX_SECTIONS && (
				<div className="flex flex-wrap gap-2">
					<AddButton layout="prose" onClick={() => add("prose")} />
					<AddButton layout="columns" onClick={() => add("columns")} />
				</div>
			)}
		</div>
	);
}

function AddButton({
	layout,
	onClick,
}: {
	layout: "prose" | "columns";
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
		>
			<Plus className="h-4 w-4" />
			{layout === "prose" ? "Add a text section" : "Add a columns section"}
		</button>
	);
}

function SectionBlock({
	section,
	index,
	count,
	editing,
	onEdit,
	onDone,
	onPatch,
	onMove,
	onRemove,
}: {
	section: SectionDraft;
	index: number;
	count: number;
	editing: boolean;
	onEdit: () => void;
	onDone: () => void;
	onPatch: (partial: Partial<SectionDraft>) => void;
	onMove: (delta: number) => void;
	onRemove: () => void;
}) {
	// The whole block counts as "inside", heading and toolbar included — typing
	// a heading must not close the body under it.
	const blockRef = useRef<HTMLElement>(null);
	const isColumns = section.layout === "columns";

	const setLayout = (layout: "prose" | "columns") => {
		if (layout === section.layout) return;
		onPatch({
			layout,
			// Seed one empty column so switching lands on something writable.
			columns:
				layout === "columns" && section.columns.length === 0
					? [{ label: "", body: "" }]
					: section.columns,
		});
	};

	const patchColumn = (
		columnIndex: number,
		partial: Partial<ServiceSectionColumn>,
	) =>
		onPatch({
			columns: section.columns.map((column, i) =>
				i === columnIndex ? { ...column, ...partial } : column,
			),
		});

	return (
		<section
			ref={blockRef}
			className={cn(
				"group/section -mx-3 rounded-xl px-3 py-2 transition-colors",
				editing && "bg-muted/30",
			)}
		>
			<div className="flex items-center gap-2">
				<input
					value={section.heading}
					maxLength={80}
					onChange={(event) => onPatch({ heading: event.target.value })}
					placeholder={
						isColumns ? "Section heading (optional)" : "Section heading"
					}
					aria-label={`Section ${index + 1} heading`}
					className={cn(
						inline,
						"-mx-2 min-w-0 flex-1 px-2 py-1 text-lg font-semibold text-foreground",
					)}
				/>
				{editing && (
					<button
						type="button"
						onClick={onDone}
						className="shrink-0 cursor-pointer text-[12.5px] font-semibold text-primary hover:underline"
					>
						Done
					</button>
				)}
				<span
					className={cn(
						"flex shrink-0 items-center gap-0.5 transition-opacity focus-within:opacity-100 group-hover/section:opacity-100",
						// The controls stay put while a section is open: they belong to
						// the block being worked on, and blinking them off on every
						// mouse-out reads as the page losing them.
						editing ? "opacity-100" : "opacity-0",
					)}
				>
					<span className="mr-1 flex items-center rounded-lg border border-border p-0.5">
						<LayoutButton
							active={!isColumns}
							label="Text section"
							onClick={() => setLayout("prose")}
						>
							<AlignLeft className="h-3.5 w-3.5" />
						</LayoutButton>
						<LayoutButton
							active={isColumns}
							label="Columns section"
							onClick={() => setLayout("columns")}
						>
							<Columns3 className="h-3.5 w-3.5" />
						</LayoutButton>
					</span>
					<IconButton
						label="Move section up"
						onClick={() => onMove(-1)}
						disabled={index === 0}
					>
						<ArrowUp className="h-3.5 w-3.5" />
					</IconButton>
					<IconButton
						label="Move section down"
						onClick={() => onMove(1)}
						disabled={index === count - 1}
					>
						<ArrowDown className="h-3.5 w-3.5" />
					</IconButton>
					<IconButton label="Remove section" onClick={onRemove} destructive>
						<Trash2 className="h-3.5 w-3.5" />
					</IconButton>
				</span>
			</div>

			{isColumns ? (
				<div className="mt-3 border-t border-border pt-4">
					<div className={gridFor(section.columns.length)}>
						{section.columns.map((column, columnIndex) => (
							<div
								key={`${section.key}-col-${columnIndex}`}
								className="group/col relative"
							>
								<div className="flex items-center gap-1">
									<input
										value={column.label}
										maxLength={60}
										onChange={(event) =>
											patchColumn(columnIndex, { label: event.target.value })
										}
										placeholder="Label"
										aria-label={`Column ${columnIndex + 1} label`}
										className={cn(
											inline,
											"-mx-1.5 min-w-0 flex-1 px-1.5 py-0.5 text-[13px] text-muted-foreground",
										)}
									/>
									{section.columns.length > 1 && (
										<button
											type="button"
											onClick={() =>
												onPatch({
													columns: section.columns.filter(
														(_, i) => i !== columnIndex,
													),
												})
											}
											aria-label={`Remove column ${columnIndex + 1}`}
											className="cursor-pointer rounded-full p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/col:opacity-100"
										>
											<X className="h-3 w-3" />
										</button>
									)}
								</div>
								<AutoTextarea
									value={column.body}
									maxLength={1000}
									onChange={(event) =>
										patchColumn(columnIndex, { body: event.target.value })
									}
									placeholder="Marketing, Payment, Customer support…"
									aria-label={`Column ${columnIndex + 1} body`}
									className={cn(
										inline,
										"mt-1 -mx-1.5 block w-[calc(100%+0.75rem)] resize-none px-1.5 py-0.5 text-[15px] leading-relaxed text-foreground",
									)}
								/>
							</div>
						))}
					</div>

					{section.columns.length < MAX_COLUMNS && (
						<button
							type="button"
							onClick={() =>
								onPatch({
									columns: [...section.columns, { label: "", body: "" }],
								})
							}
							className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							<Plus className="h-3.5 w-3.5" />
							Add column
						</button>
					)}
				</div>
			) : (
				<InlineServiceRichText
					value={section.body}
					onChange={(body) => onPatch({ body })}
					editing={editing}
					onEdit={onEdit}
					onDone={onDone}
					containerRef={blockRef}
					// The caret belongs in the heading of a section the seller just
					// added — it is blank and it is the first thing they will type.
					autoFocus={section.heading.trim() !== ""}
					emptyHint="Write this section — what the buyer gets, how you work, why you."
					placeholder="Write this section…"
					editLabel={`Edit ${section.heading.trim() || `section ${index + 1}`}`}
				/>
			)}
		</section>
	);
}

function LayoutButton({
	active,
	label,
	onClick,
	children,
}: {
	active: boolean;
	label: string;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			aria-pressed={active}
			title={label}
			className={cn(
				"cursor-pointer rounded-md p-1 transition-colors",
				active
					? "bg-muted text-foreground"
					: "text-muted-foreground hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}

function IconButton({
	label,
	onClick,
	disabled,
	destructive,
	children,
}: {
	label: string;
	onClick: () => void;
	disabled?: boolean;
	destructive?: boolean;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-label={label}
			title={label}
			className={cn(
				"cursor-pointer rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30",
				destructive ? "hover:text-destructive" : "hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}
