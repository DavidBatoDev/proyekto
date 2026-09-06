import {
	createFileRoute,
	Link,
	Outlet,
	useChildMatches,
	useNavigate,
} from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { RequireProjectAccess } from "@/components/common/RequireProjectAccess";
import { BoardIllustration } from "@/components/project/empty/EmptyStateIllustrations";
import { BOARD_EMPTY_CLIP } from "@/components/project/empty/emptyStateClips";
import { ProjectEmptyShowcase } from "@/components/project/empty/ProjectEmptyShowcase";
import { LinkRoadmapModal } from "@/components/roadmap/modals/LinkRoadmapModal";
import { RoadmapPageSkeleton } from "@/components/roadmap/views/RoadmapPageSkeleton";
import {
	useInvalidateProjectQueries,
	useLinkedRoadmapQuery,
} from "@/hooks/useProjectQueries";

export const Route = createFileRoute(
	"/_execution/project/$projectId/work-items",
)({
	component: WorkItemsLayout,
});

function WorkItemsLayout() {
	const { projectId } = Route.useParams();
	// Standalone roadmaps use "n" as the no-project sentinel. The roadmap API
	// authorizes these directly, so a project permission lookup would request
	// /projects/n/my-permissions and prevent the nested board from mounting.
	if (projectId === "n") {
		return <WorkItemsLayoutBody />;
	}
	return (
		<RequireProjectAccess projectId={projectId} access="work_items">
			<WorkItemsLayoutBody />
		</RequireProjectAccess>
	);
}

function WorkItemsLayoutBody() {
	const childMatches = useChildMatches();
	const { projectId } = Route.useParams();
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

	// No card, and no second header restating the nav item that got you here.
	// The clip carries what a board is FOR — a card changing column — which is
	// the one thing a screenshot of an empty board cannot show.
	return (
		<>
			<ProjectEmptyShowcase
				eyebrow="Delivery"
				title="No board yet"
				description="The board is this project's roadmap seen as work in flight: every task, in the column it's actually in. It is built from the roadmap, so creating or linking one is what fills it."
				clip={BOARD_EMPTY_CLIP}
				illustration={<BoardIllustration />}
				points={[
					"Tasks move To do to In progress to Done as the work lands",
					"Owners, due dates and priorities live on the card",
					"Moving a card updates the roadmap it came from",
				]}
				primaryAction={
					<Link
						to="/project/$projectId/roadmap/create"
						params={{ projectId }}
						className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
					>
						<Plus className="h-4 w-4" aria-hidden="true" />
						Create a roadmap
					</Link>
				}
				secondaryAction={
					<button
						type="button"
						onClick={() => setIsLinkModalOpen(true)}
						className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
					>
						Link an existing roadmap instead
					</button>
				}
			/>

			<LinkRoadmapModal
				isOpen={isLinkModalOpen}
				onClose={() => setIsLinkModalOpen(false)}
				projectId={projectId}
				onLinked={() => {
					setIsLinkModalOpen(false);
					void invalidateLinkedRoadmap();
				}}
			/>
		</>
	);
}
