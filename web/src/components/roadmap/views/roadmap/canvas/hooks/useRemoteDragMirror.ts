import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { RemoteDrag } from "@/hooks/useRoadmapCollaboration";
import type { RoadmapEpic } from "@/types/roadmap";
import { getLayoutedElements } from "../model/layout";
import { computeReorderedEpics } from "../model/reorder";
import type {
	CanvasDragSubject,
	CanvasEdge,
	CanvasNode,
	StructuralNodeData,
} from "../model/types";

export interface UseRemoteDragMirrorArgs {
	/** The peer drag being mirrored, or null when nobody else is dragging. */
	remoteDrag: RemoteDrag | null | undefined;
	/** Current committed nodes — the base a remote preview is built from. */
	nodes: CanvasNode[];
	epics: RoadmapEpic[];
	layoutedNodes: CanvasNode<StructuralNodeData>[];
	edges: CanvasEdge[];
	/** Structural layout key; a change means committed data arrived. */
	layoutKey: string;
	/** Shared preview builder, bound to the current graph by the caller. */
	buildDragPreview: (args: {
		ds: CanvasDragSubject;
		draggedPosition: { x: number; y: number };
		baseNodes: CanvasNode[];
		originalNodes: CanvasNode[];
		relativeYs: Map<string, number> | null;
	}) => { nodes: CanvasNode[]; edges: CanvasEdge[] };
}

export interface RemoteDragMirror {
	remoteWorkingNodes: CanvasNode[] | null;
	remoteWorkingEdges: CanvasEdge[] | null;
}

/**
 * Mirrors another collaborator's in-progress epic/feature drag.
 *
 * It deliberately re-runs the SAME `computeDragPreview` / `computeReorderedEpics`
 * the dragger is running locally, from their broadcast position, rather than
 * streaming positions for every node. That is what makes both sides agree: the
 * reflow is derived deterministically from one dragged position, so there is no
 * per-node drift and no ordering ambiguity.
 *
 * Release is three-legged, because "the drag ended" and "the new data arrived"
 * are separate events and either can come first:
 *   1. terminal commit -> settle locally to the final layout at once;
 *   2. `layoutKey` change -> committed data landed, drop the held preview;
 *   3. a 2s fallback -> the drag ended with no data change (dropped in place).
 */
