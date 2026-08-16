import type { CanvasNode } from "./types";

/** Panning bounds: [[minX, minY], [maxX, maxY]] in canvas coordinates. */
export type TranslateExtent = [[number, number], [number, number]];

/** Used when there is nothing laid out yet, so panning still has sane limits. */
const EMPTY_EXTENT: TranslateExtent = [
	[-1000, -400],
	[2400, 800],
];

/**
 * Extra room to the right of the widest node.
 *
 * Feature cards grow a scrollable task list, and a feature with 60 tasks needs
 * far more slack to the right than one with three — without it the user cannot
 * pan far enough to read the tail of a long list.
 */
export function computeExtraRightPadding(maxTaskCount: number): number {
	if (maxTaskCount >= 60) return 2800;
	if (maxTaskCount >= 40) return 2400;
	if (maxTaskCount >= 20) return 2000;
	return 1200;
}

/**
 * Panning bounds derived from the laid-out node positions.
 *
 * Note this reads node *positions* only (plus a fixed 680px width allowance),
 * not measured widths — so it is stable across re-renders that change content
 * but not layout.
 */
export function computeTranslateExtent(
	nodes: CanvasNode[],
	extraRightPadding: number,
): TranslateExtent {
	if (!nodes.length) return EMPTY_EXTENT;

	const xPositions = nodes.map((node) => node.position.x);
	const yPositions = nodes.map((node) => node.position.y);

	const NODE_WIDTH = 680;
	const minX = Math.min(...xPositions) - 400;
	const maxX = Math.max(...xPositions) + NODE_WIDTH + extraRightPadding;
	const minY = Math.min(...yPositions) - 240;
	const maxY = Math.max(...yPositions) + 720;

	return [
		[minX, minY],
		[maxX, maxY],
	];
}
