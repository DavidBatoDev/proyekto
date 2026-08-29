import { Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { InlineRichText } from "@/components/brief/InlineRichText";
import {
	addSection,
	availableRecommendations,
	type BriefSection,
	RECOMMENDED_SECTIONS,
	removeSection,
	updateSection,
} from "@/lib/briefSections";

/**
 * The flexible middle of a brief.
 *
 * Sections are rows of `{key, value, position}`, not a fixed schema: a two-week
 * logo job and an eighteen-month platform build are both briefs, and any set of
 * headings that suits one insults the other. We suggest headings; the author
 * accepts, renames, deletes or invents.
 *
 * Editing is inline and cell-shaped, the way a notebook behaves — see
 * `InlineRichText`. A dialog was the first attempt and was wrong twice over: it
 * covered the rest of the brief at the moment the author most needs to see it,
 * and it made writing a section feel like a different act from writing the
 * overview directly above it.
 *
 * Reordering is out of scope, the same call `CustomFieldsEditor` made: it needs
 * drag affordances the rest of this page does not have, and adding a section in
 * the right place covers most of what reordering is wanted for.
 */
export function BriefSectionsEditor({
	sections,
	onChange,
	disabled,
}: {
	sections: BriefSection[];
	onChange: (next: BriefSection[]) => void;
	disabled?: boolean;
}) {
	// One open cell at a time, keyed by position: two editors at once is two
	// toolbars and no answer to "which one does Escape close?".
	const [editing, setEditing] = useState<number | null>(null);
	const recommendations = availableRecommendations(sections);

	const append = (key: string) => {
		onChange(addSection(sections, key));
		setEditing(sections.length);
	};

	return (
		<div className="space-y-6">
			{sections.map((section, index) => (
				<SectionCell
					key={section.position}
					section={section}
					disabled={disabled}
					editing={editing === section.position}
					// A brand-new section has an empty heading, and that is the field
					// the author is about to fill.
					focusHeading={editing === section.position && section.key === ""}
					onEdit={() => setEditing(section.position)}
					onDone={() =>
						setEditing((current) =>
							current === section.position ? null : current,
						)
					}
					onChange={(patch) => onChange(updateSection(sections, index, patch))}
					onRemove={() => {
						setEditing(null);
						onChange(removeSection(sections, index));
					}}
				/>
			))}

			{sections.length === 0 && (
				<p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
					No sections yet. Add one below, or let the generator draft them for
					you.
				</p>
			)}

			<div className="space-y-3 border-t border-border pt-5">
				{recommendations.length > 0 && (
					<>
						<p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
							Recommended sections
						</p>
						<div className="flex flex-wrap gap-2">
							{recommendations.map((recommended) => (
								<button
									key={recommended.key}
									type="button"
									disabled={disabled}
									title={recommended.hint}
									onClick={() => append(recommended.key)}
									className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
								>
									<Plus className="h-3.5 w-3.5" />
									{recommended.key}
								</button>
							))}
						</div>
					</>
				)}

				<button
					type="button"
					disabled={disabled}
					onClick={() => append("")}
					className="text-[13px] font-semibold text-primary hover:underline disabled:opacity-60"
				>
					+ Add your own section
				</button>
			</div>
		</div>
	);
}

function SectionCell({
	section,
	disabled,
	editing,
	focusHeading,
	onEdit,
	onDone,
	onChange,
	onRemove,
}: {
	section: BriefSection;
	disabled?: boolean;
	editing: boolean;
	focusHeading: boolean;
	onEdit: () => void;
	onDone: () => void;
	onChange: (patch: { key?: string; value?: string }) => void;
	onRemove: () => void;
}) {
	// The whole cell, heading included, counts as "inside" — typing a heading
	// must not close the body underneath it.
	const cellRef = useRef<HTMLElement>(null);
	const hint = RECOMMENDED_SECTIONS.find(
		(entry) => entry.key.toLowerCase() === section.key.trim().toLowerCase(),
	)?.hint;

	return (
		<section
			ref={cellRef}
			className={`group -mx-3 rounded-xl px-3 py-3 transition-colors ${
				editing ? "bg-muted/30" : "hover:bg-muted/20"
			}`}
		>
			<div className="mb-2 flex items-center gap-2">
				{editing ? (
					<input
						// Borderless and the same weight as the rendered heading, so
						// opening the cell does not make the page jump.
						value={section.key}
						onChange={(event) => onChange({ key: event.target.value })}
						disabled={disabled}
						maxLength={120}
						// Only ever true on a section the author just added, which is
						// exactly where the caret belongs.
						autoFocus={focusHeading}
						aria-label="Section heading"
						placeholder="Section heading"
						className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[15px] font-semibold text-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-60"
					/>
				) : (
					<h3 className="min-w-0 flex-1 text-[15px] font-semibold text-foreground">
						{section.key.trim() || "Untitled section"}
					</h3>
				)}
				{editing && (
					<button
						type="button"
						onClick={onDone}
						className="shrink-0 text-[12.5px] font-semibold text-primary hover:underline"
					>
						Done
					</button>
				)}
				<button
					type="button"
					onClick={onRemove}
					disabled={disabled}
					aria-label={`Remove ${section.key.trim() || "section"}`}
					className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-all hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-60 ${
						editing ? "opacity-100" : "opacity-0"
					}`}
				>
					<Trash2 className="h-3.5 w-3.5" />
				</button>
			</div>

			<InlineRichText
				value={section.value}
				onChange={(value) => onChange({ value })}
				editing={editing}
				onEdit={onEdit}
				onDone={onDone}
				disabled={disabled}
				containerRef={cellRef}
				autoFocus={!focusHeading}
				emptyHint={hint ?? "Add the detail for this section."}
				placeholder="Write what a consultant needs to know here."
				editLabel={`Edit ${section.key.trim() || "section"}`}
			/>
		</section>
	);
}
