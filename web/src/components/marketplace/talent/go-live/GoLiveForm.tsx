import type { ReactNode } from "react";

/**
 * The form vocabulary for the Go live wizard.
 *
 * These exist because the route previously repeated the same eight-class input
 * string at every field and carried 25 copies of `#3b82f6`, 20 of `#333438` and
 * a `bg-white`/`border-gray-200` surface at every level. None of that inverts,
 * so the page was light-only in an app that ships four themes. Colour now lives
 * here, in tokens, and the steps describe structure instead of paint.
 *
 * The selected/unselected treatment matches the marketplace survey modal and
 * the browse cards (`border-primary bg-primary/5`), so the wizard reads as part
 * of the marketplace rather than as a separate product.
 */

/**
 * The wizard's input surface. Same tokens as `common/FormFields`' INPUT_CLASS —
 * `border-input`, `bg-card`, and the `focus:border-primary` + `ring-primary/25`
 * focus treatment — at the larger scale this page uses, so focus and disabled
 * states behave identically to the rest of the app.
 */
const FIELD_SURFACE =
	"w-full rounded-xl border border-input bg-card px-4 py-3 text-sm text-card-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-70";

export function GoLiveField({
	label,
	required,
	hint,
	htmlFor,
	children,
}: {
	label: string;
	required?: boolean;
	hint?: string;
	htmlFor?: string;
	children: ReactNode;
}) {
	return (
		<div>
			<label
				htmlFor={htmlFor}
				className="mb-2 block text-sm font-semibold text-foreground"
			>
				{label}
				{required && (
					<span className="ml-0.5 text-destructive" aria-hidden="true">
						*
					</span>
				)}
				{required && <span className="sr-only"> (required)</span>}
			</label>
			{children}
			{hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
		</div>
	);
}

export function GoLiveInput({
	prefix,
	className,
	...props
}: React.InputHTMLAttributes<HTMLInputElement> & { prefix?: string }) {
	if (prefix) {
		return (
			<div className="relative">
				<span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-medium text-muted-foreground">
					{prefix}
				</span>
				<input
					{...props}
					className={`${FIELD_SURFACE} pl-8 ${className ?? ""}`}
				/>
			</div>
		);
	}
	return <input {...props} className={`${FIELD_SURFACE} ${className ?? ""}`} />;
}

/**
 * One selectable tile. `as` picks radio or checkbox semantics — the skills step
 * is multi-select, every other choice step is single-select — but the visual
 * treatment is shared so the wizard does not change character between steps.
 */
export function GoLiveChoiceCard({
	as = "radio",
	name,
	value,
	label,
	description,
	checked,
	onChange,
}: {
	as?: "radio" | "checkbox";
	name?: string;
	value?: string;
	label: string;
	description?: string;
	checked: boolean;
	onChange: () => void;
}) {
	return (
		<label
			className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${
				checked
					? "border-primary bg-primary/5"
					: "border-border bg-card hover:border-primary/50 hover:bg-muted/40"
			}`}
		>
			<input
				type={as}
				name={name}
				value={value}
				checked={checked}
				onChange={onChange}
				className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
			/>
			<span className="min-w-0">
				<span className="block text-sm font-semibold text-foreground">
					{label}
				</span>
				{description && (
					<span className="mt-0.5 block text-xs text-muted-foreground">
						{description}
					</span>
				)}
			</span>
		</label>
	);
}

/** A card surface — the marketplace's `bg-card border-border`, not `bg-white`. */
export function GoLivePanel({
	className,
	children,
}: {
	className?: string;
	children: ReactNode;
}) {
	return (
		<div
			className={`rounded-2xl border border-border bg-card p-6 shadow-sm ${className ?? ""}`}
		>
			{children}
		</div>
	);
}

/**
 * Info / caution / error banners.
 *
 * Alpha tints over the theme surface rather than the `bg-blue-50` and
 * `bg-amber-50` the route used, which turn into near-white slabs in dark mode.
 * The `dark:` text variants keep the label legible once the tint sits on a dark
 * ground — the pattern already used by the project activity log.
 */
const CALLOUT_TONES = {
	info: "border-primary/25 bg-primary/5 text-foreground",
	caution:
		"border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
	danger: "border-destructive/30 bg-destructive/10 text-destructive",
} as const;

export function GoLiveCallout({
	tone = "info",
	icon,
	children,
}: {
	tone?: keyof typeof CALLOUT_TONES;
	icon?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div
			className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${CALLOUT_TONES[tone]}`}
		>
			{icon && <span className="mt-0.5 shrink-0">{icon}</span>}
			<div className="min-w-0">{children}</div>
		</div>
	);
}
