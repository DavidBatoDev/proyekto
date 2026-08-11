import { createFileRoute } from "@tanstack/react-router";
import { RoadmapBuilder } from "@/components/roadmap/RoadmapBuilder";

export const Route = createFileRoute("/_execution/project/$projectId/roadmap/create")({
	validateSearch: (search: Record<string, unknown>): { draftId?: string } => ({
		draftId: typeof search.draftId === "string" ? search.draftId : undefined,
	}),
	component: ProjectRoadmapCreatePage,
});

function ProjectRoadmapCreatePage() {
	const { projectId } = Route.useParams();
	const { draftId } = Route.useSearch();

	return (
		// The project shell is a fixed-height flex layout with overflow-hidden, so
		// this page owns a definite height (not min-h-screen) - otherwise the
		// builder's embedded `h-full` scroll container resolves to auto and its
		// content is clipped instead of scrolling.
		<div className="h-full min-h-0 bg-background text-foreground">
			<RoadmapBuilder projectId={projectId} draftId={draftId} embedded />
		</div>
	);
}
