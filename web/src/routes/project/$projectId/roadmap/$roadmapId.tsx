import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { RoadmapViewContent } from "@/components/roadmap";

export const Route = createFileRoute("/project/$projectId/roadmap/$roadmapId")({
  validateSearch: (search: Record<string, unknown>): { node?: string } => ({
    node: typeof search.node === "string" ? search.node : undefined,
  }),
  component: RoadmapViewPage,
});

function RoadmapViewPage() {
  const { projectId, roadmapId } = Route.useParams();
  const { node } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const handleFocusNodeConsumed = useCallback(() => {
    if (!node) return;
    void navigate({
      to: "/project/$projectId/roadmap/$roadmapId",
      params: { projectId, roadmapId },
      search: {},
      replace: true,
    });
  }, [navigate, node, projectId, roadmapId]);

  return (
    <RoadmapViewContent
      roadmapId={roadmapId}
      projectId={projectId}
      focusNodeId={node ?? null}
      onFocusNodeConsumed={handleFocusNodeConsumed}
    />
  );
}
