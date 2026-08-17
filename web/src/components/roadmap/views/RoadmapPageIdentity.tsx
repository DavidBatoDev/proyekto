import { Map as MapIcon } from "lucide-react";

/** Width of the canvas's left panel — the identity fills that column so the
 *  epic tabs beside it still line up with the canvas itself. */
const LEFT_PANEL_WIDTH = 320;

/**
 * "You are on the Roadmap page", rendered inside `RoadmapTopBar`.
 *
 * Deliberately separate from `TimelinePageIdentity`: the two pages share the
 * top bar shell but are different surfaces, and a shared identity component
 * parameterised by view mode is how the Timeline ended up announcing itself as
 * "Roadmap" in the first place.
 */
export function RoadmapPageIdentity() {
	return (
		<div
			className="flex shrink-0 items-center gap-2.5 px-4"
			style={{ width: LEFT_PANEL_WIDTH }}
		>
			<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-card">
				<MapIcon className="h-4 w-4 text-foreground" />
			</div>
			<div className="min-w-0 leading-tight">
				<h1 className="text-sm font-semibold text-foreground">Roadmap</h1>
				<p className="hidden truncate text-[11px] text-muted-foreground md:block">
					Epics, features, and tasks on one canvas
				</p>
			</div>
		</div>
	);
}
