import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";
import { ProjectSidebar } from "@/components/project/ProjectSidebar";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowRight, ListChecks, Loader2, Map, UserCheck } from "lucide-react";
import Logo from "/prodigylogos/light/logovector.svg";
import {
  useLinkedRoadmapQuery,
  useProjectDetailQuery,
} from "@/hooks/useProjectQueries";

export const Route = createFileRoute("/project/$projectId")({
  beforeLoad: () => {
    const { isAuthenticated } = useAuthStore.getState();
    if (!isAuthenticated) {
      throw redirect({ to: "/auth/login" });
    }
  },
  component: ProjectLayout,
});

function ProjectLayout() {
  const { projectId } = Route.useParams();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const setSidebarExpanded = useProjectSettingsStore(
    (state) => state.setSidebarExpanded,
  );
  const isRoadmapOnly = projectId === "n";
  const projectQuery = useProjectDetailQuery(isRoadmapOnly ? "" : projectId);
  const linkedRoadmapQuery = useLinkedRoadmapQuery(
    isRoadmapOnly ? "" : projectId,
  );
  const project = isRoadmapOnly ? null : (projectQuery.data ?? null);
  const linkedRoadmapId = linkedRoadmapQuery.data?.id ?? null;
  const isChatRoute = currentPath.includes(`/project/${projectId}/chat`);
  const isLoading =
    !isRoadmapOnly && (projectQuery.isPending || linkedRoadmapQuery.isPending);

  // Auto-open project sidebar when navigating to project pages (non-roadmap)
  useEffect(() => {
    setSidebarExpanded(true);
  }, [setSidebarExpanded]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f6f7f8] flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-[#ff9933]" />
      </div>
    );
  }

  const hasConsultant = Boolean(project?.consultant_id);

  // Allow only roadmap/work-items detail pages before consultant assignment.
  const isRoadmapDetailPage = /^\/project\/[^/]+\/roadmap\/[^/]+$/.test(
    currentPath,
  );
  const isWorkItemsDetailPage = /^\/project\/[^/]+\/work-items\/[^/]+$/.test(
    currentPath,
  );
  const canUseWithoutConsultant = isRoadmapDetailPage || isWorkItemsDetailPage;
  const shouldShowNoConsultantEmptyState =
    !isRoadmapOnly && !!project && !hasConsultant && !canUseWithoutConsultant;

  if (shouldShowNoConsultantEmptyState) {
    return (
      <div className="flex flex-col h-screen bg-[#f6f7f8] overflow-hidden pt-14">
        <main className="relative flex-1 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-24 -left-16 h-72 w-72 rounded-full bg-orange-100 blur-3xl opacity-80" />
            <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-rose-100 blur-3xl opacity-70" />
          </div>

          <div className="relative h-full flex items-center justify-center px-6 py-8">
            <div className="w-full max-w-3xl rounded-3xl border border-orange-200 bg-white/95 backdrop-blur p-8 md:p-10 shadow-[0_18px_60px_rgba(0,0,0,0.08)]">
              <div className="flex flex-col items-center text-center">
                <img src={Logo} alt="Prodigy" className="h-8 mb-6" />

                <div className="mb-4 w-16 h-16 rounded-2xl bg-orange-100 flex items-center justify-center">
                  <UserCheck className="w-8 h-8 text-orange-500" />
                </div>

                <h2 className="text-2xl md:text-3xl font-semibold text-gray-900 mb-3">
                  Don&apos;t have a consultant yet
                </h2>
                <p className="text-sm md:text-base text-gray-600 max-w-2xl mb-7">
                  This page unlocks after a consultant is assigned. You can
                  still continue planning by using your roadmap and work items.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                <div className="rounded-2xl border border-orange-100 bg-orange-50/70 p-4">
                  <div className="flex items-center gap-2 text-orange-700 font-semibold mb-2">
                    <Map className="w-4 h-4" />
                    Roadmap stays available
                  </div>
                  <p className="text-sm text-gray-600">
                    Keep refining milestones, epics, and features while waiting
                    for consultant assignment.
                  </p>
                </div>

                <div className="rounded-2xl border border-orange-100 bg-orange-50/70 p-4">
                  <div className="flex items-center gap-2 text-orange-700 font-semibold mb-2">
                    <ListChecks className="w-4 h-4" />
                    Work items stay available
                  </div>
                  <p className="text-sm text-gray-600">
                    Continue preparing your backlog and task breakdown to speed
                    up delivery once a consultant joins.
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                {linkedRoadmapId ? (
                  <>
                    <Link
                      to="/project/$projectId/roadmap/$roadmapId"
                      params={{ projectId, roadmapId: linkedRoadmapId }}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#ff9933] text-white text-sm font-semibold hover:bg-[#e68829] transition-colors"
                    >
                      Open Roadmap
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                    <Link
                      to="/project/$projectId/work-items/$roadmapId"
                      params={{ projectId, roadmapId: linkedRoadmapId }}
                      className="w-full sm:w-auto inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors"
                    >
                      Open Work Items
                    </Link>
                  </>
                ) : (
                  <span className="text-sm text-gray-500">
                    Link or create a roadmap first to continue.
                  </span>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#f6f7f8] overflow-hidden pt-14">
      <div className="flex flex-1 overflow-hidden">
        <ProjectSidebar
          project={project}
          projectId={projectId}
          hasProject={!isRoadmapOnly && !!project}
          roadmapId={linkedRoadmapId ?? undefined}
          compactMode={isChatRoute}
        />
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
