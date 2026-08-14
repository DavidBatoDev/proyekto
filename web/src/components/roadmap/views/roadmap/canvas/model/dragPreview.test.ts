/**
 * Characterization tests for `computeDragPreview` — the shared reflow builder run
 * by BOTH the local drag and the remote-collaborator mirror. Because both paths
 * call it, pinning it here means a renderer swap can only break event plumbing,
 * never the geometry two users disagree about.
 */
import { describe, expect, it } from "vitest";
import {
	byId,
	makeEdges,
	makeEpic,
	makeFeature,
	makeNodes,
} from "./__fixtures__/canvasGraph";
import { computeDragPreview } from "./dragPreview";
import { getLayoutedElements } from "./layout";
import type { CanvasEdge, StructuralNodeData } from "./types";

/**
 * Two epics, one feature each. The settled layout this produces:
 *   e1 y=100 (centre 210), f1 y=135
 *   e2 y=440 (centre 550), f2 y=475
 */
function scenario() {
	const epics = [
		makeEpic("e1", 0, { features: [makeFeature("f1", "e1", 0)] }),
		makeEpic("e2", 1000, { features: [makeFeature("f2", "e2", 0)] }),
	];
	const structural = makeNodes(epics);
	const edges = makeEdges(epics);
	const layoutedNodes = getLayoutedElements(structural, edges, epics)
		.nodes as ReturnType<typeof makeNodes>;
	return { epics, edges, layoutedNodes };
}

const featureEdge = (edges: CanvasEdge[], featureId: string) =>
	edges.find((edge) => edge.target === featureId);

describe("computeDragPreview — epic drag", () => {
	it("leaves the dragged epic exactly under the cursor", () => {
		const { epics, edges, layoutedNodes } = scenario();
		const draggedPosition = { x: 100, y: 0 };

		const { nodes } = computeDragPreview({
			ds: { nodeId: "e2", type: "epic" },
			draggedPosition,
			baseNodes: layoutedNodes,
			originalNodes: layoutedNodes,
			relativeYs: new Map([["f2", 35]]),
			epics,
			layoutedNodes,
			edges,
			edgeAnimationsEnabled: true,
		});

		const dragged = byId(nodes).get("e2");
		expect(dragged?.position).toEqual(draggedPosition);
		expect(dragged?.zIndex).toBe(1000);
	});

	it("carries child features at their captured relative offsets", () => {
		const { epics, edges, layoutedNodes } = scenario();

		const { nodes } = computeDragPreview({
			ds: { nodeId: "e2", type: "epic" },
			draggedPosition: { x: 100, y: 0 },
			baseNodes: layoutedNodes,
			originalNodes: layoutedNodes,
			relativeYs: new Map([["f2", 35]]),
			epics,
			layoutedNodes,
			edges,
			edgeAnimationsEnabled: true,
		});

		const child = byId(nodes).get("f2");
		expect(child?.position.y).toBe(35);
		expect(child?.zIndex).toBe(999);
	});

	it("reflows the epics that were not dragged into their preview slots", () => {
		const { epics, edges, layoutedNodes } = scenario();

		// Dragging e2 above e1 swaps the order, so e1 should slide into the
		// second slot (y=440) that e2 vacated.
		const { nodes } = computeDragPreview({
			ds: { nodeId: "e2", type: "epic" },
			draggedPosition: { x: 100, y: 0 },
			baseNodes: layoutedNodes,
			originalNodes: layoutedNodes,
			relativeYs: new Map([["f2", 35]]),
			epics,
			layoutedNodes,
			edges,
			edgeAnimationsEnabled: true,
		});

		expect(byId(nodes).get("e1")?.position.y).toBe(440);
	});

	it("passes edges through unchanged", () => {
		const { epics, edges, layoutedNodes } = scenario();

		const result = computeDragPreview({
			ds: { nodeId: "e2", type: "epic" },
			draggedPosition: { x: 100, y: 0 },
			baseNodes: layoutedNodes,
			originalNodes: layoutedNodes,
			relativeYs: null,
			epics,
			layoutedNodes,
			edges,
			edgeAnimationsEnabled: true,
		});

		expect(result.edges).toBe(edges);
	});
});

