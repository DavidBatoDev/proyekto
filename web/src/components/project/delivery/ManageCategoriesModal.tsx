import { Check, Plus, Tag, Trash2, X } from "lucide-react";
import { useState } from "react";
import { AppConfirmDialog } from "@/components/common/AppConfirmDialog";
import { AppDialog } from "@/components/common/AppDialog";
import type {
	CategoryColor,
	CategoryIcon,
	DecisionCategory,
} from "@/services/delivery.service";
import {
	FieldError,
	FieldLabel,
	inputClassFor,
	ListBox,
	ListEmpty,
	ListRow,
	PrimaryButton,
	SecondaryButton,
} from "./DeliveryPrimitives";
import { CATEGORY_NAME_MAX, validateCategoryName } from "./decisionForm";
import {
	CATEGORY_ACCENT,
	CATEGORY_COLORS,
	CATEGORY_ICON,
	CATEGORY_ICONS,
	CATEGORY_PRESETS,
	CATEGORY_SWATCH,
} from "./decisionModel";

/**
 * Managing the project's decision categories.
 *
 * Deleting is never blocked: the FK is ON DELETE SET NULL, so the decisions
 * filed under a deleted category fall back to "Uncategorised" rather than the
 * delete being refused. The confirmation says how many that will be, which is
 * the number that actually decides whether someone goes ahead.
 */
export function ManageCategoriesModal({
	isOpen,
	categories,
	decisionCounts,
	busy,
	onClose,
	onCreate,
	onUpdate,
	onDelete,
}: {
	isOpen: boolean;
	categories: DecisionCategory[];
	/** Category id -> how many decisions use it. */
	decisionCounts: Record<string, number>;
	busy: boolean;
	onClose: () => void;
	onCreate: (input: {
		name: string;
		color?: CategoryColor;
		icon?: CategoryIcon;
	}) => void;
	onUpdate: (
		id: string,
		patch: Partial<{ name: string; color: CategoryColor; icon: CategoryIcon }>,
	) => void;
	onDelete: (id: string) => void;
}) {
	const [newName, setNewName] = useState("");
	const [newColor, setNewColor] = useState<CategoryColor>("slate");
	const [newIcon, setNewIcon] = useState<CategoryIcon>("tag");
	const [error, setError] = useState<string | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editingName, setEditingName] = useState("");
	const [editError, setEditError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<DecisionCategory | null>(null);

	const unusedPresets = CATEGORY_PRESETS.filter(
		(preset) =>
			!categories.some(
				(c) => c.name.toLowerCase() === preset.name.toLowerCase(),
			),
	);

	const submitNew = () => {
		const found = validateCategoryName(newName, categories);
		setError(found);
		if (found) return;
		onCreate({ name: newName.trim(), color: newColor, icon: newIcon });
		setNewName("");
		setNewColor("slate");
		setNewIcon("tag");
	};

	const commitRename = (category: DecisionCategory) => {
		const found = validateCategoryName(editingName, categories, category.id);
		setEditError(found);
		if (found) return;
		if (editingName.trim() !== category.name) {
			onUpdate(category.id, { name: editingName.trim() });
		}
		setEditingId(null);
		setEditError(null);
	};

	return (
		<>
			<AppDialog
				open={isOpen}
				onClose={onClose}
				busy={busy}
				size="lg"
				title="Decision categories"
				description="Your own taxonomy — rename, recolour, or remove these freely."
				footer={<SecondaryButton onClick={onClose}>Done</SecondaryButton>}
			>
				<ListBox
					title="Categories"
					meta={`${categories.length} total`}
					bodyClassName="min-h-[8rem]"
				>
					{categories.length === 0 && (
						<ListEmpty>
							No categories yet. Add one below, or start from a suggestion.
						</ListEmpty>
					)}
					{categories.map((category) => {
						const Icon = CATEGORY_ICON[category.icon] ?? Tag;
						const inUse = decisionCounts[category.id] ?? 0;
						const isEditing = editingId === category.id;
						return (
							<ListRow key={category.id}>
								<span
									className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${CATEGORY_ACCENT[category.color] ?? CATEGORY_ACCENT.slate}`}
								>
									<Icon className="h-3.5 w-3.5" />
								</span>

								{isEditing ? (
									<span className="flex flex-1 items-center gap-2">
										<input
											value={editingName}
											onChange={(event) => setEditingName(event.target.value)}
											onKeyDown={(event) => {
												if (event.key === "Enter") {
													event.preventDefault();
													commitRename(category);
												}
												if (event.key === "Escape") {
													setEditingId(null);
													setEditError(null);
												}
											}}
											maxLength={CATEGORY_NAME_MAX + 1}
											className={`${inputClassFor(editError)} py-1`}
											aria-label="Category name"
										/>
										<button
											type="button"
											onClick={() => commitRename(category)}
											aria-label="Save name"
											className="rounded p-1 text-primary transition-colors hover:bg-muted"
										>
											<Check className="h-3.5 w-3.5" />
										</button>
										<button
											type="button"
											onClick={() => {
												setEditingId(null);
												setEditError(null);
											}}
											aria-label="Cancel rename"
											className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted"
										>
											<X className="h-3.5 w-3.5" />
										</button>
									</span>
								) : (
									<button
										type="button"
										onClick={() => {
											setEditingId(category.id);
											setEditingName(category.name);
											setEditError(null);
										}}
										className="flex-1 truncate text-left font-medium text-foreground hover:underline"
									>
										{category.name}
									</button>
								)}

								{!isEditing && (
									<>
										<SwatchRow
											value={category.color}
											onChange={(color) => onUpdate(category.id, { color })}
										/>
										<IconRow
											value={category.icon}
											onChange={(icon) => onUpdate(category.id, { icon })}
										/>
										<span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground">
											{inUse === 0
												? "Unused"
												: `${inUse} decision${inUse === 1 ? "" : "s"}`}
										</span>
										<button
											type="button"
											onClick={() => setDeleting(category)}
											aria-label={`Delete ${category.name}`}
											className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
										>
											<Trash2 className="h-3.5 w-3.5" />
										</button>
									</>
								)}
							</ListRow>
						);
					})}
					{editError && (
						<div className="px-4 pb-2">
							<FieldError>{editError}</FieldError>
						</div>
					)}
				</ListBox>

				{unusedPresets.length > 0 && (
					<div className="mt-4">
						<FieldLabel>Suggestions</FieldLabel>
						<div className="flex flex-wrap gap-1.5">
							{unusedPresets.map((preset) => {
								const Icon = CATEGORY_ICON[preset.icon];
								return (
									<button
										key={preset.name}
										type="button"
										onClick={() => onCreate(preset)}
										disabled={busy}
										className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-opacity hover:opacity-80 disabled:opacity-50 ${CATEGORY_ACCENT[preset.color]}`}
									>
										<Plus className="h-3 w-3" />
										<Icon className="h-3 w-3" />
										{preset.name}
									</button>
								);
							})}
						</div>
					</div>
				)}

				<div className="mt-5 border-t border-border pt-4">
					<FieldLabel>Add a category</FieldLabel>
					<div className="flex flex-wrap items-start gap-2">
						<div className="min-w-[12rem] flex-1">
							<input
								value={newName}
								onChange={(event) => {
									setNewName(event.target.value);
									if (error) setError(null);
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										submitNew();
									}
								}}
								maxLength={CATEGORY_NAME_MAX + 1}
								className={inputClassFor(error)}
								aria-invalid={Boolean(error)}
								placeholder="Security"
							/>
							<FieldError>{error}</FieldError>
						</div>
						<SwatchRow value={newColor} onChange={setNewColor} />
						<IconRow value={newIcon} onChange={setNewIcon} />
						<PrimaryButton onClick={submitNew} disabled={busy}>
							<Plus className="h-4 w-4" />
							Add
						</PrimaryButton>
					</div>
				</div>
			</AppDialog>

			<AppConfirmDialog
				open={Boolean(deleting)}
				tone="danger"
				title={`Delete "${deleting?.name}"?`}
				message={
					(decisionCounts[deleting?.id ?? ""] ?? 0) > 0
						? `${decisionCounts[deleting?.id ?? ""]} decision${
								decisionCounts[deleting?.id ?? ""] === 1 ? "" : "s"
							} will become Uncategorised. Nothing is deleted apart from the category itself.`
						: "Nothing is filed under it, so nothing else changes."
				}
				confirmLabel="Delete category"
				busy={busy}
				onConfirm={() => {
					if (deleting) onDelete(deleting.id);
					setDeleting(null);
				}}
				onClose={() => setDeleting(null)}
			/>
		</>
	);
}

