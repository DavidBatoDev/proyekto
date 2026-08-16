import { memo } from "react";
import { getSimpleBezierPath } from "./edgePath";
import { type HandleRegistry, handlePoint } from "./handles";
import type { FlowEdge, FlowNode } from "./types";

/**
 * The SVG edge layer.
 *
 * It sits inside the transformed pane alongside the nodes, so edges and nodes
 * share one transform and can never drift apart during a pan or zoom. Edges are
 * deliberately never culled: they are two `<path>` elements each, and hiding
 * them as bounding boxes shift is what produces the edge-flicker the consumer's
 * `pauseCulling` flag exists to suppress.
 */

interface FlowEdgesProps {
	nodes: Map<string, FlowNode>;
	edges: FlowEdge[];
	registry: HandleRegistry;
	/** Rendered card sizes by node id; edges anchor to these when present. */
	contentSizes: Map<string, { width: number; height: number }>;
	/** Bumped when handle registrations change, to force a redraw. */
	handleVersion: number;
	/** Bumped when a card is measured or resized, likewise. */
	contentVersion: number;
}

const FlowEdgeItem = memo(function FlowEdgeItem({
	edge,
	d,
}: {
	edge: FlowEdge;
	d: string;
}) {
	return (
		<g
			className={`flow__edge${edge.animated ? " animated" : ""}${
				edge.className ? ` ${edge.className}` : ""
			}`}
			data-edge-id={edge.id}
		>
			{/* Invisible fat path: matches React Flow's interaction band so edge
			    hit-testing behaves the same once edges become interactive. */}
			<path
				className="flow__edge-interaction"
				d={d}
				fill="none"
				strokeWidth={20}
				strokeOpacity={0}
			/>
			<path className="flow__edge-path" d={d} style={edge.style} />
		</g>
	);
});

export const FlowEdges = memo(function FlowEdges({
	nodes,
	edges,
	registry,
	contentSizes,
}: FlowEdgesProps) {
	return (
		// A 1x1 SVG with overflow visible: the drawing area is unbounded, so the
		// element never has to be resized to the graph's bounds.
		<svg className="flow__edges" width={1} height={1} aria-hidden="true">
			<g>
				{edges.map((edge) => {
					if (edge.hidden) return null;

					const source = nodes.get(edge.source);
					const target = nodes.get(edge.target);
					if (!source || !target) return null;

					const sourceHandle = registry.resolve(
						edge.source,
						edge.sourceHandle,
						"source",
					);
					const targetHandle = registry.resolve(
						edge.target,
						edge.targetHandle,
						"target",
					);
					// Handles register a commit after their node mounts. Skipping the
					// edge for that frame is correct; drawing it would anchor to the
					// node origin, which reads as a stray line to the corner.
					if (!sourceHandle || !targetHandle) return null;

					const from = handlePoint(
						source,
						sourceHandle.position,
						contentSizes.get(source.id),
					);
					const to = handlePoint(
						target,
						targetHandle.position,
						contentSizes.get(target.id),
					);

					const [d] = getSimpleBezierPath({
						sourceX: from.x,
						sourceY: from.y,
						sourcePosition: sourceHandle.position,
						targetX: to.x,
						targetY: to.y,
						targetPosition: targetHandle.position,
					});

					return <FlowEdgeItem key={edge.id} edge={edge} d={d} />;
				})}
			</g>
		</svg>
	);
});