export function useRemoteDragMirror({
	remoteDrag,
	nodes,
	epics,
	layoutedNodes,
	edges,
	layoutKey,
	buildDragPreview,
}: UseRemoteDragMirrorArgs): RemoteDragMirror {
	// --- Remote collaborator drag preview (read-only mirror of their reflow) ---
	const [remoteWorkingNodes, setRemoteWorkingNodes] = useState<
		CanvasNode[] | null
	>(null);
	const [remoteWorkingEdges, setRemoteWorkingEdges] = useState<
		CanvasEdge[] | null
	>(null);
	// Pre-drag snapshot captured when a remote drag begins, mirroring
	// dragStartNodesRef/dragStartFeatureRelativeYsRef for the local drag.
	const remoteDragSnapshotRef = useRef<{
		nodeId: string;
		nodes: CanvasNode[];
		relativeYs: Map<string, number> | null;
	} | null>(null);
	// The terminal remote-drag object already handled, so the commit/cancel
	// resolution runs exactly once even as the effect re-fires.
	const handledTerminalRef = useRef<RemoteDrag | null>(null);

	// Mirror a remote collaborator's epic/feature drag by re-running the same
	// deterministic preview from the dragged node's broadcast position.
	useEffect(() => {
		if (!remoteDrag) {
			remoteDragSnapshotRef.current = null;
			return;
		}

		// Terminal phase — resolve exactly once.
		if (remoteDrag.ended) {
			if (handledTerminalRef.current === remoteDrag) return;
			handledTerminalRef.current = remoteDrag;

			const snap = remoteDragSnapshotRef.current;
			if (remoteDrag.ended === "commit" && remoteDrag.position && snap) {
				// Committed: settle to the final laid-out layout immediately (locally,
				// deterministically) so the watcher doesn't wait for the server refetch
				// and doesn't see the node snap from the raw drop spot into its slot.
				const draggedPosition = remoteDrag.position;
				const ds = {
					nodeId: remoteDrag.nodeId,
					type: remoteDrag.type,
					sourceEpicId: remoteDrag.sourceEpicId,
				};
				const nodesForOrder = snap.nodes.map((n) =>
					n.id === ds.nodeId ? { ...n, position: draggedPosition } : n,
				);
				const reorderedEpics = computeReorderedEpics(nodesForOrder, ds, epics);
				const settled = getLayoutedElements(
					layoutedNodes,
					edges,
					reorderedEpics,
				);
				const settledById = new Map(
					settled.nodes.map((node) => [node.id, node]),
				);
				const settledNodes = snap.nodes.map((n) => {
					const p = settledById.get(n.id);
					return p ? { ...n, position: p.position } : n;
				});
				setRemoteWorkingNodes(settledNodes);
				setRemoteWorkingEdges(settled.edges);
			} else {
				// Cancelled, no-op, or a confirm is still pending — the reorder is NOT
				// committed, so revert to the authoritative (committed/original) layout.
				setRemoteWorkingNodes(null);
				setRemoteWorkingEdges(null);
			}
			remoteDragSnapshotRef.current = null;
			return;
		}

		// Capture the pre-drag snapshot once per remote drag (same role as the
		// local dragStartNodesRef / dragStartFeatureRelativeYsRef).
		if (
			!remoteDragSnapshotRef.current ||
			remoteDragSnapshotRef.current.nodeId !== remoteDrag.nodeId
		) {
			const snapshot = nodes.map((n) =>
				n.id === remoteDrag.nodeId ? { ...n, zIndex: 1000 } : n,
			);
			let relativeYs: Map<string, number> | null = null;
			if (remoteDrag.type === "epic") {
				const epicPos = snapshot.find(
					(n) => n.id === remoteDrag.nodeId,
				)?.position;
				const epicFeatures =
					epics.find((e) => e.id === remoteDrag.nodeId)?.features ?? [];
				relativeYs = new Map();
				for (const f of epicFeatures) {
					const fn = snapshot.find((n) => n.id === f.id);
					if (fn && epicPos) relativeYs.set(f.id, fn.position.y - epicPos.y);
				}
			}
			remoteDragSnapshotRef.current = {
				nodeId: remoteDrag.nodeId,
				nodes: snapshot,
				relativeYs,
			};
		}

		if (!remoteDrag.position) return; // start received, no movement yet

		const snap = remoteDragSnapshotRef.current;
		const { nodes: preview, edges: previewEdges } = buildDragPreview({
			ds: {
				nodeId: remoteDrag.nodeId,
				type: remoteDrag.type,
				sourceEpicId: remoteDrag.sourceEpicId,
			},
			draggedPosition: remoteDrag.position,
			baseNodes: snap.nodes,
			originalNodes: snap.nodes,
			relativeYs: snap.relativeYs,
		});

		const color = remoteDrag.color;
		const tagged = preview.map((n) => {
			const isDragged = n.id === remoteDrag.nodeId;
			return {
				...n,
				className: `${n.className ?? ""} ${
					isDragged ? "remote-dragging" : "remote-drag-shift"
				}`.trim(),
				style: isDragged
					? ({
							...(n.style ?? {}),
							"--remote-drag-color": color,
						} as React.CSSProperties)
					: n.style,
			};
		});
		setRemoteWorkingNodes(tagged);
		setRemoteWorkingEdges(previewEdges);
		// `buildDragPreview` carries epics/layoutedNodes/edges/edgeAnimationsEnabled;
		// keeping it here preserves the re-run behaviour the old inline useCallback had
		// (notably re-running when reduced-motion toggles edge animation).
	}, [remoteDrag, buildDragPreview, nodes, epics, layoutedNodes, edges]);

	// Flash-free handoff: clear the held remote preview once the committed data
	// arrives (layoutKey changes after the dragger's persist → refetch).
	const prevLayoutKeyRef = useRef(layoutKey);
	useEffect(() => {
		if (prevLayoutKeyRef.current === layoutKey) return;
		prevLayoutKeyRef.current = layoutKey;
		setRemoteWorkingNodes(null);
		setRemoteWorkingEdges(null);
	}, [layoutKey]);

	// Fallback: if the drag ended but no data change followed (e.g. dropped in
	// place), release the held preview after a short delay.
	useEffect(() => {
		if (remoteDrag || !remoteWorkingNodes) return;
		const t = setTimeout(() => {
			setRemoteWorkingNodes(null);
			setRemoteWorkingEdges(null);
		}, 2000);
		return () => clearTimeout(t);
	}, [remoteDrag, remoteWorkingNodes]);

	return { remoteWorkingNodes, remoteWorkingEdges };
}
