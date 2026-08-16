import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import { RoadmapViewContent } from "@/components/roadmap";
import { useRoadmapStore } from "@/stores/roadmapStore";

const parseStringParam = (value: unknown): string | undefined => {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
};

export const Route = createFileRoute(
	"/_execution/project/$projectId/gantt/$roadmapId",
)({
	validateSearch: (
		search: Record<string, unknown>,
	): {
		nodeId?: string;
		node?: string;
		commentId?: string;
	} => ({
		nodeId: parseStringParam(search.nodeId),
		node: parseStringParam(search.node),
		commentId: parseStringParam(search.commentId),
	}),
	component: GanttViewPage,
});

function GanttViewPage() {
	const { projectId, roadmapId } = Route.useParams();
	const { nodeId, node, commentId } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const effectiveNodeId = nodeId ?? node;
	const resolveCanonicalNodeId = useRoadmapStore(
		(state) => state.resolveCanonicalNodeId,
	);
	const isOptimisticNodeId = useRoadmapStore(
		(state) => state.isOptimisticNodeId,
	);

	const toCanonicalUrlNodeId = useCallback(
		(rawNodeId?: string) => {
			const canonicalNodeId = resolveCanonicalNodeId(rawNodeId);
			if (!canonicalNodeId) return undefined;
			const normalized = canonicalNodeId.trim();
			if (!normalized || isOptimisticNodeId(normalized)) return undefined;
			return normalized;
		},
		[isOptimisticNodeId, resolveCanonicalNodeId],
	);
	const safeEffectiveNodeId = toCanonicalUrlNodeId(effectiveNodeId);

	// Collapse the legacy `?node=` alias onto the canonical `?nodeId=`.
	useEffect(() => {
		if (!node || nodeId) return;
		const canonicalLegacyNodeId = toCanonicalUrlNodeId(node);
		void navigate({
			to: "/project/$projectId/gantt/$roadmapId",
			params: { projectId, roadmapId },
			search: canonicalLegacyNodeId
				? { nodeId: canonicalLegacyNodeId }
				: undefined,
			replace: true,
		});
	}, [navigate, node, nodeId, projectId, roadmapId, toCanonicalUrlNodeId]);

	const syncNodeIdSearch = useCallback(
		(rawNodeId?: string) => {
			const normalizedNodeId = toCanonicalUrlNodeId(rawNodeId);
			const isCanonicalSearch =
				node === undefined && nodeId === normalizedNodeId;
			if (isCanonicalSearch) return;

			void navigate({
				to: "/project/$projectId/gantt/$roadmapId",
				params: { projectId, roadmapId },
				search: normalizedNodeId ? { nodeId: normalizedNodeId } : undefined,
				replace: true,
			});
		},
		[navigate, node, nodeId, projectId, roadmapId, toCanonicalUrlNodeId],
	);

	const handleDeepLinkNodeConsumed = useCallback(() => {
		syncNodeIdSearch(effectiveNodeId);
	}, [effectiveNodeId, syncNodeIdSearch]);

	const handleNodeOpened = useCallback(
		(openedNodeId: string) => {
			syncNodeIdSearch(openedNodeId);
		},
		[syncNodeIdSearch],
	);

	const handleNodeClosed = useCallback(() => {
		syncNodeIdSearch(undefined);
	}, [syncNodeIdSearch]);

	return (
		<RoadmapViewContent
			roadmapId={roadmapId}
			projectId={projectId}
			forcedViewMode="milestones"
			deepLinkNodeId={safeEffectiveNodeId ?? null}
			deepLinkCommentId={commentId ?? null}
			onDeepLinkNodeConsumed={handleDeepLinkNodeConsumed}
			onNodeOpened={handleNodeOpened}
			onNodeClosed={handleNodeClosed}
		/>
	);
}
