// web/src/components/time/review/FlagsLine.tsx
//
// What the decider should look at first (ux.md › Approvals › Review screen):
//
//   ⚠ Thu is 11h 40m · 1 entry over 10h · 2 entries added later   [Show flagged]
//
// The parts come from `reviewFlags` / `flagsLineParts`. "Show flagged" keeps
// only the entries behind the flags (10 h or more, stopped automatically,
// added later, still running) in the list below; a day over 8 h is shown on
// the grid itself. Nothing renders when nothing is flagged.

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { REVIEW_COPY } from "./reviewModel";

export interface FlagsLineProps {
	/** "Thu is 11h 40m", "1 entry over 10h", … (`flagsLineParts`). */
	parts: readonly string[];
	/** How many entries "Show flagged" keeps; 0 hides the button. */
	flaggedCount: number;
	/** The list shows only the flagged entries. */
	flaggedOnly: boolean;
	onToggleFlagged: () => void;
	className?: string;
}

export function FlagsLine({
	parts,
	flaggedCount,
	flaggedOnly,
	onToggleFlagged,
	className,
}: FlagsLineProps) {
	if (parts.length === 0) return null;
	return (
		<div
			data-testid="review-flags"
			className={cn(
				"flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground",
				className,
			)}
		>
			<AlertTriangle
				className="h-4 w-4 shrink-0 text-warning"
				aria-hidden="true"
			/>
			<p className="min-w-0 flex-1">{parts.join(" · ")}</p>
			{flaggedCount > 0 ? (
				<button
					type="button"
					onClick={onToggleFlagged}
					className="inline-flex shrink-0 items-center rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-10 max-sm:px-3.5"
				>
					{flaggedOnly ? REVIEW_COPY.showAll : REVIEW_COPY.showFlagged}
				</button>
			) : null}
		</div>
	);
}
