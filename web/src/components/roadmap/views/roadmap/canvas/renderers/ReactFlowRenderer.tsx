import {
	applyNodeChanges,
	Background,
	BackgroundVariant,
	type Edge,
	type Node,
	type NodeChange,
	type NodeTypes,
	ReactFlow,
	type ReactFlowInstance,
	useNodesInitialized,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useState } from "react";
import type { CanvasNode } from "../model/types";
import {
	type CanvasViewportApi,
	useRegisterCanvasViewport,
} from "../viewport/CanvasViewportContext";
import type { CanvasRendererProps } from "./types";

/**
 * The `@xyflow/react` canvas renderer.
 *
 * This is the ONLY place in the canvas that names React Flow. Everything above
 * it talks through `CanvasRendererProps` and the viewport port, which is what
 * makes a second engine a drop-in rather than a rewrite.
 *
 * Two React-Flow-specific protocols are absorbed here rather than exposed:
 *   - controlled nodes (`NodeChange[]` + `applyNodeChanges`), which becomes the
 *     neutral `nodesController`;
 *   - `useNodesInitialized`, which becomes the neutral `onReady` callback.
 */

type FlowInstance = ReactFlowInstance<Node, Edge>;

/**
 * Bridges React Flow's measurement lifecycle to `onReady`.
 *
 * It must be a child of `<ReactFlow>` because `useNodesInitialized` needs the
 * store context. The rAF gives React Flow a frame to commit measured bounds and
 * the initial viewport, which is what prevents the first-paint flash of nodes at
 * default positions.
 */
function ReadyGate({
	nodeCount,
	onReady,
}: {
	nodeCount: number;
	onReady: () => void;
}) {
	const nodesInitialized = useNodesInitialized({ includeHiddenNodes: true });

	useEffect(() => {
		if (nodeCount > 0 && !nodesInitialized) return;

		const frameId = window.requestAnimationFrame(onReady);
		return () => window.cancelAnimationFrame(frameId);
	}, [nodeCount, nodesInitialized, onReady]);

	return null;
}

export function ReactFlowRenderer({
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
	nodesDraggable,
	pauseCulling,
	nodesController,
	onNodeDragStart,
	onNodeDrag,
	onNodeDragStop,
	onViewportChange,
	onPanStart,
	onPanEnd,
	onReady,
}: CanvasRendererProps) {
	const [instance, setInstance] = useState<FlowInstance | null>(null);
	const registerViewport = useRegisterCanvasViewport();

	// Publish the imperative API upward. The provider wraps this in a
	// stable-identity facade, so consumers are unaffected by the instance
	// arriving late or the renderer remounting.
	useEffect(() => {
		if (!instance) return;

		const api: CanvasViewportApi = {
			getViewport: () => instance.getViewport(),
			setCenter: (x, y, opts) => {
				void instance.setCenter(x, y, opts);
			},
			fitView: (opts) => {
				void instance.fitView(opts);
			},
			zoomIn: () => {
				void instance.zoomIn();
			},
			zoomOut: () => {
				void instance.zoomOut();
			},
			screenToCanvas: (point) => instance.screenToFlowPosition(point),
			canvasToScreen: (point) => instance.flowToScreenPosition(point),
			getNode: (id) => instance.getNode(id) as CanvasNode | undefined,
			getNodes: () => instance.getNodes() as CanvasNode[],
		};

		registerViewport(api);
		return () => registerViewport(null);
	}, [instance, registerViewport]);

	// React Flow's controlled-node protocol, kept internal. Bails when there is
	// no preview in flight, and writes back synchronously so the same event cycle
	// can read the result.
	const handleNodesChange = useCallback(
		(changes: NodeChange[]) => {
			const current = nodesController.getNodes();
			if (!current) return;
			nodesController.setNodes(
				applyNodeChanges(changes, current as Node[]) as CanvasNode[],
			);
		},
		[nodesController],
	);

	const handleEdgesChange = useCallback(() => {
		// Edges are derived from the graph; React Flow never mutates them here.
	}, []);

	return (
		<ReactFlow
			className={className}
			nodes={nodes as Node[]}
			edges={edges as Edge[]}
			nodeTypes={nodeComponents as NodeTypes}
			onlyRenderVisibleElements={!pauseCulling}
			onNodesChange={handleNodesChange}
			onEdgesChange={handleEdgesChange}
			onNodeDragStart={onNodeDragStart}
			onNodeDrag={onNodeDrag}
			onNodeDragStop={onNodeDragStop}
			onMoveStart={() => onPanStart()}
			onMoveEnd={(_, viewport) => {
				onViewportChange(viewport);
				onPanEnd();
			}}
			onInit={(created) => {
				const flow = created as FlowInstance;
				setInstance(flow);
				onViewportChange(flow.getViewport());
			}}
			defaultViewport={defaultViewport}
			minZoom={minZoom}
			maxZoom={maxZoom}
			fitView={fitView}
			fitViewOptions={fitViewOptions}
			translateExtent={translateExtent}
			panOnDrag={[0, 1, 2]}
			panOnScroll
			zoomOnScroll
			zoomOnPinch
			zoomOnDoubleClick={false}
			nodesDraggable={nodesDraggable}
			defaultEdgeOptions={{ type: "simplebezier" }}
		>
			<ReadyGate nodeCount={nodes.length} onReady={onReady} />
			<Background
				variant={BackgroundVariant.Dots}
				bgColor="var(--background)"
				color="var(--canvas-dot)"
				gap={18}
				size={1.4}
			/>
		</ReactFlow>
	);
}
