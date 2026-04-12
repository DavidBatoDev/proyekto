import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import { RoadmapViewContent } from "@/components/roadmap";

type RoadmapDetailView = "roadmapView" | "timelineView";

const parseStringParam = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const parseViewParam = (value: unknown): RoadmapDetailView | undefined => {
  if (value === "roadmapView" || value === "timelineView") {
    return value;
  }
  return undefined;
};

export const Route = createFileRoute("/project/$projectId/roadmap/$roadmapId")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    nodeId?: string;
    node?: string;
    view?: RoadmapDetailView;
  } => ({
    nodeId: parseStringParam(search.nodeId),
    node: parseStringParam(search.node),
    view: parseViewParam(search.view),
  }),
  component: RoadmapViewPage,
});

function RoadmapViewPage() {
  const { projectId, roadmapId } = Route.useParams();
  const { nodeId, node, view } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const effectiveNodeId = nodeId ?? node;

  useEffect(() => {
    if (!node || nodeId) return;
    void navigate({
      to: "/project/$projectId/roadmap/$roadmapId",
      params: { projectId, roadmapId },
      search: {
        nodeId: node,
        view,
      },
      replace: true,
    });
  }, [navigate, node, nodeId, projectId, roadmapId, view]);

  const handleDeepLinkNodeConsumed = useCallback(
    (nextView: RoadmapDetailView) => {
      if (!effectiveNodeId) return;
      const normalizedNodeId = effectiveNodeId.trim();
      if (!normalizedNodeId) return;
      const isCanonicalSearch =
        node === undefined && nodeId === normalizedNodeId && view === nextView;
      if (isCanonicalSearch) return;

      void navigate({
        to: "/project/$projectId/roadmap/$roadmapId",
        params: { projectId, roadmapId },
        search: {
          nodeId: normalizedNodeId,
          view: nextView,
        },
        replace: true,
      });
    },
    [effectiveNodeId, navigate, node, nodeId, projectId, roadmapId, view],
  );

  const handleViewChange = useCallback(
    (nextView: RoadmapDetailView) => {
      const currentNodeId = nodeId ?? node;
      const isCanonicalSearch =
        node === undefined && nodeId === currentNodeId && view === nextView;
      if (isCanonicalSearch) return;

      void navigate({
        to: "/project/$projectId/roadmap/$roadmapId",
        params: { projectId, roadmapId },
        search: {
          nodeId: currentNodeId,
          view: nextView,
        },
        replace: true,
      });
    },
    [navigate, node, nodeId, projectId, roadmapId, view],
  );

  const handleNodeOpened = useCallback(
    (openedNodeId: string, nextView: RoadmapDetailView) => {
      const normalizedNodeId = openedNodeId.trim();
      if (!normalizedNodeId) return;

      const isCanonicalSearch =
        node === undefined && nodeId === normalizedNodeId && view === nextView;
      if (isCanonicalSearch) return;

      void navigate({
        to: "/project/$projectId/roadmap/$roadmapId",
        params: { projectId, roadmapId },
        search: {
          nodeId: normalizedNodeId,
          view: nextView,
        },
        replace: true,
      });
    },
    [navigate, node, nodeId, projectId, roadmapId, view],
  );

  const handleNodeClosed = useCallback(
    (nextView: RoadmapDetailView) => {
      const isCanonicalSearch =
        node === undefined && nodeId === undefined && view === nextView;
      if (isCanonicalSearch) return;

      void navigate({
        to: "/project/$projectId/roadmap/$roadmapId",
        params: { projectId, roadmapId },
        search: {
          view: nextView,
        },
        replace: true,
      });
    },
    [navigate, node, nodeId, projectId, roadmapId, view],
  );

  return (
    <RoadmapViewContent
      roadmapId={roadmapId}
      projectId={projectId}
      deepLinkNodeId={effectiveNodeId ?? null}
      urlView={view ?? null}
      onDeepLinkNodeConsumed={handleDeepLinkNodeConsumed}
      onViewChange={handleViewChange}
      onNodeOpened={handleNodeOpened}
      onNodeClosed={handleNodeClosed}
    />
  );
}
