import { createFileRoute } from "@tanstack/react-router";
import { RoadmapBuilder } from "@/components/roadmap/RoadmapBuilder";

export const Route = createFileRoute("/project/$projectId/roadmap/create")({
	validateSearch: (search: Record<string, unknown>): { draftId?: string } => ({
		draftId: typeof search.draftId === "string" ? search.draftId : undefined,
	}),
	component: ProjectRoadmapCreatePage,
});

function ProjectRoadmapCreatePage() {
	const { projectId } = Route.useParams();
	const { draftId } = Route.useSearch();

	return (
		<div className="min-h-screen bg-background text-foreground">
			<RoadmapBuilder projectId={projectId} draftId={draftId} embedded />
		</div>
	);
}
