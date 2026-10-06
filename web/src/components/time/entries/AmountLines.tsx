// web/src/components/time/entries/AmountLines.tsx
//
// Money as ux.md › Formats writes it: "PHP 6,885.00", one line per currency,
// never summed across currencies. The one gate for showing an amount:
//
// - never when the viewer's cost is hidden (`cost: 'hidden'`);
// - never on native for agreement time (`engagement` sheets, `assignment`
//   entries; ux.md › Mobile);
// - nothing at all when there is no amount to show (`empty` aside).
//
// Used for an entry's cost in the table and the detail modal, and reusable
// for sheet totals ("Estimated cost: … (final at approval)", W2-2) and report
// totals (W1-5).

import type { ReactNode } from "react";
import { canShowAmounts, joinMoneyLines, moneyLines } from "@/lib/timeFormat";
import { cn } from "@/lib/utils";
import type { ContextKind, SheetScopeKind } from "@/services/time.types";

export interface AmountLinesProps {
	/** Amount per currency code (`amounts_by_currency`, or one entry's `{ PHP: 450 }`). */
	amounts: Readonly<Record<string, number | null>> | null | undefined;
	/** The viewer's cost class; `hidden` renders nothing. */
	cost?: "visible" | "hidden" | null;
	/** The context or sheet scope kind; agreement kinds render nothing on native. */
	kind?: ContextKind | SheetScopeKind | null;
	/** Defaults to `isNativeApp()`. */
	native?: boolean;
	/** `inline` (default): "PHP 6,885.00 · USD 120.00". `stacked`: one line each. */
	layout?: "inline" | "stacked";
	/** Before the amounts ("Estimated cost:"). */
	prefix?: ReactNode;
	/** After the amounts ("(final at approval)"). */
	suffix?: ReactNode;
	/** Shown when amounts may show but there are none ("—"). */
	empty?: ReactNode;
	/** `muted` for an estimate. */
	tone?: "default" | "muted";
	title?: string;
	className?: string;
}

/** True when an amount may be shown for this viewer and kind. */
export function amountsAllowed(options: {
	cost?: "visible" | "hidden" | null;
	kind?: ContextKind | SheetScopeKind | null;
	native?: boolean;
}): boolean {
	return canShowAmounts(options);
}

export function AmountLines({
	amounts,
	cost,
	kind,
	native,
	layout = "inline",
	prefix,
	suffix,
	empty = null,
	tone = "default",
	title,
	className,
}: AmountLinesProps) {
	if (!canShowAmounts({ cost, kind, native })) return null;
	const lines = moneyLines(amounts);
	if (lines.length === 0) {
		return empty === null ? null : (
			<span className={cn("text-muted-foreground", className)}>{empty}</span>
		);
	}
	const toneClass =
		tone === "muted" ? "text-muted-foreground" : "text-foreground";
	if (layout === "stacked") {
		return (
			<span
				className={cn(
					"inline-flex flex-col tabular-nums",
					toneClass,
					className,
				)}
				title={title}
				data-testid="amount-lines"
			>
				{prefix ? <span>{prefix}</span> : null}
				{lines.map((line) => (
					<span key={line}>{line}</span>
				))}
				{suffix ? (
					<span className="text-muted-foreground">{suffix}</span>
				) : null}
			</span>
		);
	}
	return (
		<span
			className={cn("tabular-nums", toneClass, className)}
			title={title}
			data-testid="amount-lines"
		>
			{prefix ? <>{prefix} </> : null}
			{joinMoneyLines(lines)}
			{suffix ? (
				<>
					{" "}
					<span className="text-muted-foreground">{suffix}</span>
				</>
			) : null}
		</span>
	);
}
