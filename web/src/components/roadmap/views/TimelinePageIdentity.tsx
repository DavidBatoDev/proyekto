import { CalendarRange } from "lucide-react";

/**
 * "You are on the Timeline page", rendered inside `RoadmapTopBar`.
 *
 * Unlike {@link RoadmapPageIdentity} this doesn't reserve the left panel's
 * column: the milestones view hides that panel, so a fixed-width block would
 * leave a gap with nothing beneath it.
 */
export function TimelinePageIdentity() {
	return (
		<div className="flex shrink-0 items-center gap-2.5 px-4">
			<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-card">
				<CalendarRange className="h-4 w-4 text-foreground" />
			</div>
			<div className="min-w-0 leading-tight">
				<h1 className="text-sm font-semibold text-foreground">Timeline</h1>
				<p className="hidden truncate text-[11px] text-muted-foreground md:block">
					Milestones and delivery dates across the roadmap
				</p>
			</div>
		</div>
	);
}
