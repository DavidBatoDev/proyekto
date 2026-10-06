// web/src/components/time/sheets/StaleRevisionBanner.tsx
//
// "Maria changed this timesheet while you were looking. [Review the latest]"
// (ux.md › Approvals › Stale revision, `STALE_REVISION` on `expected_revision`)
// and its bulk-approve sibling "Nothing was approved: Leo Cruz's timesheet
// changed. [Review]" (L24, A10).
//
// The banner carries copy from `lib/timeErrors.ts` only. Its one action is
// either a button (`onReviewLatest`: refetch in place) or a link to that
// sheet's review screen (`reviewTimesheetId`).

import { Link } from "@tanstack/react-router";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { staleRevisionCopy } from "@/lib/timeErrors";
import { cn } from "@/lib/utils";

export interface StaleRevisionBannerProps {
	/** Whose sheet changed ("Maria Santos" → "Maria changed this timesheet…"). Null on the viewer's own sheet. */
	personName?: string | null;
	/** Overrides the sentence (bulk approve, or another refusal shown in the same place). */
	message?: string | null;
	/** Overrides the action label ("Review" for bulk approve). */
	actionLabel?: string | null;
	/** Refetch in place ("Review the latest"). */
	onReviewLatest?: () => void;
	/** Or link to this sheet's review screen instead of a button. */
	reviewTimesheetId?: string | null;
	/** Shows a spinner on the button while the refetch runs. */
	busy?: boolean;
	/** Adds a dismiss button. */
	onDismiss?: () => void;
	/** `warning` (default) for a changed sheet; `danger` for a plain refusal. */
	tone?: "warning" | "danger";
	className?: string;
}

const ACTION_CLASS =
	"inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50";

export function StaleRevisionBanner({
	personName,
	message,
	actionLabel,
	onReviewLatest,
	reviewTimesheetId,
	busy = false,
	onDismiss,
	tone = "warning",
	className,
}: StaleRevisionBannerProps) {
	const copy = staleRevisionCopy({ subject: "timesheet", personName });
	const text = message?.trim() || copy.message;
	const label = actionLabel?.trim() || copy.actionLabel;
	return (
		<div
			role="alert"
			data-testid="stale-revision-banner"
			className={cn(
				"flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2 text-sm",
				tone === "danger"
					? "border-destructive/30 bg-destructive/10"
					: "border-warning/30 bg-warning/10",
				className,
			)}
		>
			<AlertTriangle
				className={cn(
					"h-4 w-4 shrink-0",
					tone === "danger" ? "text-destructive" : "text-warning",
				)}
				aria-hidden="true"
			/>
			<p className="min-w-0 flex-1 text-foreground">{text}</p>
			{reviewTimesheetId ? (
				<Link
					to="/time/timesheets/$timesheetId"
					params={{ timesheetId: reviewTimesheetId }}
					className={ACTION_CLASS}
				>
					{label}
				</Link>
			) : onReviewLatest ? (
				<button
					type="button"
					onClick={onReviewLatest}
					disabled={busy}
					className={ACTION_CLASS}
				>
					{busy ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
					) : null}
					{label}
				</button>
			) : null}
			{onDismiss ? (
				<button
					type="button"
					onClick={onDismiss}
					aria-label="Dismiss"
					className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<X className="h-3.5 w-3.5" aria-hidden="true" />
				</button>
			) : null}
		</div>
	);
}
