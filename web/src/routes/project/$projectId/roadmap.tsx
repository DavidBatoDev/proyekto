import {
  createFileRoute,
  Outlet,
  useNavigate,
  useChildMatches,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Map, ExternalLink } from "lucide-react";
import { LinkRoadmapModal } from "@/components/roadmap/modals/LinkRoadmapModal";
import { RoadmapPageSkeleton } from "@/components/roadmap/views/RoadmapPageSkeleton";
import {
  AppEmptyState,
  AppSectionHeader,
  AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import {
  useInvalidateProjectQueries,
  useLinkedRoadmapQuery,
} from "@/hooks/useProjectQueries";
import { RequireProjectAccess } from "@/components/common/RequireProjectAccess";

export const Route = createFileRoute("/project/$projectId/roadmap")({
  component: RoadmapPage,
});

function RoadmapPage() {
  const { projectId } = Route.useParams();
  return (
    <RequireProjectAccess projectId={projectId} access="roadmap">
      <RoadmapPageBody />
    </RequireProjectAccess>
  );
}

function RoadmapPageBody() {
  const childMatches = useChildMatches();
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const linkedRoadmapQuery = useLinkedRoadmapQuery(projectId);
  const { invalidateLinkedRoadmap } = useInvalidateProjectQueries(projectId);

  useEffect(() => {
    if (childMatches.length > 0) return;
    const linkedRoadmapId = linkedRoadmapQuery.data?.id;
    if (!linkedRoadmapId) return;
    void navigate({
      to: "/project/$projectId/roadmap/$roadmapId",
      params: { projectId, roadmapId: linkedRoadmapId },
      replace: true,
    });
  }, [childMatches.length, linkedRoadmapQuery.data?.id, navigate, projectId]);

  if (childMatches.length > 0) {
    return <Outlet />;
  }

  if (linkedRoadmapQuery.isPending) {
    return <RoadmapPageSkeleton />;
  }

  return (
    <div className="app-shell-bg h-full w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-5 py-6 md:px-8 md:py-8">
        <AppSurfaceCard strong className="mb-6 p-6">
          <AppSectionHeader
            kicker="Planning"
            title="Roadmap"
            subtitle="View and manage this project's roadmap, milestones, and epics."
          />
        </AppSurfaceCard>

        <AppEmptyState
          icon={Map}
          title="No roadmap linked"
          description="This project doesn't have a roadmap yet. Create a new roadmap to start planning milestones, epics, and features."
          className="app-surface-card-strong border-dashed py-16"
          action={
            <div className="flex items-center justify-center gap-3">
              <Link
                to="/project/$projectId/roadmap/create"
                params={{ projectId }}
                className="app-cta inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white"
              >
                <ExternalLink className="w-4 h-4" />
                Create a Roadmap
              </Link>
              <button
                onClick={() => setIsLinkModalOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
              >
                Link Existing Roadmap
              </button>
            </div>
          }
        />
      </div>

      <LinkRoadmapModal
        isOpen={isLinkModalOpen}
        onClose={() => setIsLinkModalOpen(false)}
        projectId={projectId}
        onLinked={() => {
          setIsLinkModalOpen(false);
          void invalidateLinkedRoadmap();
        }}
      />
    </div>
  );
}

