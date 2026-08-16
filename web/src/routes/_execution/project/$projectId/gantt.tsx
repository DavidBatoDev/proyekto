import {
	createFileRoute,
	Link,
	Outlet,
	useChildMatches,
	useNavigate,
} from "@tanstack/react-router";
import { ExternalLink, GanttChartSquare } from "lucide-react";
import { useEffect, useState } from "react";
import {
	AppEmptyState,
	AppSectionHeader,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { RequireProjectAccess } from "@/components/common/RequireProjectAccess";
import { LinkRoadmapModal } from "@/components/roadmap/modals/LinkRoadmapModal";
import { RoadmapPageSkeleton } from "@/components/roadmap/views/RoadmapPageSkeleton";
import {
	useInvalidateProjectQueries,
	useLinkedRoadmapQuery,
} from "@/hooks/useProjectQueries";

const parseStringParam = (value: unknown): string | undefined => {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
};

export const Route = createFileRoute("/_execution/project/$projectId/gantt")({
	validateSearch: (
		search: Record<string, unknown>,
	): {
		nodeId?: string;
	} => ({
		nodeId: parseStringParam(search.nodeId),
	}),
	component: GanttPage,
});

function GanttPage() {
	const { projectId } = Route.useParams();
	// Mirrors the roadmap route: roadmap-only mode ('n') has no project to
	// authorize against, and /projects/n/my-permissions 404s.
	if (projectId === "n") {
		return <GanttPageBody />;
	}
	return (
		<RequireProjectAccess projectId={projectId} access="roadmap">
			<GanttPageBody />
		</RequireProjectAccess>
	);
}

function GanttPageBody() {
	const childMatches = useChildMatches();
	const { projectId } = Route.useParams();
	const { nodeId } = Route.useSearch();
	const navigate = useNavigate();
	const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
	const linkedRoadmapQuery = useLinkedRoadmapQuery(
		projectId === "n" ? "" : projectId,
	);
	const { invalidateLinkedRoadmap } = useInvalidateProjectQueries(projectId);

	useEffect(() => {
		if (childMatches.length > 0) return;
		const linkedRoadmapId = linkedRoadmapQuery.data?.id;
		if (!linkedRoadmapId) return;
		void navigate({
			to: "/project/$projectId/gantt/$roadmapId",
			params: { projectId, roadmapId: linkedRoadmapId },
			search: nodeId ? { nodeId } : undefined,
			replace: true,
		});
	}, [
		childMatches.length,
		linkedRoadmapQuery.data?.id,
		navigate,
		nodeId,
		projectId,
	]);

	if (childMatches.length > 0) {
		return <Outlet />;
	}

	if (linkedRoadmapQuery.isPending || linkedRoadmapQuery.data?.id) {
		return <RoadmapPageSkeleton />;
	}

	return (
		<div className="app-shell-bg h-full w-full overflow-y-auto">
			<div className="mx-auto w-full max-w-4xl px-5 py-6 md:px-8 md:py-8">
				<AppSurfaceCard strong className="mb-6 p-6">
					<AppSectionHeader
						kicker="Planning"
						title="Gantt Chart"
						subtitle="Schedule this project's epics, features, and milestones on a timeline."
					/>
				</AppSurfaceCard>

				<AppEmptyState
					icon={GanttChartSquare}
					title="No roadmap linked"
					description="The Gantt chart is built from this project's roadmap. Create or link a roadmap to start scheduling."
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
								type="button"
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
