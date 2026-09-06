import {
	createFileRoute,
	Outlet,
	useChildMatches,
	useNavigate,
} from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { RequireProjectAccess } from "@/components/common/RequireProjectAccess";
import { RoadmapIllustration } from "@/components/project/empty/EmptyStateIllustrations";
import { ROADMAP_EMPTY_CLIP } from "@/components/project/empty/emptyStateClips";
import { ProjectEmptyShowcase } from "@/components/project/empty/ProjectEmptyShowcase";
import { LinkRoadmapModal } from "@/components/roadmap/modals/LinkRoadmapModal";
import { RoadmapStartTrigger } from "@/components/roadmap/RoadmapStartDialog";
import { RoadmapPageSkeleton } from "@/components/roadmap/views/RoadmapPageSkeleton";
import {
	useInvalidateProjectQueries,
	useLinkedRoadmapQuery,
} from "@/hooks/useProjectQueries";

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

export const Route = createFileRoute("/_execution/project/$projectId/roadmap")({
	validateSearch: (
		search: Record<string, unknown>,
	): {
		nodeId?: string;
		taskId?: string;
		view?: RoadmapDetailView;
	} => ({
		nodeId: parseStringParam(search.nodeId),
		taskId: parseStringParam(search.taskId),
		view: parseViewParam(search.view),
	}),
	component: RoadmapPage,
});

function RoadmapPage() {
	const { projectId } = Route.useParams();
	// Roadmap-only mode ('n' = no project, e.g. a guest/hero draft) has no
	// project to authorize against — the roadmap itself is authorized
	// server-side by owner/guest. Skip the project-permissions gate, which
	// would call /projects/n/my-permissions (404 for the 'n' sentinel) and
	// block the roadmap from ever mounting. Mirrors ProjectLayout, which
	// already disables its project queries when projectId === 'n'.
	if (projectId === "n") {
		return <RoadmapPageBody />;
	}
	return (
		<RequireProjectAccess projectId={projectId} access="roadmap">
			<RoadmapPageBody />
		</RequireProjectAccess>
	);
}

function RoadmapPageBody() {
	const childMatches = useChildMatches();
	const { projectId } = Route.useParams();
	const { nodeId, taskId, view } = Route.useSearch();
	const navigate = useNavigate();
	const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
	// Roadmap-only mode ('n') has no project, so there is no project→roadmap
	// link to resolve; passing "" disables the query (which otherwise 500s on
	// GET /api/roadmaps/project/n). Mirrors ProjectLayout's isRoadmapOnly gating.
	const linkedRoadmapQuery = useLinkedRoadmapQuery(
		projectId === "n" ? "" : projectId,
	);
	const { invalidateLinkedRoadmap } = useInvalidateProjectQueries(projectId);

	useEffect(() => {
		if (childMatches.length > 0) return;
		const linkedRoadmapId = linkedRoadmapQuery.data?.id;
		if (!linkedRoadmapId) return;
		const deepLinkNodeId = nodeId ?? taskId;
		void navigate({
			to: "/project/$projectId/roadmap/$roadmapId",
			params: { projectId, roadmapId: linkedRoadmapId },
			search: deepLinkNodeId
				? {
						nodeId: deepLinkNodeId,
						view,
					}
				: view
					? { view }
					: undefined,
			replace: true,
		});
	}, [
		childMatches.length,
		linkedRoadmapQuery.data?.id,
		navigate,
		nodeId,
		projectId,
		taskId,
		view,
	]);

	if (childMatches.length > 0) {
		return <Outlet />;
	}

	if (linkedRoadmapQuery.isPending) {
		return <RoadmapPageSkeleton />;
	}

	if (linkedRoadmapQuery.data?.id) {
		return <RoadmapPageSkeleton />;
	}

	// One door, not a page of options. The three ways to start (AI, blank,
	// template) are a question the start dialog already asks, and asking it
	// here as a second row of cards would be answering it twice.
	//
	// The card this used to be is gone: a bordered box is a container for
	// content, and there is none. The page gets the width instead — the clip
	// shows what a roadmap becomes, the still shows what it looks like built,
	// and the dialog is still the only door.
	return (
		<>
			<ProjectEmptyShowcase
				eyebrow="Planning"
				title="No roadmap yet"
				description="A roadmap is where this project's plan lives: milestones at the top, epics under them, and the features and tasks that deliver each one. Board, Timeline and Deliverables all read from it, so this is the one thing to build first."
				clip={ROADMAP_EMPTY_CLIP}
				illustration={<RoadmapIllustration />}
				points={[
					"Start from scratch, describe it to the AI, or pick a template",
					"Every node carries owners, dates and status",
					"Board and Timeline are views of this canvas, not separate plans",
				]}
				primaryAction={
					<RoadmapStartTrigger
						projectId={projectId}
						className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
					>
						<Plus className="h-4 w-4" aria-hidden="true" />
						Create a roadmap
					</RoadmapStartTrigger>
				}
				secondaryAction={
					/* Attaching an existing roadmap is real, but rare - a text link
					   next to the primary action, not a peer button competing with it. */
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
