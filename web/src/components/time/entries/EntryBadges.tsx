// web/src/components/time/entries/EntryBadges.tsx
//
// An entry's settlement and legacy badges (ux.md › Submit, Return, Reopen ›
// Entry badge):
//
//   Paid                    payout_id set             row + detail, web and native
//   Billed                  on an invoice             row + detail, web only, cost viewers
//   Paid outside Proyekto   legacy paid_outside       detail only
//   Not approved (legacy)   legacy rejected (0 paid)  detail only
//
// Theme tokens only: the Paid badge is blue (`info` fill, `info-foreground`
// text: the solid hue is for fills and too faint as a word).

import { cn } from "@/lib/utils";
import type { TimeEntryView } from "@/services/time.types";
import {
	BADGE_LABEL,
	type EntryBadgeKind,
	entryBadgeKinds,
} from "./entryRules";

const BADGE_CLASS: Record<EntryBadgeKind, string> = {
	paid: "border-info/30 bg-info/10 text-info-foreground",
	billed: "border-primary/30 bg-primary/10 text-primary",
	paid_outside: "border-border bg-muted text-muted-foreground",
	legacy_rejected: "border-warning/40 bg-warning/10 text-foreground",
};

export interface EntryBadgesProps {
	entry: Pick<
		TimeEntryView,
		"payout_id" | "legacy_status" | "cost" | "locked_reason"
	>;
	/** `row` (default): Paid and Billed. `detail`: the legacy markers too. */
	variant?: "row" | "detail";
	/** Defaults to `isNativeApp()`. */
	native?: boolean;
	className?: string;
}

/** A single badge, for callers that already know which one to show. */
export function EntryBadge({
	kind,
	size = "sm",
}: {
	kind: EntryBadgeKind;
	size?: "sm" | "md";
}) {
	return (
		<span
			data-badge={kind}
			className={cn(
				"inline-flex shrink-0 items-center rounded-md border font-semibold",
				size === "sm"
					? "px-1.5 py-px text-[10px] leading-4"
					: "px-2 py-0.5 text-[11px]",
				BADGE_CLASS[kind],
			)}
		>
			{BADGE_LABEL[kind]}
		</span>
	);
}

/** Renders nothing when the entry has no badge. */
export function EntryBadges({
	entry,
	variant = "row",
	native,
	className,
}: EntryBadgesProps) {
	const kinds = entryBadgeKinds(entry, { variant, native });
	if (kinds.length === 0) return null;
	return (
		<span
			className={cn("inline-flex flex-wrap items-center gap-1", className)}
			data-testid="entry-badges"
		>
			{kinds.map((kind) => (
				<EntryBadge
					key={kind}
					kind={kind}
					size={variant === "detail" ? "md" : "sm"}
				/>
			))}
		</span>
	);
}
