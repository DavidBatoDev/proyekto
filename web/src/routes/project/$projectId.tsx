import {
	createFileRoute,
	Link,
	Outlet,
	redirect,
	useRouterState,
} from "@tanstack/react-router";
import {
	ArrowRight,
	ListChecks,
	Loader2,
	Map as MapIcon,
	UserCheck,
} from "lucide-react";
import { useEffect } from "react";
import { ProjectSidebar } from "@/components/project/ProjectSidebar";
import {
	useLinkedRoadmapQuery,
	useProjectDetailQuery,
} from "@/hooks/useProjectQueries";
import { useAuthStore } from "@/stores/authStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import Logo from "/prodigylogos/light/logovector.svg";

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
			<div className="app-shell-bg flex h-screen flex-col overflow-hidden pt-14">
				<main className="relative flex-1 overflow-hidden">
					<div className="absolute inset-0 pointer-events-none">
						<div className="absolute -top-24 -left-16 h-72 w-72 rounded-full bg-cyan-200/45 blur-3xl opacity-80" />
						<div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-amber-200/40 blur-3xl opacity-70" />
					</div>

					<div className="relative flex h-full items-center justify-center px-6 py-8">
						<div className="app-surface-card-strong w-full max-w-3xl p-8 md:p-10">
							<div className="flex flex-col items-center text-center">
								<img src={Logo} alt="Prodigy" className="h-8 mb-6" />

								<div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
									<UserCheck className="h-8 w-8 text-slate-700" />
								</div>

								<h2 className="mb-3 text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
									Don&apos;t have a consultant yet
								</h2>
								<p className="mb-7 max-w-2xl text-sm text-slate-600 md:text-base">
									This page unlocks after a consultant is assigned. You can
									still continue planning by using your roadmap and work items.
								</p>
							</div>

							<div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
								<div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
									<div className="mb-2 flex items-center gap-2 font-semibold text-slate-800">
										<MapIcon className="w-4 h-4" />
										Roadmap stays available
									</div>
									<p className="text-sm text-slate-600">
										Keep refining milestones, epics, and features while waiting
										for consultant assignment.
									</p>
								</div>

								<div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
									<div className="mb-2 flex items-center gap-2 font-semibold text-slate-800">
										<ListChecks className="w-4 h-4" />
										Work items stay available
									</div>
									<p className="text-sm text-slate-600">
										Continue preparing your backlog and task breakdown to speed
										up delivery once a consultant joins.
									</p>
								</div>
							</div>

							<div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
								{linkedRoadmapId ? (
									<>
										<Link
											to="/project/$projectId/roadmap/$roadmapId"
											params={{ projectId, roadmapId: linkedRoadmapId }}
											className="app-cta inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white sm:w-auto"
										>
											Open Roadmap
											<ArrowRight className="w-4 h-4" />
										</Link>
										<Link
											to="/project/$projectId/work-items/$roadmapId"
											params={{ projectId, roadmapId: linkedRoadmapId }}
											className="inline-flex w-full items-center justify-center rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 sm:w-auto"
										>
											Open Work Items
										</Link>
									</>
								) : (
									<span className="text-sm text-slate-500">
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
		<div className="app-shell-bg flex h-screen flex-col overflow-hidden pt-14">
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