/** The eight token-backed colours, as solid dots. */
function SwatchRow({
	value,
	onChange,
}: {
	value: CategoryColor;
	onChange: (color: CategoryColor) => void;
}) {
	return (
		<div className="flex shrink-0 items-center gap-1">
			{CATEGORY_COLORS.map((color) => (
				<button
					key={color}
					type="button"
					onClick={() => onChange(color)}
					aria-label={color}
					aria-pressed={color === value}
					className={`h-4 w-4 rounded-full transition-transform hover:scale-110 ${CATEGORY_SWATCH[color]} ${
						color === value
							? "ring-2 ring-foreground ring-offset-2 ring-offset-card"
							: ""
					}`}
				/>
			))}
		</div>
	);
}

function IconRow({
	value,
	onChange,
}: {
	value: CategoryIcon;
	onChange: (icon: CategoryIcon) => void;
}) {
	return (
		<div className="flex shrink-0 items-center gap-0.5">
			{CATEGORY_ICONS.map((icon) => {
				const Icon = CATEGORY_ICON[icon];
				return (
					<button
						key={icon}
						type="button"
						onClick={() => onChange(icon)}
						aria-label={icon}
						aria-pressed={icon === value}
						className={`rounded p-1 transition-colors ${
							icon === value
								? "bg-primary/10 text-primary"
								: "text-muted-foreground hover:bg-muted hover:text-foreground"
						}`}
					>
						<Icon className="h-3.5 w-3.5" />
					</button>
				);
			})}
		</div>
	);
}
