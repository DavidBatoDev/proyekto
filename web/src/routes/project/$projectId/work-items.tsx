import {
	createFileRoute,
	Link,
	Outlet,
	useChildMatches,
	useNavigate,
} from "@tanstack/react-router";
import { ExternalLink, ListChecks } from "lucide-react";
import { useEffect, useState } from "react";
import {
	AppEmptyState,
	AppSectionHeader,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { LinkRoadmapModal } from "@/components/roadmap/modals/LinkRoadmapModal";
import { RoadmapPageSkeleton } from "@/components/roadmap/views/RoadmapPageSkeleton";
import {
	useInvalidateProjectQueries,
	useLinkedRoadmapQuery,
} from "@/hooks/useProjectQueries";

export const Route = createFileRoute("/project/$projectId/work-items")({
	component: WorkItemsLayout,
});

function WorkItemsLayout() {
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
			to: "/project/$projectId/work-items/$roadmapId",
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
						kicker="Delivery"
						title="Work Items"
						subtitle="View and manage this project's epics, features, and tasks."
					/>
				</AppSurfaceCard>

				<AppEmptyState
					icon={ListChecks}
					title="No roadmap linked"
					description="This project doesn't have a roadmap yet. Link or create a roadmap to start tracking epics, features, and tasks."
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
