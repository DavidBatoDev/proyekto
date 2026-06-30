import {
	createFileRoute,
	Outlet,
	redirect,
	useRouterState,
} from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { ProjectSidebar } from "@/components/project/ProjectSidebar";
import { ProjectBottomNav } from "@/components/project/ProjectBottomNav";
import {
	useLinkedRoadmapQuery,
	useProjectDetailQuery,
} from "@/hooks/useProjectQueries";
import { useAuthStore } from "@/stores/authStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";

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
			<div className="app-shell-bg flex min-h-screen items-center justify-center">
				<Loader2 className="h-10 w-10 animate-spin text-slate-700" />
			</div>
		);
	}

	// Slice 2: the "Don't have a consultant yet" lock screen has been removed.
	// Project access is now governed entirely by project_shares.role via the
	// backend's ProjectAuthorizationService. The Overview tab shows a
	// non-blocking "Bring in a consultant" card when a marketplace project
	// has no consultant_id yet (rendered inside the overview component, not
	// at this route shell). Personal workspaces never show the card.

	return (
		<div className="app-shell-bg flex h-screen flex-col overflow-hidden pt-app-header">
			<div className="flex flex-1 overflow-hidden">
				{/* Sidebar — desktop only */}
				<div className="hidden md:block">
					<ProjectSidebar
						project={project}
						projectId={projectId}
						hasProject={!isRoadmapOnly && !!project}
						roadmapId={linkedRoadmapId ?? undefined}
						compactMode={isChatRoute}
					/>
				</div>

				{/* Bottom padding on mobile reserves space above the fixed bottom nav */}
				<main className="flex-1 overflow-hidden pb-app-nav md:pb-0">
					<Outlet />
				</main>
			</div>

			{/* Bottom nav — mobile only (self-hides on md+) */}
			<ProjectBottomNav
				projectId={projectId}
				hasProject={!isRoadmapOnly && !!project}
				roadmapId={linkedRoadmapId ?? undefined}
			/>
		</div>
	);
}
