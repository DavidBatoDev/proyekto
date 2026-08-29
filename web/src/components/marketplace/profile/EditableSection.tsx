import { Pencil } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The WYSIWYG affordances on the public seller profiles: owners edit the page
 * clients see, so every editable section carries a small pencil that opens
 * the same modal the private profile editor uses. Visitors never see either
 * component — callers gate on `isOwner`.
 */

/** A muted pencil that sits inline after a section heading. */
export function SectionEditButton({
	label,
	onClick,
}: {
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={onClick}
			className="ml-2 inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md align-middle text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
		>
			<Pencil className="h-3.5 w-3.5" />
		</button>
	);
}

/**
 * A block wrapper that reveals per-item controls on hover; the children
 * render untouched, so a visitor's markup and an owner's are identical
 * except for the floated controls.
 */
export function EditableItem({
	controls,
	children,
}: {
	controls: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="group/editable relative">
			{children}
			<div className="absolute right-0 top-0 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/editable:opacity-100">
				{controls}
			</div>
		</div>
	);
}

export function ItemControlButton({
	label,
	onClick,
	icon,
}: {
	label: string;
	onClick: () => void;
	icon: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={onClick}
			className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
		>
			{icon}
		</button>
	);
}
