import { Check, ChevronDown, Plus, Tag, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { DecisionCategory } from "@/services/delivery.service";
import { inputClassFor } from "./DeliveryPrimitives";
import {
	CATEGORY_ACCENT,
	CATEGORY_ICON,
	CATEGORY_PRESETS,
} from "./decisionModel";

/**
 * Pick a category, or make one without leaving the form.
 *
 * This is a new interaction primitive for this codebase — no creatable combobox
 * existed anywhere in `web/src`, and `LabelSelector.tsx` is not a candidate to
 * reuse: it never persists anything and paints raw hex.
 *
 * Presets appear as chips only while they have not been created yet, matching
 * `CreateChannelModal`'s suggestion row. Picking a preset creates an ordinary
 * category with its colour and icon; typing a name creates a plain one.
 */
export function CategoryCombobox({
	categories,
	value,
	onChange,
	onCreate,
	creating = false,
	invalid,
	describedBy,
}: {
	categories: DecisionCategory[];
	/** Selected category id, or "" for uncategorised. */
	value: string;
	onChange: (categoryId: string) => void;
	/** Resolves with the created row so it can be selected straight away. */
	onCreate: (input: {
		name: string;
		color?: DecisionCategory["color"];
		icon?: DecisionCategory["icon"];
	}) => Promise<DecisionCategory | null>;
	creating?: boolean;
	invalid?: string | null;
	describedBy?: string;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const containerRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const listId = useId();

	const selected = categories.find((c) => c.id === value) ?? null;

	const matches = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return categories;
		return categories.filter((c) => c.name.toLowerCase().includes(needle));
	}, [categories, query]);

	// Offered only when the typed name is not already taken — the database's
	// unique index is case-insensitive, so the check here has to be too.
	const trimmed = query.trim();
	const canCreate =
		trimmed.length > 0 &&
		!categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase());

	const rowCount = matches.length + (canCreate ? 1 : 0);

	// Presets that have not been created yet, matched by name the same way.
	const presets = useMemo(
		() =>
			CATEGORY_PRESETS.filter(
				(preset) =>
					!categories.some(
						(c) => c.name.toLowerCase() === preset.name.toLowerCase(),
					),
			),
		[categories],
	);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: MouseEvent) => {
			if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", onPointerDown);
		return () => document.removeEventListener("mousedown", onPointerDown);
	}, [open]);

	useEffect(() => {
		setActiveIndex(0);
	}, [query]);

	const choose = (categoryId: string) => {
		onChange(categoryId);
		setQuery("");
		setOpen(false);
	};

	const create = async (input: {
		name: string;
		color?: DecisionCategory["color"];
		icon?: DecisionCategory["icon"];
	}) => {
		const created = await onCreate(input);
		if (created) choose(created.id);
	};

	const commitActive = () => {
		if (activeIndex < matches.length) {
			choose(matches[activeIndex].id);
			return;
		}
		if (canCreate) void create({ name: trimmed });
	};

	const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			if (!open) {
				setOpen(true);
				return;
			}
			if (rowCount === 0) return;
			const step = event.key === "ArrowDown" ? 1 : -1;
			setActiveIndex((index) => (index + step + rowCount) % rowCount);
			return;
		}
		if (event.key === "Enter") {
			// Never let the combobox submit the surrounding form: Enter here means
			// "take this option", which is a different intent from "save".
			event.preventDefault();
			if (!open) setOpen(true);
			else commitActive();
			return;
		}
		if (event.key === "Escape" && open) {
			event.preventDefault();
			event.stopPropagation();
			setOpen(false);
		}
	};

	const SelectedIcon = selected ? (CATEGORY_ICON[selected.icon] ?? Tag) : Tag;

	return (
		<div ref={containerRef} className="relative">
			<div className="relative">
				<span
					className={`pointer-events-none absolute left-2.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md ${
						selected
							? (CATEGORY_ACCENT[selected.color] ?? CATEGORY_ACCENT.slate)
							: "text-muted-foreground"
					}`}
				>
					<SelectedIcon className="h-3 w-3" />
				</span>
				<input
					ref={inputRef}
					// A combobox, not a text field: the value is the selected category,
					// and typing filters rather than editing it.
					role="combobox"
					aria-expanded={open}
					aria-controls={listId}
					aria-autocomplete="list"
					aria-invalid={invalid ? true : undefined}
					aria-describedby={describedBy}
					value={open ? query : (selected?.name ?? "")}
					placeholder={selected ? selected.name : "Uncategorised"}
					onChange={(event) => {
						setQuery(event.target.value);
						if (!open) setOpen(true);
					}}
					onFocus={() => setOpen(true)}
					onKeyDown={onKeyDown}
					className={`${inputClassFor(invalid)} pl-9 pr-14`}
				/>
				<span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
					{selected && (
						<button
							type="button"
							onClick={() => choose("")}
							aria-label="Clear category"
							className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					)}
					<ChevronDown className="h-4 w-4 text-muted-foreground" />
				</span>
			</div>

			{/* Absolutely positioned, deliberately. Portaling this list would put it
			    above `AppDialog`'s panel only with a hand-tuned z-index, and measured
			    in place it never overflows the dialog body: the field sits at the top
			    of the form, so the 256px list always has room below it. */}
			{open && (
				<div
					id={listId}
					role="listbox"
					className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg"
				>
					{matches.map((category, index) => {
						const Icon = CATEGORY_ICON[category.icon] ?? Tag;
						return (
							<button
								key={category.id}
								type="button"
								role="option"
								aria-selected={category.id === value}
								onMouseEnter={() => setActiveIndex(index)}
								onClick={() => choose(category.id)}
								className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
									index === activeIndex ? "bg-muted" : ""
								}`}
							>
								<span
									className={`flex h-5 w-5 items-center justify-center rounded-md ${CATEGORY_ACCENT[category.color] ?? CATEGORY_ACCENT.slate}`}
								>
									<Icon className="h-3 w-3" />
								</span>
								<span className="flex-1 truncate text-foreground">
									{category.name}
								</span>
								{category.id === value && (
									<Check className="h-3.5 w-3.5 text-primary" />
								)}
							</button>
						);
					})}

					{canCreate && (
						<button
							type="button"
							role="option"
							aria-selected={activeIndex === matches.length}
							onMouseEnter={() => setActiveIndex(matches.length)}
							onClick={() => void create({ name: trimmed })}
							disabled={creating}
							className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-60 ${
								activeIndex === matches.length ? "bg-muted" : ""
							}`}
						>
							<span className="flex h-5 w-5 items-center justify-center rounded-md bg-primary/10 text-primary">
								<Plus className="h-3 w-3" />
							</span>
							<span className="truncate text-foreground">
								Create “{trimmed}”
							</span>
						</button>
					)}

					{matches.length === 0 && !canCreate && (
						<p className="px-2 py-3 text-center text-xs text-muted-foreground">
							No categories yet.
						</p>
					)}

					{presets.length > 0 && (
						<div className="mt-1 border-t border-border pt-2">
							<p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
								Suggested
							</p>
							<div className="flex flex-wrap gap-1 px-1 pb-1">
								{presets.map((preset) => {
									const Icon = CATEGORY_ICON[preset.icon];
									return (
										<button
											key={preset.name}
											type="button"
											onClick={() => void create(preset)}
											disabled={creating}
											className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-opacity hover:opacity-80 disabled:opacity-50 ${CATEGORY_ACCENT[preset.color]}`}
										>
											<Icon className="h-3 w-3" />
											{preset.name}
										</button>
									);
								})}
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
