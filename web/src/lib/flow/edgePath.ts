import type { HandlePosition } from "./types";

/**
 * Simple-bezier edge paths.
 *
 * This is a deliberate, line-for-line transcription of React Flow's
 * `getSimpleBezierPath` (@xyflow/react/dist/esm/index.js) so the emitted `d`
 * strings are byte-identical to the ones the app renders today. edgePath.test.ts
 * asserts exactly that against the real implementation while the dependency
 * still exists — which buys pixel-exact edge parity for free, and is the single
 * highest-leverage parity check available in this migration.
 *
 * Two things must not be "cleaned up":
 *   - No rounding, no `toFixed`. `String(number)` is the formatter; any rounding
 *     changes the emitted path and breaks byte-identity.
 *   - The control-point argument order (see `getControl` calls below).
 */

interface GetControlParams {
	pos: HandlePosition;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

function getControl({
	pos,
	x1,
	y1,
	x2,
	y2,
}: GetControlParams): [number, number] {
	if (pos === "left" || pos === "right") {
		return [0.5 * (x1 + x2), y1];
	}
	return [x1, 0.5 * (y1 + y2)];
}

export interface GetSimpleBezierPathParams {
	sourceX: number;
	sourceY: number;
	sourcePosition?: HandlePosition;
	targetX: number;
	targetY: number;
	targetPosition?: HandlePosition;
}

export type SimpleBezierPathResult = [
	path: string,
	labelX: number,
	labelY: number,
	offsetX: number,
	offsetY: number,
];

export function getSimpleBezierPath({
	sourceX,
	sourceY,
	sourcePosition = "bottom",
	targetX,
	targetY,
	targetPosition = "top",
}: GetSimpleBezierPathParams): SimpleBezierPathResult {
	const [sourceControlX, sourceControlY] = getControl({
		pos: sourcePosition,
		x1: sourceX,
		y1: sourceY,
		x2: targetX,
		y2: targetY,
	});
	// NOTE the swap: the target control is computed with the TARGET as (x1,y1)
	// and the SOURCE as (x2,y2). For left/right that yields the same x as the
	// source control but at the target's y. Reversing these reads as correct and
	// silently changes every curve.
	const [targetControlX, targetControlY] = getControl({
		pos: targetPosition,
		x1: targetX,
		y1: targetY,
		x2: sourceX,
		y2: sourceY,
	});

	const centerX =
		sourceX * 0.125 +
		sourceControlX * 0.375 +
		targetControlX * 0.375 +
		targetX * 0.125;
	const centerY =
		sourceY * 0.125 +
		sourceControlY * 0.375 +
		targetControlY * 0.375 +
		targetY * 0.125;
	const offsetX = Math.abs(centerX - sourceX);
	const offsetY = Math.abs(centerY - sourceY);

	return [
		`M${sourceX},${sourceY} C${sourceControlX},${sourceControlY} ${targetControlX},${targetControlY} ${targetX},${targetY}`,
		centerX,
		centerY,
		offsetX,
		offsetY,
	];
}
