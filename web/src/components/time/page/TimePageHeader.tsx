// web/src/components/time/page/TimePageHeader.tsx
//
// The Time page's title row (ux.md › The Time Page):
//
//   Time ………………………………………………………… [⏳ Waiting for you · 3]     normal mode (hidden at 0)
//   Time …………………………………………………………………… [▶ Start timer]     approver mode
//
// The Waiting pill scrolls to the section (`#waiting`); the approver-mode
// pill is the collapsed timer bar, passed in by the page.

import { Hourglass } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const TIME_HEADER_COPY = {
	title: "Time",
	waiting: "Waiting for you",
} as const;

/** "Waiting for you · 3". */
export function waitingPillText(count: number): string {
	return `${TIME_HEADER_COPY.waiting} · ${count}`;
}

export interface TimePageHeaderProps {
	/** The overview's `approvals_waiting`; the pill hides at 0. */
	waitingCount?: number;
	/** Scrolls to Waiting for you. Without it, no pill. */
	onShowWaiting?: () => void;
	/** Right-hand content in approver mode (the Start timer pill). */
	action?: ReactNode;
	className?: string;
}

export function TimePageHeader({
	waitingCount = 0,
	onShowWaiting,
	action,
	className,
}: TimePageHeaderProps) {
	const showPill = Boolean(onShowWaiting) && waitingCount > 0;
	return (
		<header
			className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}
		>
			<h1 className="text-2xl font-bold tracking-tight text-foreground">
				{TIME_HEADER_COPY.title}
			</h1>
			<div className="ml-auto flex items-center gap-2">
				{showPill ? (
					<a
						href="#waiting"
						onClick={(event) => {
							event.preventDefault();
							onShowWaiting?.();
						}}
						className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-warning/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 max-sm:min-h-10"
						data-testid="waiting-pill"
					>
						<Hourglass
							className="h-3.5 w-3.5 text-warning-foreground"
							aria-hidden="true"
						/>
						{waitingPillText(waitingCount)}
					</a>
				) : null}
				{action}
			</div>
		</header>
	);
}
