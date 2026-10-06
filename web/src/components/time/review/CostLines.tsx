// web/src/components/time/review/CostLines.tsx
//
// The sheet's money (ux.md › Approvals › Review screen, Amounts L64):
//
//   Estimated cost: PHP 6,885.00 · USD 120.00 (final at approval)   ← before approval
//   Amount at approval: PHP 6,885.00                               ← after
//
// One line per currency, never summed across currencies. Only for a reader
// who can see cost (`sheetCost` reads the decider's freeze preview, or the
// entries when every one of them is cost-visible), never on native for an
// agreement sheet, never to client-side admins (the backend hides cost from
// them). `AmountLines` applies the native rule.

import {
	AmountLines,
	amountsAllowed,
} from "@/components/time/entries/AmountLines";
import { cn } from "@/lib/utils";
import type { SheetScopeKind } from "@/services/time.types";
import { REVIEW_COPY, type SheetCost } from "./reviewModel";

export interface CostLinesProps {
	cost: SheetCost | null;
	kind: SheetScopeKind;
	native?: boolean;
	className?: string;
}

export function CostLines({ cost, kind, native, className }: CostLinesProps) {
	if (!cost || !amountsAllowed({ cost: "visible", kind, native })) {
		return null;
	}
	const estimate = cost.kind === "estimate";
	return (
		<p
			data-testid="review-cost"
			className={cn("text-sm text-muted-foreground", className)}
		>
			<AmountLines
				amounts={cost.amounts}
				cost="visible"
				kind={kind}
				native={native}
				prefix={
					<span className="text-muted-foreground">
						{estimate
							? REVIEW_COPY.estimatedCost
							: REVIEW_COPY.amountAtApproval}
					</span>
				}
				suffix={estimate ? REVIEW_COPY.finalAtApproval : undefined}
			/>
		</p>
	);
}
