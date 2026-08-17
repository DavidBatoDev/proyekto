/**
 * Orthogonal ("elbow") routing for dependency arrows.
 *
 * Replaces the bezier this used to draw. A bezier is fine when the successor
 * sits to the right of its predecessor, but a Gantt's most important edge is
 * the *backward* one — a successor starting before its predecessor finishes,
 * which is exactly the conflict the feature exists to surface. There a bezier
 * collapses into a diagonal that cuts straight through the bars. An elbow
 * routes around instead, which is also what every Gantt tool does.
 */

export interface RouteParams {
	sourceX: number;
	sourceY: number;
	/** +1 when the line leaves the predecessor rightwards, -1 leftwards. */
	sourceDir: 1 | -1;
	targetX: number;
	targetY: number;
	/** +1 when the line enters the successor travelling right, -1 travelling left. */
	targetDir: 1 | -1;
}

export interface RouteResult {
	path: string;
	labelX: number;
	labelY: number;
}

/** Horizontal stub off each bar before the line is allowed to turn. */
export const STUB = 14;
/**
 * Distance the line stops short of the bar. The arrow layer renders beneath the
 * bars (z-5 vs z-10) so the head must not land on the bar itself, or it is
 * drawn underneath and appears to be missing.
 */
export const TIP_GAP = 5;
const CORNER_RADIUS = 6;

type Point = { x: number; y: number };

/**
 * Emit a polyline with rounded corners. Each interior vertex becomes a short
 * quadratic whose control point is the vertex itself, so the corner radius
 * never overshoots a segment shorter than twice the radius.
 */
function roundedPath(points: Point[], radius: number): string {
	if (points.length === 0) return "";
	if (points.length === 1) return `M${points[0].x},${points[0].y}`;

	let d = `M${points[0].x},${points[0].y}`;

	for (let i = 1; i < points.length - 1; i += 1) {
		const previous = points[i - 1];
		const corner = points[i];
		const next = points[i + 1];

		const inLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
		const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
		const r = Math.min(radius, inLength / 2, outLength / 2);

		if (r <= 0.5) {
			d += `L${corner.x},${corner.y}`;
			continue;
		}

		const enter = {
			x: corner.x - ((corner.x - previous.x) / inLength) * r,
			y: corner.y - ((corner.y - previous.y) / inLength) * r,
		};
		const exit = {
			x: corner.x + ((next.x - corner.x) / outLength) * r,
			y: corner.y + ((next.y - corner.y) / outLength) * r,
		};

		d += `L${enter.x},${enter.y}Q${corner.x},${corner.y} ${exit.x},${exit.y}`;
	}

	const last = points[points.length - 1];
	d += `L${last.x},${last.y}`;
	return d;
}

/** The vertices of the route, before rounding. Exported for tests. */
export function routePoints({
	sourceX,
	sourceY,
	sourceDir,
	targetX,
	targetY,
	targetDir,
}: RouteParams): Point[] {
	// The tip stops short of the bar so the arrowhead stays visible.
	const tip = { x: targetX - targetDir * TIP_GAP, y: targetY };
	const exit = { x: sourceX + sourceDir * STUB, y: sourceY };
	// Where the line must already be travelling horizontally into the target.
	const approach = { x: tip.x - targetDir * STUB, y: targetY };

	// Is there room to turn once and arrive travelling in the right direction?
	const hasRoom = (approach.x - exit.x) * targetDir > 0;

	if (sourceY === targetY) {
		// Same row (only reachable via an epic rollup): a straight shot.
		return [{ x: sourceX, y: sourceY }, tip];
	}

	if (hasRoom) {
		// Z-route: out, across at the midpoint, in.
		const midX = (exit.x + approach.x) / 2;
		return [
			{ x: sourceX, y: sourceY },
			{ x: midX, y: sourceY },
			{ x: midX, y: targetY },
			tip,
		];
	}

	// Backward: run the horizontal leg in the lane between the two rows, so it
	// passes between the bars rather than through them.
	const laneY = (sourceY + targetY) / 2;
	return [
		{ x: sourceX, y: sourceY },
		exit,
		{ x: exit.x, y: laneY },
		{ x: approach.x, y: laneY },
		approach,
		tip,
	];
}

export function routeDependencyPath(params: RouteParams): RouteResult {
	const points = routePoints(params);
	const path = roundedPath(points, CORNER_RADIUS);

	// Label sits on the middle vertex of the route, which is on the horizontal
	// leg for both shapes — a stable, uncluttered spot for the remove chip.
	const middle = points[Math.floor(points.length / 2)];
	return { path, labelX: middle.x, labelY: middle.y };
}
