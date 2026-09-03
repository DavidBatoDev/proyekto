import {
	createFileRoute,
	Outlet,
	useChildMatches,
	useNavigate,
} from "@tanstack/react-router";
import { Map, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { RequireProjectAccess } from "@/components/common/RequireProjectAccess";
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
	// here as a second row of cards would be answering it twice. The page
	// itself only has to say "nothing here yet" and hand over.
	return (
		<div className="app-shell-bg h-full w-full overflow-y-auto">
			<div className="mx-auto flex min-h-full w-full max-w-4xl items-center justify-center px-5 py-10 md:px-8">
				<section
					aria-labelledby="roadmap-empty-title"
					className="flex w-full max-w-lg flex-col items-center rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center shadow-sm"
				>
					<span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
						<Map className="h-6 w-6" aria-hidden="true" />
					</span>
					<h2
						id="roadmap-empty-title"
						className="mt-5 text-xl font-semibold tracking-tight text-foreground"
					>
						No roadmap yet
					</h2>
					<p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
						Plan this project's milestones, epics, and features. Start from
						scratch, describe it to the AI, or pick a template — every route
						ends on this project's canvas.
					</p>

					<RoadmapStartTrigger
						projectId={projectId}
						className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
					>
						<Plus className="h-4 w-4" aria-hidden="true" />
						Create a roadmap
					</RoadmapStartTrigger>

					{/* Attaching an existing roadmap is real, but rare - a text link
					    under the primary action, not a peer button competing with it. */}
					<button
						type="button"
						onClick={() => setIsLinkModalOpen(true)}
						className="mt-4 text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
					>
						Link an existing roadmap instead
					</button>
				</section>
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
