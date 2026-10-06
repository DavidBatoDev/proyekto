// web/src/components/time/review/HistoryList.tsx
//
// The sheet's history (ux.md › Approvals › Review screen):
//
//   History: Imported from per-entry review Sep 29 · Returned Sep 30 'Split Thu' · Resubmitted Oct 1
//
// Oldest first, one item per `timesheet_events` row, dates in the sheet's
// timezone (the full time on hover). Notes stay in the history after a
// return is fixed. The items come from `historyItems`.

import { useId } from "react";
import { cn } from "@/lib/utils";
import { type HistoryItem, REVIEW_COPY } from "./reviewModel";

export interface HistoryListProps {
	items: readonly HistoryItem[];
	className?: string;
}

export function HistoryList({ items, className }: HistoryListProps) {
	const headingId = useId();
	return (
		<section
			aria-labelledby={headingId}
			data-testid="review-history"
			className={cn("space-y-2", className)}
		>
			<h2
				id={headingId}
				className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
			>
				{REVIEW_COPY.history}
			</h2>
			{items.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{REVIEW_COPY.historyEmpty}
				</p>
			) : (
				<ol className="space-y-1.5 border-l border-border pl-4">
					{items.map((item) => (
						<li
							key={item.id}
							className="relative text-sm text-foreground before:absolute before:-left-[1.3rem] before:top-1.5 before:h-2 before:w-2 before:rounded-full before:bg-muted-foreground/40"
						>
							<span className="font-medium">{item.text}</span>{" "}
							<time
								dateTime={item.at}
								title={item.when}
								className="text-muted-foreground"
							>
								{item.day}
							</time>
							{item.note ? (
								<span className="block break-words text-muted-foreground">
									'{item.note}'
								</span>
							) : null}
						</li>
					))}
				</ol>
			)}
		</section>
	);
}
