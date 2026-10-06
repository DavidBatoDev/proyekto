// web/src/components/time/review/OverLimitPanel.tsx
//
// The over-the-limit panel (ux.md › Approvals › Review screen, L12):
//
//   ⏱ Weekly limit 40h in the agreement with Acme Corp · 43:30 logged · 3:30 over
//      ☐ Approve the 3h 30m over the limit
//      Left unticked, 40:00 is approved for payment; the extra time stays on record.
//
// Only when a cap that cuts payable time is exceeded: the agreement's own
// weekly limit on an agreement sheet, or a team member's weekly or monthly
// cap (the freeze preview's `over_cap_seconds`). A workspace or team policy
// limit never lands here (D65). Rounding happens per entry first, then the
// cap, so the head's "logged" and "over" come from the freeze preview, like
// the checkbox and the hint (`overLimitHead`). Ticking it sends
// `approve_overtime: true` with the approval (the Approve dialog starts from
// this box) and the sheet reads "Overtime approved". Readers who can't
// approve see the line without the box.

import { Timer } from "lucide-react";
import { useId } from "react";
import { nativeSafe, overLimitCopy } from "@/lib/timeErrors";
import { cn } from "@/lib/utils";
import { overLimitHead, type SheetLimitReading } from "./reviewModel";

export interface OverLimitPanelProps {
	overSeconds: number;
	/** What is approved for payment when the box stays unticked. */
	payableSeconds: number;
	/** The sheet's time after per-entry rounding (the freeze preview's); falls back to the reading's logged time. */
	countedSeconds?: number | null;
	/** The agreement's weekly limit line, when the cap is the agreement's. */
	reading?: SheetLimitReading | null;
	/** The reader can approve: shows the box. */
	canDecide: boolean;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	disabled?: boolean;
	className?: string;
}

export function OverLimitPanel({
	overSeconds,
	payableSeconds,
	countedSeconds = null,
	reading,
	canDecide,
	checked,
	onCheckedChange,
	disabled = false,
	className,
}: OverLimitPanelProps) {
	const checkboxId = useId();
	const hintId = useId();
	if (!(overSeconds > 0)) return null;
	const copy = overLimitCopy({ overSeconds, payableSeconds });
	const head = overLimitHead({ overSeconds, countedSeconds }, reading);

	return (
		<section
			data-testid="review-over-limit"
			aria-label={nativeSafe(head)}
			className={cn(
				"space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm",
				className,
			)}
		>
			<p className="flex items-start gap-2 font-medium text-destructive">
				<Timer className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
				<span className="tabular-nums">{nativeSafe(head)}</span>
			</p>
			{canDecide ? (
				<div className="pl-6">
					<label
						htmlFor={checkboxId}
						className="flex cursor-pointer items-start gap-2 text-foreground"
					>
						<input
							id={checkboxId}
							type="checkbox"
							className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
							checked={checked}
							onChange={(e) => onCheckedChange(e.currentTarget.checked)}
							disabled={disabled}
							aria-describedby={hintId}
						/>
						<span className="font-semibold">{copy.checkbox}</span>
					</label>
					<p id={hintId} className="mt-1 text-xs text-muted-foreground">
						{nativeSafe(copy.hint)}
					</p>
				</div>
			) : null}
		</section>
	);
}
