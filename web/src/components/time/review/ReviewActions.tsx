// web/src/components/time/review/ReviewActions.tsx
//
// The review screen's buttons (ux.md › Approvals › Review screen):
//
// | Reader                       | Buttons                                     |
// |------------------------------|---------------------------------------------|
// | Decider, Submitted           | [Return…] [Approve…]                        |
// | Decider, Approved            | [Reopen] (a note is required → Returned)    |
// | Submitter, Submitted         | [Withdraw]                                  |
// | Submitter, own auto/self     | [Reopen] (note optional → Open)             |
// | Submitter, approved by others| [Ask to reopen]                             |
// | Submitter, Open or Returned  | [Submit] / [Resubmit]                       |
//
// What shows is exactly what `viewer.actions` allows (`reviewButtons`). On a
// wide screen the buttons sit in the header; below 640 px they form a sticky
// bottom bar `[Return…] [Approve…]` that stays in view while the reader
// scrolls (ux.md › Mobile).

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
	REVIEW_COPY,
	type ReviewButton,
	type ReviewButtonId,
} from "./reviewModel";

const PRIMARY =
	"inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY =
	"inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export interface ReviewActionsProps {
	buttons: readonly ReviewButton[];
	onAction: (id: ReviewButtonId) => void;
	/** The button whose action is in flight (spinner, every button disabled). */
	busyId?: ReviewButtonId | null;
	/** Why the buttons are off for now (the sheet changed under the reader). */
	disabledReason?: string | null;
	/** `inline` in the header; `bar` the sticky bottom bar on phones. */
	layout?: "inline" | "bar";
	className?: string;
}

export function ReviewActions({
	buttons,
	onAction,
	busyId = null,
	disabledReason = null,
	layout = "inline",
	className,
}: ReviewActionsProps) {
	if (buttons.length === 0) return null;
	const disabled = Boolean(busyId) || Boolean(disabledReason);
	const bar = layout === "bar";
	const content = buttons.map((button) => (
		<button
			key={button.id}
			type="button"
			data-action={button.id}
			className={cn(
				button.primary ? PRIMARY : SECONDARY,
				bar && "min-h-11 flex-1",
			)}
			onClick={() => onAction(button.id)}
			disabled={disabled}
			title={disabledReason ?? undefined}
		>
			{busyId === button.id ? (
				<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
			) : null}
			{button.label}
		</button>
	));

	if (!bar) {
		return (
			<div
				role="group"
				aria-label={REVIEW_COPY.actionsLabel}
				className={cn("flex flex-wrap items-center gap-2", className)}
			>
				{content}
			</div>
		);
	}
	return (
		<div
			role="group"
			aria-label={REVIEW_COPY.actionsLabel}
			data-testid="review-action-bar"
			className={cn(
				"sticky bottom-0 z-30 -mx-4 flex items-center gap-2 border-t border-border bg-background/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/80",
				className,
			)}
		>
			{content}
		</div>
	);
}
