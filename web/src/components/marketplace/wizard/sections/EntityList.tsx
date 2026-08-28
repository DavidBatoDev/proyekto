import { Pencil, Plus, Trash2 } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

/**
 * A list section rendered the way the public profile renders one: a heading, an
 * icon tile per row, and text flowing on the page background.
 *
 * Deliberately card-less. Step 2 previously wrapped every section in its own
 * bordered panel, which stacked eight boxes down the page and looked nothing
 * like the profile it produces. Editing something should resemble the thing
 * being edited.
 */
export function EntityList<T>({
	title,
	optional,
	description,
	icon: Icon,
	items,
	renderRow,
	onAdd,
	onEdit,
	onRemove,
	addLabel,
	emptyLabel,
}: {
	title: string;
	optional?: boolean;
	description?: string;
	icon: ComponentType<{ className?: string }>;
	items: T[];
	renderRow: (item: T) => ReactNode;
	onAdd: () => void;
	onEdit: (index: number) => void;
	onRemove: (index: number) => void;
	addLabel: string;
	emptyLabel: string;
}) {
	return (
		<section>
			<div className="mb-1 flex items-baseline gap-2">
				<h3 className="text-base font-semibold text-foreground">{title}</h3>
				{optional && (
					<span className="text-xs text-muted-foreground">(Optional)</span>
				)}
			</div>
			{description && (
				<p className="mb-4 text-sm text-muted-foreground">{description}</p>
			)}

			{items.length > 0 ? (
				<ul className="mb-4 space-y-5">
					{items.map((item, index) => (
						<li
							// Index keys are safe: rows are only appended, edited in place,
							// or removed -- nothing reorders them.
							key={index}
							className="group flex items-start gap-4"
						>
							<span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
								<Icon className="h-4 w-4" />
							</span>
							<div className="min-w-0 flex-1">{renderRow(item)}</div>
							<div className="flex shrink-0 gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
								<button
									type="button"
									onClick={() => onEdit(index)}
									aria-label={`Edit entry ${index + 1} in ${title}`}
									className="cursor-pointer rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
								>
									<Pencil className="h-3.5 w-3.5" />
								</button>
								<button
									type="button"
									onClick={() => onRemove(index)}
									aria-label={`Remove entry ${index + 1} from ${title}`}
									className="cursor-pointer rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
								>
									<Trash2 className="h-3.5 w-3.5" />
								</button>
							</div>
						</li>
					))}
				</ul>
			) : (
				<p className="mb-4 text-sm text-muted-foreground">{emptyLabel}</p>
			)}

			<button
				type="button"
				onClick={onAdd}
				className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-muted"
			>
				<Plus className="h-4 w-4" /> {addLabel}
			</button>
		</section>
	);
}
