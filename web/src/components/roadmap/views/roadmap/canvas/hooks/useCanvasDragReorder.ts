import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useRoadmapStore } from "@/stores/roadmapStore";
import type { RoadmapEpic } from "@/types/roadmap";
import { getLayoutedElements } from "../model/layout";
import { computeReorderedEpics } from "../model/reorder";
import type {
	CanvasDragSubject,
	CanvasEdge,
	CanvasNode,
	PendingCanvasDrag,
	StructuralNodeData,
} from "../model/types";
import {
	type CanvasConfirmKind,
	useCanvasConfirmPrefs,
} from "./useCanvasConfirmPrefs";

export interface UseCanvasDragReorderArgs {
	/** Committed nodes for the current graph. */
	nodes: CanvasNode[];
	layoutedNodes: CanvasNode<StructuralNodeData>[];
	edges: CanvasEdge[];
	epics: RoadmapEpic[];
	/** Gates every drag; read-only canvases never start one. */
	canEditRoadmap: boolean;
	/** Shared preview builder, bound to the current graph by the caller. */
	buildDragPreview: (args: {
		ds: CanvasDragSubject;
		draggedPosition: { x: number; y: number };
		baseNodes: CanvasNode[];
		originalNodes: CanvasNode[];
		relativeYs: Map<string, number> | null;
	}) => { nodes: CanvasNode[]; edges: CanvasEdge[] };
	onBroadcastNodeDragStart?: (p: CanvasDragSubject) => void;
	onBroadcastNodeDrag?: (
		p: CanvasDragSubject & { x: number; y: number },
	) => void;
	onBroadcastNodeDragEnd?: (nodeId: string, committed: boolean) => void;
}

export interface CanvasDragReorder {
	/** Live preview nodes/edges, or null when no drag is in flight. */
	workingNodes: CanvasNode[] | null;
	workingEdges: CanvasEdge[] | null;
	/**
	 * Written SYNCHRONOUSLY during a drag. Exposed because the renderer adapter
	 * (`onNodesChange`) and the toolbar hit-test both need the current frame's
	 * nodes within the same event cycle, which state cannot provide.
	 */
	workingNodesRef: React.MutableRefObject<CanvasNode[] | null>;
	setWorkingNodes: (nodes: CanvasNode[] | null) => void;
	onNodeDragStart: (
		event: unknown,
		node: CanvasNode,
		nodes?: CanvasNode[],
	) => void;
	onNodeDrag: (event: unknown, node: CanvasNode, nodes?: CanvasNode[]) => void;
	onNodeDragStop: (
		event: unknown,
		node: CanvasNode,
		nodes?: CanvasNode[],
	) => void;
	/** A drop awaiting confirmation, driving the three confirm modals. */
	pendingCanvasDrag: PendingCanvasDrag | null;
	isPersistingCanvasDrag: boolean;
	persistCanvasDrag: (pending: PendingCanvasDrag) => Promise<void>;
	cancelPendingCanvasDrag: () => void;
	dontAskEpicReorder: boolean;
	dontAskFeatureReorder: boolean;
	dontAskFeatureMove: boolean;
	setCanvasConfirmSkip: (kind: CanvasConfirmKind, value: boolean) => void;
}

/**
 * The canvas drag-to-reorder state machine.
 *
 * The important thing about dragging here is that it is a REORDER gesture, not a
 * position gesture — node coordinates are never persisted, only the integer
 * `position` columns. So a drop resolves to "what is the new order?", computed
 * from PRE-DRAG positions (`dragStartNodesRef`) rather than from the live preview,
 * which has already been reflowed and would otherwise feed back into itself.
 *
 * Three things are load-bearing and easy to break:
 *   - `workingNodesRef` is written synchronously alongside its state, so the same
 *     event cycle can read the current frame.
 *   - drag frames are coalesced to one `requestAnimationFrame`.
 *   - on an auto-persisted drop, `applySettledPreview` snaps to the final layout
 *     immediately; the store applies its `epics` update only after the request
 *     resolves, so without it the node sits frozen at the drop point.
 */
