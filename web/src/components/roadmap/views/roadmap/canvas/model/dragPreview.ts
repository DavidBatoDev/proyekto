import type { RoadmapEpic } from "@/types/roadmap";
import { getLayoutedElements } from "./layout";
import { computeReorderedEpics } from "./reorder";
import type {
	CanvasDragSubject,
	CanvasEdge,
	CanvasNode,
	StructuralNodeData,
} from "./types";

// Shared, deterministic drag-preview builder used by both the local drag
// (onNodeDrag) and the remote-collaborator preview, so peers see the exact
// same reflow. Pure given its args — the drag state is passed explicitly.
export const computeDragPreview = (args: {
	ds: CanvasDragSubject;
	draggedPosition: { x: number; y: number };
	baseNodes: CanvasNode[];
	originalNodes: CanvasNode[];
	relativeYs: Map<string, number> | null;
	/** Authoritative epics the reorder is computed against. */
	epics: RoadmapEpic[];
	/** Settled layout used as the geometry source for preview positions. */
	layoutedNodes: CanvasNode<StructuralNodeData>[];
	edges: CanvasEdge[];
	edgeAnimationsEnabled: boolean;
}): { nodes: CanvasNode[]; edges: CanvasEdge[] } => {
	const {
		ds,
		draggedPosition,
		baseNodes,
		originalNodes,
		relativeYs,
		epics,
		layoutedNodes,
		edges,
		edgeAnimationsEnabled,
	} = args;

	const current = baseNodes.map((n) =>
		n.id === ds.nodeId ? { ...n, position: draggedPosition, zIndex: 1000 } : n,
	);

	// Pre-drag positions for non-dragged nodes so earlier preview frames
	// don't corrupt the order calculation.
	const nodesForOrder = originalNodes.map((n) =>
		n.id === ds.nodeId ? { ...n, position: draggedPosition } : n,
	);
	const reorderedEpics = computeReorderedEpics(nodesForOrder, ds, epics);
	const { nodes: previewPositioned } = getLayoutedElements(
		layoutedNodes,
		edges,
		reorderedEpics,
	);
	const previewById = new Map(previewPositioned.map((p) => [p.id, p]));

	if (ds.type === "epic") {
		const epicCurrentY = draggedPosition.y;
		const updated = current.map((n) => {
			if (n.id === ds.nodeId) return n; // dragged epic stays under the cursor
			const relY = relativeYs?.get(n.id);
			if (relY !== undefined) {
				return {
					...n,
					zIndex: 999,
					position: { x: n.position.x, y: epicCurrentY + relY },
				};
			}
			const preview = previewById.get(n.id);
			return preview ? { ...n, position: preview.position } : n;
		});
		return { nodes: updated, edges };
	}

	// Feature drag: non-dragged nodes animate to preview positions; the
	// dragged feature's edge re-points (and dashes) when crossing epics.
	const updated = current.map((n) => {
		if (n.id === ds.nodeId) return n;
		const preview = previewById.get(n.id);
		return preview ? { ...n, position: preview.position } : n;
	});

	const targetEpic = reorderedEpics.find((e) =>
		e.features?.some((f) => f.id === ds.nodeId),
	);
	const closestEpicId = targetEpic?.id ?? null;
	let updatedEdges = edges;
	if (closestEpicId) {
		const isNewEpic = closestEpicId !== ds.sourceEpicId;
		updatedEdges = edges.map((e) => {
			if (e.target !== ds.nodeId) return e;
			return {
				...e,
				id: `epic-feature-${closestEpicId}-${ds.nodeId}`,
				source: closestEpicId,
				animated: edgeAnimationsEnabled && isNewEpic,
				style: isNewEpic
					? { stroke: "#f59e0b", strokeWidth: 2.5, strokeDasharray: "6,3" }
					: e.style,
			};
		});
	}
	return { nodes: updated, edges: updatedEdges };
};
