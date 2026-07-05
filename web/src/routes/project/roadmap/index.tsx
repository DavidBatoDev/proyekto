import { createFileRoute } from "@tanstack/react-router";
import { RoadmapBuilder } from "@/components/roadmap/RoadmapBuilder";

export const Route = createFileRoute("/project/roadmap/")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { projectId?: string; draftId?: string } => {
    return {
      projectId: typeof search.projectId === "string" ? search.projectId : undefined,
      draftId: typeof search.draftId === "string" ? search.draftId : undefined,
    };
  },
  component: RoadmapBuilderPage,
});

function RoadmapBuilderPage() {
  const { projectId, draftId } = Route.useSearch();
  return <RoadmapBuilder projectId={projectId} draftId={draftId} />;
}
