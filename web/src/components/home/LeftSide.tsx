import { useDashboardContent } from "@/hooks/useDashboardContent";
import { DashboardEmptyState } from "./DashboardEmptyState";
import { DashboardWidgets } from "./DashboardWidgets";
import { ProjectsGrid } from "./ProjectsGrid";
import { RoadmapsGrid } from "./RoadmapsGrid";
import { TeamsGrid } from "./TeamsGrid";

/**
 * The dashboard body: teams, then projects, then the roadmaps inside them.
 *
 * Teams lead because they are the smallest section and the one you scan for a
 * face — the earlier worry, that a brand-new account met an empty Teams panel
 * before anything it could act on, is now handled by TeamsGrid rendering
 * nothing at all until it has a team or an invite, so the strip only ever
 * takes the top of the page when it has something in it.
 *
 * An account with nothing on it skips all of this for a single Get-started
 * card. While the lists are still loading the normal layout renders, so the
 * grids show their own skeletons instead of the page flickering through the
 * onboarding card on every refresh.
 */
export function PrimaryFlow() {
	const { isEmpty } = useDashboardContent();

	if (isEmpty) return <DashboardEmptyState />;

	return (
		<DashboardWidgets>
			<TeamsGrid />

			<ProjectsGrid />

			<RoadmapsGrid />
		</DashboardWidgets>
	);
}

export function LeftSide() {
	return (
		<div className="space-y-8">
			<TeamsGrid />
			<ProjectsGrid />
			<RoadmapsGrid />
		</div>
	);
}
