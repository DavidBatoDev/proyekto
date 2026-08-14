import type { CanvasNode } from "./types";

/**
 * Fallback box for an epic node that has not been given explicit dimensions.
 * `getLayoutedElements` always assigns both, so these only apply to nodes that
 * somehow reached the canvas unlaid-out.
 */
const DEFAULT_EPIC_WIDTH = 500;
const DEFAULT_EPIC_HEIGHT = 220;

/**
 * Finds the epic whose box contains `point` (canvas coordinates).
 *
 * Used by the "Drag To Add" toolbar: dropping an epic chip onto an existing epic
 * inserts a new one below it. The dragover handler needs the same test to decide
 * whether to show a drop affordance, and the two had drifted into byte-identical
 * copies of this loop — one place now, so they cannot disagree.
 *
 * Bounds are inclusive on both edges, matching the original behaviour.
 */
export function findEpicAtCanvasPoint(
	nodes: CanvasNode[],
	point: { x: number; y: number },
): CanvasNode | undefined {
	return nodes.find((node) => {
		if (node.type !== "epicWidget") return false;
		const width = Number(node.width) || DEFAULT_EPIC_WIDTH;
		const height = Number(node.height) || DEFAULT_EPIC_HEIGHT;
		const withinX =
			point.x >= node.position.x && point.x <= node.position.x + width;
		const withinY =
			point.y >= node.position.y && point.y <= node.position.y + height;
		return withinX && withinY;
	});
}
