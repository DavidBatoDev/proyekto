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
import { TimelineIllustration } from "@/components/project/empty/EmptyStateIllustrations";
import { TIMELINE_EMPTY_CLIP } from "@/components/project/empty/emptyStateClips";
import { ProjectEmptyShowcase } from "@/components/project/empty/ProjectEmptyShowcase";
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

export const Route = createFileRoute("/_execution/project/$projectId/timeline")(
	{
		validateSearch: (
			search: Record<string, unknown>,
		): {
			nodeId?: string;
		} => ({
			nodeId: parseStringParam(search.nodeId),
		}),
		component: TimelinePage,
	},
);

function TimelinePage() {
	const { projectId } = Route.useParams();
	// Mirrors the roadmap route: roadmap-only mode ('n') has no project to
	// authorize against, and /projects/n/my-permissions 404s.
	if (projectId === "n") {
		return <TimelinePageBody />;
	}
	return (
		<RequireProjectAccess projectId={projectId} access="roadmap">
			<TimelinePageBody />
		</RequireProjectAccess>
	);
}

function TimelinePageBody() {
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
			to: "/project/$projectId/timeline/$roadmapId",
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

	// The timeline is the roadmap with dates on it, so the empty state explains
	// the dates rather than repeating "no roadmap linked" a third time.
	return (
		<>
			<ProjectEmptyShowcase
				eyebrow="Planning"
				title="No timeline yet"
				description="The Timeline lays this project's epics, features and milestones against real weeks, so a slip shows up as a bar that no longer reaches its milestone. It is built from the roadmap."
				clip={TIMELINE_EMPTY_CLIP}
				illustration={<TimelineIllustration />}
				points={[
					"Give each epic a start and an end and drag to reschedule",
					"Wire up what has to finish before something else starts",
					"The current-date line shows what is late without a report",
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
