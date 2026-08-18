import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The app's neutral button pair.
 *
 * These carry no surface identity, which is the point: they started life inside
 * `delivery/DeliveryPrimitives.tsx` and were used by ~20 files across four
 * unrelated pages, so they were never really "delivery" primitives. Shared
 * infrastructure that several surfaces reach for — the roadmap-link picker, for
 * one — needs a button that belongs to none of them.
 *
 * A surface that wants its own visual signature defines its own button instead
 * of restyling this one.
 */
export function AppPrimaryButton({
	children,
	onClick,
	disabled,
	loading = false,
	type = "button",
	form,
}: {
	children: ReactNode;
	onClick?: () => void;
	disabled?: boolean;
	/** Swaps the leading icon for a spinner and blocks a second submit. */
	loading?: boolean;
	type?: "button" | "submit";
	/** Submits a form by id — lets the button live in a dialog footer, outside the <form>. */
	form?: string;
}) {
	return (
		<button
			type={type === "submit" ? "submit" : "button"}
			form={form}
			onClick={onClick}
			disabled={disabled || loading}
			className="app-cta inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
		>
			{loading && <Loader2 className="h-4 w-4 animate-spin" />}
			{children}
		</button>
	);
}

export function AppSecondaryButton({
	children,
	onClick,
	disabled,
	tone = "neutral",
}: {
	children: ReactNode;
	onClick?: () => void;
	disabled?: boolean;
	tone?: "neutral" | "danger";
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
				tone === "danger"
					? "border-destructive/30 text-destructive hover:bg-destructive/10"
					: "border-border text-foreground hover:bg-muted"
			}`}
		>
			{children}
		</button>
	);
}