export function useCanvasDragReorder({
	nodes,
	layoutedNodes,
	edges,
	epics,
	canEditRoadmap,
	buildDragPreview,
	onBroadcastNodeDragStart,
	onBroadcastNodeDrag,
	onBroadcastNodeDragEnd,
}: UseCanvasDragReorderArgs): CanvasDragReorder {
	const {
		reorderEpicsInRoadmap,
		reorderFeaturesInEpic,
		moveFeatureBetweenEpics,
	} = useRoadmapStore(
		useShallow((s) => ({
			reorderEpicsInRoadmap: s.reorderEpicsInRoadmap,
			reorderFeaturesInEpic: s.reorderFeaturesInEpic,
			moveFeatureBetweenEpics: s.moveFeatureBetweenEpics,
		})),
	);

	// --- Canvas drag state ---
	// workingNodesRef is updated synchronously so onNodesChange can read it in the same event cycle
	const workingNodesRef = useRef<CanvasNode[] | null>(null);
	const [workingNodes, setWorkingNodes] = useState<CanvasNode[] | null>(null);
	const [dragState, setDragState] = useState<{
		nodeId: string;
		type: "epic" | "feature";
		sourceEpicId?: string;
	} | null>(null);
	const dragStateRef = useRef(dragState);
	dragStateRef.current = dragState;

	const workingEdgesRef = useRef<CanvasEdge[] | null>(null);
	const [workingEdges, setWorkingEdges] = useState<CanvasEdge[] | null>(null);
	// For epic drag: maps featureId → initial Y offset relative to the dragged epic
	const dragStartFeatureRelativeYsRef = useRef<Map<string, number> | null>(
		null,
	);

	// Original node positions before any drag — used in onNodeDragStop so preview-animated
	// positions of non-dragged nodes don't contaminate the final order calculation
	const dragStartNodesRef = useRef<CanvasNode[] | null>(null);
	const pendingDragFrameRef = useRef<number | null>(null);
	const latestDragFrameRef = useRef<{
		nodeId: string;
		position: { x: number; y: number };
	} | null>(null);

	const [pendingCanvasDrag, setPendingCanvasDrag] =
		useState<PendingCanvasDrag | null>(null);
	const [isPersistingCanvasDrag, setIsPersistingCanvasDrag] = useState(false);
	const {
		skipEpicReorder: dontAskEpicReorder,
		skipFeatureReorder: dontAskFeatureReorder,
		skipFeatureMove: dontAskFeatureMove,
		setSkip: setCanvasConfirmSkip,
	} = useCanvasConfirmPrefs();

	const cancelPendingDragFrame = useCallback(() => {
		if (pendingDragFrameRef.current !== null) {
			window.cancelAnimationFrame(pendingDragFrameRef.current);
			pendingDragFrameRef.current = null;
		}
		latestDragFrameRef.current = null;
	}, []);

	useEffect(() => cancelPendingDragFrame, [cancelPendingDragFrame]);

	const clearDragState = useCallback(() => {
		cancelPendingDragFrame();
		workingNodesRef.current = null;
		setWorkingNodes(null);
		workingEdgesRef.current = null;
		setWorkingEdges(null);
		dragStartFeatureRelativeYsRef.current = null;
		dragStartNodesRef.current = null;
		dragStateRef.current = null;
		setDragState(null);
		setPendingCanvasDrag(null);
	}, [cancelPendingDragFrame]);

	const persistCanvasDrag = useCallback(
		async (pending: PendingCanvasDrag) => {
			// The reorder is being committed — tell collaborators to settle to the
			// new order (covers both auto-persist and confirm-then-persist).
			onBroadcastNodeDragEnd?.(
				pending.kind === "epicReorder" ? pending.epicId : pending.featureId,
				true,
			);
			workingNodesRef.current = null;
			workingEdgesRef.current = null;
			setIsPersistingCanvasDrag(true);
			try {
				if (pending.kind === "epicReorder") {
					await reorderEpicsInRoadmap(pending.newEpicOrder);
				} else if (pending.kind === "featureReorder") {
					await reorderFeaturesInEpic(pending.epicId, pending.newFeatureOrder);
				} else {
					await moveFeatureBetweenEpics(
						pending.featureId,
						pending.targetEpicId,
						pending.newTargetFeatureOrder,
					);
				}
			} finally {
				setIsPersistingCanvasDrag(false);
				setPendingCanvasDrag(null);
				setWorkingNodes(null);
				setWorkingEdges(null);
			}
		},
		[
			reorderEpicsInRoadmap,
			reorderFeaturesInEpic,
			moveFeatureBetweenEpics,
			onBroadcastNodeDragEnd,
		],
	);

	// Snap the canvas to the final laid-out order immediately on an auto-persisted
	// drop. The reorder store actions apply their `epics` update only after the
	// request resolves, so without this the working preview would sit frozen at
	// the dropped position until the network round-trip completes. We show the
	// settled layout right away and let persistCanvasDrag's finally hand off to
	// the recomputed nodes once the (identical) committed data lands.
	const applySettledPreview = useCallback(
		(reorderedEpics: RoadmapEpic[]) => {
			const settled = getLayoutedElements(layoutedNodes, edges, reorderedEpics);
			const settledById = new Map(settled.nodes.map((node) => [node.id, node]));
			const settledNodes = nodes.map((n) => {
				const p = settledById.get(n.id);
				return p ? { ...n, position: p.position } : n;
			});
			workingNodesRef.current = settledNodes;
			setWorkingNodes(settledNodes);
			workingEdgesRef.current = settled.edges;
			setWorkingEdges(settled.edges);
		},
		[nodes, layoutedNodes, edges],
	);

	// Cancelling a pending confirm: tell collaborators the drag was not committed
	// so their held preview reverts to the original order.
	const cancelPendingCanvasDrag = useCallback(() => {
		const p = pendingCanvasDrag;
		if (p) {
			onBroadcastNodeDragEnd?.(
				p.kind === "epicReorder" ? p.epicId : p.featureId,
				false,
			);
		}
		clearDragState();
	}, [pendingCanvasDrag, clearDragState, onBroadcastNodeDragEnd]);

	const onNodeDragStart = useCallback(
		(_event: unknown, node: CanvasNode, _nodes?: CanvasNode[]) => {
			if (!canEditRoadmap) return;
			cancelPendingDragFrame();
			const type: "epic" | "feature" | null =
				node.type === "epicWidget"
					? "epic"
					: node.type === "featureWidget"
						? "feature"
						: null;
			if (!type) return;
			const sourceEpicId =
				type === "feature"
					? (node.data as { feature: { epic_id: string } }).feature.epic_id
					: undefined;
			const ds: {
				nodeId: string;
				type: "epic" | "feature";
				sourceEpicId?: string;
			} = {
				nodeId: node.id,
				type,
				sourceEpicId,
			};
			setDragState(ds);
			dragStateRef.current = ds;
			const snapshot = nodes.map((n) =>
				n.id === node.id ? { ...n, zIndex: 1000 } : n,
			);
			workingNodesRef.current = snapshot;
			dragStartNodesRef.current = snapshot;
			setWorkingNodes(snapshot);
			// Snapshot edges so we can mutate them during drag
			workingEdgesRef.current = [...edges];
			setWorkingEdges([...edges]);
			// For epic drag: record each belonging feature's Y offset relative to the epic
			if (type === "epic") {
				const epicInitialPos = snapshot.find((n) => n.id === node.id)?.position;
				const epicFeatures =
					epics.find((e) => e.id === node.id)?.features ?? [];
				const relativeYs = new Map<string, number>();
				for (const feature of epicFeatures) {
					const featureNode = snapshot.find((n) => n.id === feature.id);
					if (featureNode && epicInitialPos) {
						relativeYs.set(
							feature.id,
							featureNode.position.y - epicInitialPos.y,
						);
					}
				}
				dragStartFeatureRelativeYsRef.current = relativeYs;
			} else {
				dragStartFeatureRelativeYsRef.current = null;
			}

			onBroadcastNodeDragStart?.({ nodeId: node.id, type, sourceEpicId });
		},
		[
			nodes,
			edges,
			epics,
			canEditRoadmap,
			cancelPendingDragFrame,
			onBroadcastNodeDragStart,
		],
	);

	const onNodeDrag = useCallback(
		(_event: unknown, node: CanvasNode, _nodes?: CanvasNode[]) => {
			const ds = dragStateRef.current;
			if (!ds || !workingNodesRef.current) return;

			latestDragFrameRef.current = {
				nodeId: node.id,
				position: { x: node.position.x, y: node.position.y },
			};

			if (pendingDragFrameRef.current !== null) return;

			pendingDragFrameRef.current = window.requestAnimationFrame(() => {
				pendingDragFrameRef.current = null;
				const latest = latestDragFrameRef.current;
				latestDragFrameRef.current = null;
				const currentDragState = dragStateRef.current;
				const baseNodes = workingNodesRef.current;
				if (!latest || !currentDragState || !baseNodes) return;

				const { nodes: updated, edges: updatedEdges } = buildDragPreview({
					ds: currentDragState,
					draggedPosition: latest.position,
					baseNodes,
					originalNodes: dragStartNodesRef.current ?? baseNodes,
					relativeYs: dragStartFeatureRelativeYsRef.current,
				});

				workingNodesRef.current = updated;
				setWorkingNodes(updated);
				if (currentDragState.type === "feature") {
					workingEdgesRef.current = updatedEdges;
					setWorkingEdges(updatedEdges);
				}

				// Stream the dragged node's latest frame so collaborators see the same reflow.
				onBroadcastNodeDrag?.({
					nodeId: latest.nodeId,
					type: currentDragState.type,
					sourceEpicId: currentDragState.sourceEpicId,
					x: latest.position.x,
					y: latest.position.y,
				});
			});
		},
		[buildDragPreview, onBroadcastNodeDrag],
	);

	const onNodeDragStop = useCallback(
		(_event: unknown, node: CanvasNode, _nodes?: CanvasNode[]) => {
			cancelPendingDragFrame();
			const ds = dragStateRef.current;
			if (!ds || !workingNodesRef.current) {
				onBroadcastNodeDragEnd?.(node.id, false);
				clearDragState();
				return;
			}

			// Reconstruct nodes using original pre-drag positions for every node except the
			// dropped one (which uses its final drop position). This prevents preview-animated
			// positions of non-dragged nodes from corrupting the final order calculation.
			const originalNodes =
				dragStartNodesRef.current ?? workingNodesRef.current;
			const nodesForOrder = originalNodes.map((n) =>
				n.id === node.id ? { ...n, position: node.position } : n,
			);
			const reorderedEpics = computeReorderedEpics(nodesForOrder, ds, epics);
			setDragState(null);
			dragStateRef.current = null;

			if (ds.type === "epic") {
				const newEpicOrder = reorderedEpics.map((e) => e.id);
				const originalOrder = [...epics]
					.sort((a, b) => a.position - b.position)
					.map((e) => e.id);
				if (JSON.stringify(newEpicOrder) === JSON.stringify(originalOrder)) {
					onBroadcastNodeDragEnd?.(ds.nodeId, false);
					clearDragState();
					return;
				}
				const epicTitle = epics.find((e) => e.id === ds.nodeId)?.title ?? "";
				const pending: PendingCanvasDrag = {
					kind: "epicReorder",
					epicId: ds.nodeId,
					epicTitle,
					newEpicOrder,
				};
				if (dontAskEpicReorder) {
					applySettledPreview(reorderedEpics);
					void persistCanvasDrag(pending);
				} else {
					// Awaiting confirmation — peers keep showing the live preview until
					// the dragger confirms (persist) or cancels.
					setPendingCanvasDrag(pending);
				}
				return;
			}

			// Feature drag
			const targetEpic = reorderedEpics.find((e) =>
				e.features?.some((f) => f.id === ds.nodeId),
			);
			const sameEpic = targetEpic?.id === ds.sourceEpicId;
			const feature = epics
				.flatMap((e) => e.features ?? [])
				.find((f) => f.id === ds.nodeId);
			if (!feature || !targetEpic) {
				onBroadcastNodeDragEnd?.(ds.nodeId, false);
				clearDragState();
				return;
			}

			if (sameEpic) {
				const originalFeatureOrder =
					[...epics]
						.find((e) => e.id === ds.sourceEpicId)
						?.features?.sort((a, b) => a.position - b.position)
						.map((f) => f.id) ?? [];
				const newFeatureOrder = (targetEpic.features ?? []).map((f) => f.id);
				if (
					JSON.stringify(newFeatureOrder) ===
					JSON.stringify(originalFeatureOrder)
				) {
					onBroadcastNodeDragEnd?.(ds.nodeId, false);
					clearDragState();
					return;
				}
				const pending: PendingCanvasDrag = {
					kind: "featureReorder",
					featureId: ds.nodeId,
					featureTitle: feature.title ?? "",
					epicId: targetEpic.id,
					newFeatureOrder,
				};
				if (dontAskFeatureReorder) {
					applySettledPreview(reorderedEpics);
					void persistCanvasDrag(pending);
				} else {
					setPendingCanvasDrag(pending);
				}
			} else {
				const newTargetFeatureOrder = (targetEpic.features ?? []).map(
					(f) => f.id,
				);
				const pending: PendingCanvasDrag = {
					kind: "featureMove",
					featureId: ds.nodeId,
					featureTitle: feature.title ?? "",
					sourceEpicId: ds.sourceEpicId ?? "",
					targetEpicId: targetEpic.id,
					targetEpicTitle: targetEpic.title ?? "",
					newTargetFeatureOrder,
				};
				if (dontAskFeatureMove) {
					applySettledPreview(reorderedEpics);
					void persistCanvasDrag(pending);
				} else {
					setPendingCanvasDrag(pending);
				}
			}
		},
		[
			workingNodes,
			computeReorderedEpics,
			epics,
			clearDragState,
			cancelPendingDragFrame,
			persistCanvasDrag,
			applySettledPreview,
			dontAskEpicReorder,
			dontAskFeatureReorder,
			dontAskFeatureMove,
			onBroadcastNodeDragEnd,
		],
	);

	return {
		workingNodes,
		workingEdges,
		workingNodesRef,
		setWorkingNodes,
		onNodeDragStart,
		onNodeDrag,
		onNodeDragStop,
		pendingCanvasDrag,
		isPersistingCanvasDrag,
		persistCanvasDrag,
		cancelPendingCanvasDrag,
		dontAskEpicReorder,
		dontAskFeatureReorder,
		dontAskFeatureMove,
		setCanvasConfirmSkip,
	};
}
