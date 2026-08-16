import type { ComponentType } from "react";
import type { TranslateExtent } from "../model/extent";
import type { CanvasEdge, CanvasNode } from "../model/types";
import type { CanvasViewport } from "../viewport/CanvasViewportContext";

/**
 * A node widget, as far as a renderer is concerned.
 *
 * Deliberately loose. Widgets are authored against `canvas/ports/node.tsx`,
 * which declares only the three fields they read; this boundary is where that
 * narrow contract meets whatever a renderer wants to hand a component.
 * Narrowing it here would just push a cast onto every renderer.
 */
export type CanvasNodeComponent = ComponentType<any>;

/**
 * Read/write access to the nodes the renderer is displaying.
 *
 * This exists so `NodeChange`/`applyNodeChanges` — React Flow's controlled-node
 * protocol — never leak into the shell. The renderer applies its own change
 * objects internally and reports the result through `setNodes`.
 *
 * `getNodes` returns null when no drag or preview is in flight, which is the
 * signal to ignore the change entirely (matching the original behaviour).
 */
export interface CanvasNodesController {
	getNodes: () => CanvasNode[] | null;
	setNodes: (nodes: CanvasNode[]) => void;
}

export type CanvasDragHandler = (
	event: unknown,
	node: CanvasNode,
	nodes?: CanvasNode[],
) => void;

export interface CanvasRendererProps {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
	/** Maps `node.type` to the component that draws it. */
	nodeComponents: Record<string, CanvasNodeComponent>;
	className?: string;

	// ── viewport ────────────────────────────────────────────────────────────
	defaultViewport: CanvasViewport;
	minZoom: number;
	maxZoom: number;
	fitView: boolean;
	fitViewOptions: { padding: number; maxZoom: number };
	translateExtent: TranslateExtent;

	// ── interaction ─────────────────────────────────────────────────────────
	nodesDraggable: boolean;
	/**
	 * Suspends viewport culling.
	 *
	 * Needed because a remote collaborator's preview moves nodes through the
	 * controlled `nodes` prop with no active local drag; with culling live, edges
	 * pop in and out as the reflow shifts bounding boxes.
	 */
	pauseCulling: boolean;
	nodesController: CanvasNodesController;

	// ── events (renderer-neutral) ───────────────────────────────────────────
	onNodeDragStart: CanvasDragHandler;
	onNodeDrag: CanvasDragHandler;
	onNodeDragStop: CanvasDragHandler;
	onViewportChange: (viewport: CanvasViewport) => void;
	onPanStart: () => void;
	onPanEnd: () => void;
	/**
	 * Fires once the renderer has committed its first real layout — the cue to
	 * reveal the canvas. Replaces waiting on React Flow's `useNodesInitialized`.
	 */
	onReady: () => void;
}

export type CanvasRenderer = ComponentType<CanvasRendererProps>;