describe("computeDragPreview — feature drag", () => {
	const dragFeatureIntoE1 = (edgeAnimationsEnabled: boolean) => {
		const { epics, edges, layoutedNodes } = scenario();
		return computeDragPreview({
			ds: { nodeId: "f2", type: "feature", sourceEpicId: "e2" },
			// centre 75 -> nearest epic centre is e1 (210), not e2 (550)
			draggedPosition: { x: 750, y: 0 },
			baseNodes: layoutedNodes,
			originalNodes: layoutedNodes,
			relativeYs: null,
			epics,
			layoutedNodes,
			edges,
			edgeAnimationsEnabled,
		});
	};

	it("re-points and highlights the edge when the feature crosses epics", () => {
		const { edges } = dragFeatureIntoE1(true);
		const edge = featureEdge(edges, "f2");

		expect(edge?.id).toBe("epic-feature-e1-f2");
		expect(edge?.source).toBe("e1");
		expect(edge?.style).toEqual({
			stroke: "#f59e0b",
			strokeWidth: 2.5,
			strokeDasharray: "6,3",
		});
		expect(edge?.animated).toBe(true);
	});

	it("does not animate the crossing edge when motion is reduced", () => {
		const { edges } = dragFeatureIntoE1(false);
		const edge = featureEdge(edges, "f2");

		// Still visually re-pointed and dashed, just not animated.
		expect(edge?.source).toBe("e1");
		expect(edge?.style).toMatchObject({ stroke: "#f59e0b" });
		expect(edge?.animated).toBe(false);
	});

	it("leaves other features' edges untouched", () => {
		const { edges } = dragFeatureIntoE1(true);
		const untouched = featureEdge(edges, "f1");

		expect(untouched?.source).toBe("e1");
		expect(untouched?.style).toMatchObject({ stroke: "var(--canvas-edge)" });
		expect(untouched?.animated).toBe(false);
	});

	it("keeps the original edge styling for a same-epic reorder", () => {
		const { epics, edges, layoutedNodes } = scenario();

		const result = computeDragPreview({
			ds: { nodeId: "f2", type: "feature", sourceEpicId: "e2" },
			// stays inside e2's neighbourhood (centre 575 -> nearest is e2 at 550)
			draggedPosition: { x: 750, y: 500 },
			baseNodes: layoutedNodes,
			originalNodes: layoutedNodes,
			relativeYs: null,
			epics,
			layoutedNodes,
			edges,
			edgeAnimationsEnabled: true,
		});

		const edge = featureEdge(result.edges, "f2");
		expect(edge?.source).toBe("e2");
		expect(edge?.style).toMatchObject({ stroke: "var(--canvas-edge)" });
		expect(edge?.animated).toBe(false);
	});

	it("holds the dragged feature at the cursor while others reflow", () => {
		const draggedPosition = { x: 750, y: 0 };
		const { epics, edges, layoutedNodes } = scenario();

		const { nodes } = computeDragPreview({
			ds: { nodeId: "f2", type: "feature", sourceEpicId: "e2" },
			draggedPosition,
			baseNodes: layoutedNodes,
			originalNodes: layoutedNodes,
			relativeYs: null,
			epics,
			layoutedNodes,
			edges,
			edgeAnimationsEnabled: true,
		});

		expect(byId(nodes).get("f2")?.position).toEqual(draggedPosition);
	});

	it("derives the new order from originalNodes, not from baseNodes", () => {
		// The order calculation must read PRE-DRAG positions, so that earlier
		// preview frames (which have already shifted the non-dragged nodes) cannot
		// feed back and corrupt it. Proven by moving e1 only in `originalNodes`:
		// if that snapshot is what drives the reorder, the outcome flips.
		const { epics, edges, layoutedNodes } = scenario();
		const draggedPosition = { x: 750, y: 0 }; // centre 75

		const withTrueOriginals = computeDragPreview({
			ds: { nodeId: "f2", type: "feature", sourceEpicId: "e2" },
			draggedPosition,
			baseNodes: layoutedNodes,
			originalNodes: layoutedNodes,
			relativeYs: null,
			epics,
			layoutedNodes,
			edges,
			edgeAnimationsEnabled: true,
		});
		// e1 centre 210 is nearest -> the feature crosses into e1.
		expect(featureEdge(withTrueOriginals.edges, "f2")?.source).toBe("e1");

		// Same drag, same baseNodes, but e1 is far away in the pre-drag snapshot.
		const movedOriginals = layoutedNodes.map((node) =>
			node.id === "e1" ? { ...node, position: { x: 100, y: 5000 } } : node,
		);
		const withMovedOriginals = computeDragPreview({
			ds: { nodeId: "f2", type: "feature", sourceEpicId: "e2" },
			draggedPosition,
			baseNodes: layoutedNodes,
			originalNodes: movedOriginals,
			relativeYs: null,
			epics,
			layoutedNodes,
			edges,
			edgeAnimationsEnabled: true,
		});
		// e2 centre 550 now wins, so there is no crossing.
		expect(featureEdge(withMovedOriginals.edges, "f2")?.source).toBe("e2");
	});
});

describe("computeDragPreview — structural node data", () => {
	it("preserves each node's epic/feature payload through a preview", () => {
		const { epics, edges, layoutedNodes } = scenario();

		const { nodes } = computeDragPreview({
			ds: { nodeId: "e2", type: "epic" },
			draggedPosition: { x: 100, y: 0 },
			baseNodes: layoutedNodes,
			originalNodes: layoutedNodes,
			relativeYs: new Map([["f2", 35]]),
			epics,
			layoutedNodes,
			edges,
			edgeAnimationsEnabled: true,
		});

		const data = byId(nodes).get("f2")?.data as StructuralNodeData;
		expect(data.kind).toBe("feature");
	});
});
