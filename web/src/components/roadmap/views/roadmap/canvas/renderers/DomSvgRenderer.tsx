import { useCallback, useEffect, useState } from "react";
import { Flow, type FlowApi } from "@/lib/flow/Flow";
import type { FlowEdge, FlowNode } from "@/lib/flow/types";
import type { CanvasNode } from "../model/types";
import {
	type CanvasViewportApi,
	useRegisterCanvasViewport,
} from "../viewport/CanvasViewportContext";
import type { CanvasRendererProps } from "./types";

/**
 * The in-house DOM+SVG canvas renderer.
 *
 * Sibling of `ReactFlowRenderer`: same `CanvasRendererProps` in, same viewport
 * port out, so the shell above cannot tell which one is mounted. Selected only
 * when the engine resolves to `dom-svg`.
 *
 * `nodesController` is accepted and deliberately unused. It exists to absorb
 * React Flow's `NodeChange` protocol; this engine moves the dragged node by
 * writing its transform directly and reports the absolute position, so there is
 * no change protocol to absorb and the shell's own preview stays the single
 * source of node positions.
 *
 * `CanvasNode`/`CanvasEdge` and the engine's `FlowNode`/`FlowEdge` are
 * structurally identical by design, so the boundary below is a cast rather than
 * a translation. That is what keeps the adapter this thin.
 */
export function DomSvgRenderer({
	nodes,
	edges,
	nodeComponents,
	className,
	defaultViewport,
	minZoom,
	maxZoom,
	fitView,
	fitViewOptions,
	translateExtent,
	pauseCulling,
	nodesDraggable,
	onNodeDragStart,
	onNodeDrag,
	onNodeDragStop,
	onViewportChange,
	onPanStart,
	onPanEnd,
	onReady,
}: CanvasRendererProps) {
	const [api, setApi] = useState<FlowApi | null>(null);
	const registerViewport = useRegisterCanvasViewport();

	// `onApi` fires on every identity change of the engine's API object, so it
	// must be stable here or the effect below would churn registrations.
	const handleApi = useCallback((next: FlowApi) => setApi(next), []);

	useEffect(() => {
		if (!api) return;

		const port: CanvasViewportApi = {
			getViewport: () => api.getViewport(),
			setCenter: (x, y, opts) => api.setCenter(x, y, opts),
			fitView: (opts) => api.fitView(opts),
			zoomIn: () => api.zoomIn(),
			zoomOut: () => api.zoomOut(),
			screenToCanvas: (point) => api.screenToFlowPosition(point),
			canvasToScreen: (point) => api.flowToScreenPosition(point),
			getNode: (id) => api.getNode(id) as CanvasNode | undefined,
			getNodes: () => api.getNodes() as CanvasNode[],
		};

		registerViewport(port);
		return () => registerViewport(null);
	}, [api, registerViewport]);

	return (
		<Flow
			className={className}
			nodes={nodes as FlowNode[]}
			edges={edges as FlowEdge[]}
			nodeTypes={nodeComponents}
			defaultViewport={defaultViewport}
			minZoom={minZoom}
			maxZoom={maxZoom}
			fitView={fitView}
			fitViewOptions={fitViewOptions}
			translateExtent={translateExtent}
			pauseCulling={pauseCulling}
			nodesDraggable={nodesDraggable}
			onNodeDragStart={onNodeDragStart}
			onNodeDrag={onNodeDrag}
			onNodeDragStop={onNodeDragStop}
			backgroundGap={18}
			onViewportChange={onViewportChange}
			onPanStart={onPanStart}
			onPanEnd={onPanEnd}
			onReady={onReady}
			onApi={handleApi}
		/>
	);
}
