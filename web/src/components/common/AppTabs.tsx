import { Link, type LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * The segmented tab strip, extracted from the five places that hand-rolled it.
 *
 * Supports both call patterns already in the codebase: URL-driven tabs render
 * `<Link>` (so they are real, shareable, back-button-able navigation), and
 * local-state tabs render `<button>`. Passing `linkFor` selects the first.
 *
 * Adds `role="tablist"` and arrow-key navigation, which none of the
 * hand-rolled strips had.
 */

export interface AppTabItem<K extends string> {
	key: K;
	label: ReactNode;
	count?: number;
	disabled?: boolean;
}

interface AppTabsProps<K extends string> {
	items: readonly AppTabItem<K>[];
	active: K;
	/** Button mode. Ignored when `linkFor` is supplied. */
	onChange?: (key: K) => void;
	/** Router mode — return the `<Link>` props for a tab. */
	linkFor?: (key: K) => Pick<LinkProps, "to" | "params" | "search">;
	size?: "sm" | "md";
	/**
	 * `segmented` is the boxed pill strip (the default, as extracted).
	 * `underline` is the page-level treatment: no container, an active
	 * bottom rule, and a rule running the width of the page beneath.
	 * `pill` is free-standing outlined capsules with no container at all —
	 * the airiest of the three, for pages that put an action beside the tabs.
	 */
	variant?: "segmented" | "underline" | "pill";
	className?: string;
}

export function AppTabs<K extends string>({
	items,
	active,
	onChange,
	linkFor,
	size = "md",
	variant = "segmented",
	className,
}: AppTabsProps<K>) {
	const underline = variant === "underline";
	const pill = variant === "pill";
	const pad = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";
	const pillPad = size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm";

	const classFor = (key: K, disabled?: boolean) => {
		const dim = disabled ? "pointer-events-none opacity-50" : "";
		if (underline) {
			// -mb-px pulls each tab onto the strip's own border so the active
			// rule replaces it rather than stacking two lines.
			return `-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition ${
				active === key
					? "border-primary font-semibold text-foreground"
					: "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
			} ${dim}`;
		}
		if (pill) {
			// The active capsule carries the brand colour. A neutral fill was too
			// close to the page ground to read as "you are here" — on a light
			// background the selected tab simply disappeared.
			return `inline-flex items-center gap-1.5 rounded-full border font-medium transition ${pillPad} ${
				active === key
					? "border-primary bg-primary font-semibold text-primary-foreground"
					: "border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground"
			} ${dim}`;
		}
		return `rounded-md font-medium transition ${pad} ${
			active === key
				? "bg-primary text-primary-foreground"
				: "text-muted-foreground hover:bg-muted hover:text-foreground"
		} ${dim}`;
	};

	// Left/Right move between tabs the way a real tablist does.
	const onKeyDown = (e: React.KeyboardEvent, index: number) => {
		if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
		e.preventDefault();
		const step = e.key === "ArrowRight" ? 1 : -1;
		for (let i = 1; i <= items.length; i++) {
			const next = items[(index + step * i + items.length * i) % items.length];
			if (next && !next.disabled) {
				onChange?.(next.key);
				break;
			}
		}
	};

	return (
		<div
			role="tablist"
			className={`${
				underline
					? "flex flex-wrap items-center gap-1 border-b border-border"
					: pill
						? "flex flex-wrap items-center gap-2"
						: "inline-flex flex-wrap rounded-lg border border-border bg-card p-0.5"
			} ${className ?? ""}`}
		>
			{items.map((item, index) => {
				const body = (
					<>
						{item.label}
						{typeof item.count === "number" &&
							(underline ? (
								<span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
									{item.count}
								</span>
							) : pill ? (
								<span
									className={`text-xs font-normal ${
										active === item.key
											? "text-primary-foreground/75"
											: "text-muted-foreground"
									}`}
								>
									{item.count}
								</span>
							) : (
								<span className="ml-1.5 text-[11px] opacity-70">
									{item.count}
								</span>
							))}
					</>
				);

				if (linkFor) {
					return (
						<Link
							key={item.key}
							role="tab"
							aria-selected={active === item.key}
							className={classFor(item.key, item.disabled)}
							{...linkFor(item.key)}
						>
							{body}
						</Link>
					);
				}

				return (
					<button
						key={item.key}
						type="button"
						role="tab"
						aria-selected={active === item.key}
						tabIndex={active === item.key ? 0 : -1}
						disabled={item.disabled}
						onClick={() => onChange?.(item.key)}
						onKeyDown={(e) => onKeyDown(e, index)}
						className={classFor(item.key, item.disabled)}
					>
						{body}
					</button>
				);
			})}
		</div>
	);
}
