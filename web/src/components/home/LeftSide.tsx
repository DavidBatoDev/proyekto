import { DashboardWidgets } from "./DashboardWidgets";
import { ProjectsGrid } from "./ProjectsGrid";
import { RoadmapsGrid } from "./RoadmapsGrid";
import { TeamsGrid } from "./TeamsGrid";

export function PrimaryFlow() {
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
