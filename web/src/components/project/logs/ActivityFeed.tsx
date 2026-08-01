import { ClipboardList, Loader2, SearchX } from "lucide-react";
import { AppEmptyState } from "@/components/common/AppPrimitives";
import type { ActivityEntry } from "@/services/activity.service";
import { ActivityRow } from "./ActivityRow";
import { groupActivityByDay } from "./activityGrouping";

export function ActivityFeedSkeleton() {
	return (
		<ul className="divide-y divide-border" data-testid="activity-skeleton">
			{[0, 1, 2, 3, 4, 5].map((i) => (
				<li key={i} className="flex items-center gap-3 px-4 py-3">
					<span className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-muted" />
					<span className="h-6 w-6 shrink-0 animate-pulse rounded-full bg-muted" />
					<span
						className="h-4 flex-1 animate-pulse rounded bg-muted"
						style={{ maxWidth: `${70 - i * 6}%` }}
					/>
				</li>
			))}
		</ul>
	);
}

export function ActivityFeed({
	items,
	hasFilters,
	hasNextPage,
	isFetchingNextPage,
	onLoadMore,
	onClearFilters,
	canViewSensitive,
}: {
	items: ActivityEntry[];
	hasFilters: boolean;
	hasNextPage: boolean;
	isFetchingNextPage: boolean;
	onLoadMore: () => void;
	onClearFilters: () => void;
	canViewSensitive: boolean;
}) {
	if (items.length === 0) {
		// A filtered-empty feed must never read as "nothing ever happened" —
		// on an audit surface that is a materially different claim.
		return hasFilters ? (
			<AppEmptyState
				icon={SearchX}
				title="No activity matches these filters"
				description="Try a wider date range, or clear the filters to see everything."
				className="border-dashed py-16"
				action={
					<button
						type="button"
						onClick={onClearFilters}
						className="rounded-lg border border-input px-3 py-1.5 text-sm font-medium hover:bg-muted"
					>
						Clear filters
					</button>
				}
			/>
		) : (
			<AppEmptyState
				icon={ClipboardList}
				title="No activity yet"
				description="Changes to the roadmap, tasks, and people will appear here."
				className="border-dashed py-16"
			/>
		);
	}

	const groups = groupActivityByDay(items);

	return (
		<div data-testid="activity-feed">
			{groups.map((group) => (
				<section key={group.key}>
					<h3
						data-testid={`activity-day-${group.key}`}
						className="sticky top-0 z-10 border-y border-border bg-muted/60 px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground backdrop-blur"
					>
						{group.label}
					</h3>
					<ul className="divide-y divide-border">
						{group.items.map((entry) => (
							<ActivityRow key={entry.id} entry={entry} />
						))}
					</ul>
				</section>
			))}

			<div className="flex flex-col items-center gap-2 px-4 py-4">
				{hasNextPage ? (
					<button
						type="button"
						onClick={onLoadMore}
						disabled={isFetchingNextPage}
						data-testid="activity-load-more"
						className="inline-flex items-center gap-2 rounded-lg border border-input px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60"
					>
						{isFetchingNextPage ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : null}
						Load more
					</button>
				) : null}

				{!canViewSensitive ? (
					// Honest omission beats silent omission on an audit surface.
					<p
						data-testid="activity-sensitive-notice"
						className="text-center text-xs text-muted-foreground"
					>
						Some entries are hidden. Viewing them requires the{" "}
						<span className="font-medium">View sensitive logs</span> permission.
					</p>
				) : null}
			</div>
		</div>
	);
}
