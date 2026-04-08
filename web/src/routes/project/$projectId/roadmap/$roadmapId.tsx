import { createFileRoute } from "@tanstack/react-router";
import { RoadmapViewContent } from "@/components/roadmap";

export const Route = createFileRoute("/project/$projectId/roadmap/$roadmapId")({
  component: RoadmapViewPage,
});

function RoadmapViewPage() {
  const { roadmapId } = Route.useParams();
  return (
    <div className="app-fade-in h-full w-full">
      <RoadmapViewContent roadmapId={roadmapId} />
    </div>
  );
}
