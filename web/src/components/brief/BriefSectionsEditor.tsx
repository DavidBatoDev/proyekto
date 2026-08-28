import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { RichTextEditor } from "@/components/common/RichTextEditor";
import {
	addSection,
	availableRecommendations,
	type BriefSection,
	isRichTextEmpty,
	RECOMMENDED_SECTIONS,
	removeSection,
	updateSection,
} from "@/lib/briefSections";

const EDITOR_TOOLS = [
	"textFormat",
	"bold",
	"italic",
	"separator",
	"bulletList",
	"numberedList",
	"separator",
	"link",
] as const;

/**
 * The flexible middle of a brief.
 *
 * Sections are rows of `{key, value, position}`, not a fixed schema: a two-week
 * logo job and an eighteen-month platform build are both briefs, and any set of
 * headings that suits one insults the other. We suggest headings; the author
 * accepts, renames, deletes or invents.
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
	const [editing, setEditing] = useState<number | null>(null);
	const recommendations = availableRecommendations(sections);

	return (
		<div className="space-y-5">
			{sections.length === 0 ? (
				<p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
					No sections yet. Add one from the list on the left, or let the
					generator draft them for you.
				</p>
			) : (
				<div className="divide-y divide-border">
					{sections.map((section, index) => (
						<SectionRow
							key={`${section.key}-${section.position}`}
							section={section}
							disabled={disabled}
							onEdit={() => setEditing(index)}
							onRemove={() => onChange(removeSection(sections, index))}
						/>
					))}
				</div>
			)}

			{recommendations.length > 0 && (
				<div>
					<p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
						Recommended sections
					</p>
					<div className="flex flex-wrap gap-2">
						{recommendations.map((recommended) => (
							<button
								key={recommended.key}
								type="button"
								disabled={disabled}
								title={recommended.hint}
								onClick={() => {
									onChange(addSection(sections, recommended.key));
									setEditing(sections.length);
								}}
								className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
							>
								<Plus className="h-3.5 w-3.5" />
								{recommended.key}
							</button>
						))}
					</div>
				</div>
			)}

			<button
				type="button"
				disabled={disabled}
				onClick={() => {
					onChange(addSection(sections, ""));
					setEditing(sections.length);
				}}
				className="text-[13px] font-semibold text-primary hover:underline disabled:opacity-60"
			>
				+ Add your own section
			</button>

			{editing !== null && sections[editing] && (
				<SectionDialog
					section={sections[editing]}
					onClose={() => setEditing(null)}
					onSave={(patch) => {
						onChange(updateSection(sections, editing, patch));
						setEditing(null);
					}}
				/>
			)}
		</div>
	);
}

function SectionRow({
	section,
	disabled,
	onEdit,
	onRemove,
}: {
	section: BriefSection;
	disabled?: boolean;
	onEdit: () => void;
	onRemove: () => void;
}) {
	const empty = isRichTextEmpty(section.value);

	return (
		<div className="group py-4">
			<div className="flex items-start justify-between gap-3">
				<h3 className="text-[15px] font-semibold text-foreground">
					{section.key.trim() || "Untitled section"}
				</h3>
				<div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
					<button
						type="button"
						onClick={onEdit}
						disabled={disabled}
						aria-label={`Edit ${section.key || "section"}`}
						className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
					>
						<Pencil className="h-3.5 w-3.5" />
					</button>
					<button
						type="button"
						onClick={onRemove}
						disabled={disabled}
						aria-label={`Remove ${section.key || "section"}`}
						className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive disabled:opacity-60"
					>
						<Trash2 className="h-3.5 w-3.5" />
					</button>
				</div>
			</div>

			{empty ? (
				<button
					type="button"
					onClick={onEdit}
					disabled={disabled}
					className="mt-1 text-left text-[13.5px] text-muted-foreground hover:text-foreground disabled:opacity-60"
				>
					{RECOMMENDED_SECTIONS.find(
						(entry) => entry.key.toLowerCase() === section.key.toLowerCase(),
					)?.hint ?? "Add the detail for this section."}
				</button>
			) : (
				<div
					// The body is authored in this app's own rich-text editor and
					// stored as its sanitized output, the same trust boundary the
					// project overview uses for a brief.
					dangerouslySetInnerHTML={{ __html: section.value }}
					className="prose-brief mt-1 text-[13.5px] leading-relaxed text-muted-foreground"
				/>
			)}
		</div>
	);
}

function SectionDialog({
	section,
	onClose,
	onSave,
}: {
	section: BriefSection;
	onClose: () => void;
	onSave: (patch: { key: string; value: string }) => void;
}) {
	const [key, setKey] = useState(section.key);
	const [value, setValue] = useState(section.value);

	return (
		<AppDialog
			open
			onClose={onClose}
			title={section.key.trim() ? "Edit section" : "New section"}
			size="lg"
			footer={
				<div className="flex justify-end gap-3">
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg border border-input px-5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/40"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={() => onSave({ key: key.trim(), value })}
						disabled={key.trim() === ""}
						className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
					>
						Save section
					</button>
				</div>
			}
		>
			<div className="space-y-4">
				<div>
					<label
						htmlFor="brief-section-key"
						className="mb-1.5 block text-[13px] font-semibold text-foreground"
					>
						Heading
					</label>
					<input
						id="brief-section-key"
						value={key}
						onChange={(event) => setKey(event.target.value)}
						maxLength={120}
						placeholder="e.g. Scope of work"
						className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
					/>
				</div>

				<div>
					<span className="mb-1.5 block text-[13px] font-semibold text-foreground">
						Detail
					</span>
					<RichTextEditor
						value={value}
						onChange={setValue}
						tools={[...EDITOR_TOOLS]}
						minHeight="180px"
						maxHeight="360px"
						placeholder="Write what a consultant needs to know here."
					/>
				</div>
			</div>
		</AppDialog>
	);
}
