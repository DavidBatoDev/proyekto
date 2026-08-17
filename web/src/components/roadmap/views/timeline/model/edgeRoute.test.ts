import { describe, expect, it } from "vitest";
import { routeDependencyPath, routePoints, STUB, TIP_GAP } from "./edgeRoute";

/** Forward: successor bar starts well to the right of the predecessor's end. */
const forward = {
	sourceX: 100,
	sourceY: 24,
	sourceDir: 1 as const,
	targetX: 400,
	targetY: 72,
	targetDir: 1 as const,
};

/** Backward: successor starts BEFORE the predecessor ends — the conflict case. */
const backward = {
	sourceX: 400,
	sourceY: 24,
	sourceDir: 1 as const,
	targetX: 150,
	targetY: 72,
	targetDir: 1 as const,
};

const isOrthogonal = (points: { x: number; y: number }[]) =>
	points.every((point, i) => {
		if (i === 0) return true;
		const previous = points[i - 1];
		return point.x === previous.x || point.y === previous.y;
	});

describe("routePoints", () => {
	it("keeps every segment horizontal or vertical", () => {
		expect(isOrthogonal(routePoints(forward))).toBe(true);
		expect(isOrthogonal(routePoints(backward))).toBe(true);
	});

	it("starts exactly on the predecessor's edge", () => {
		const points = routePoints(forward);
		expect(points[0]).toEqual({ x: 100, y: 24 });
	});

	it("stops short of the successor so the arrowhead stays visible", () => {
		// The layer renders beneath the bars, so a tip landing on the bar would
		// be hidden underneath it.
		const points = routePoints(forward);
		const tip = points[points.length - 1];
		expect(tip.x).toBe(400 - TIP_GAP);
		expect(tip.y).toBe(72);
	});

	it("uses a simple Z route when there is room", () => {
		const points = routePoints(forward);
		expect(points).toHaveLength(4);
		// One vertical leg, at the midpoint between the two stubs.
		expect(points[1].y).toBe(24);
		expect(points[2].y).toBe(72);
		expect(points[1].x).toBe(points[2].x);
	});

	it("routes a backward edge around, never straight through the bars", () => {
		const points = routePoints(backward);
		// Out, down to the lane, back across, then in: six vertices.
		expect(points).toHaveLength(6);

		// It must first travel RIGHT of the predecessor's end before turning,
		// which is what stops the line cutting back across the source bar.
		expect(points[1].x).toBe(400 + STUB);

		// The long horizontal leg runs in the lane between the two rows, so it
		// passes between the bars rather than over them.
		const laneY = (24 + 72) / 2;
		expect(points[2].y).toBe(laneY);
		expect(points[3].y).toBe(laneY);
		expect(laneY).toBeGreaterThan(24);
		expect(laneY).toBeLessThan(72);
	});

	it("approaches the target travelling in the entry direction", () => {
		const points = routePoints(backward);
		const tip = points[points.length - 1];
		const approach = points[points.length - 2];
		// Final leg is horizontal and moves rightwards into a start edge.
		expect(approach.y).toBe(tip.y);
		expect(approach.x).toBeLessThan(tip.x);
	});

	it("draws a straight line when both ends share a row", () => {
		// Only reachable via an epic rollup, where both endpoints collapse onto
		// one bar's row.
		const points = routePoints({ ...forward, targetY: 24 });
		expect(points).toHaveLength(2);
		expect(points[0].y).toBe(points[1].y);
	});

	it("mirrors the geometry when entering a finish edge (FF)", () => {
		const points = routePoints({
			sourceX: 100,
			sourceY: 24,
			sourceDir: 1,
			targetX: 400,
			targetY: 72,
			targetDir: -1,
		});
		const tip = points[points.length - 1];
		// Entering leftwards, so the tip sits to the RIGHT of the bar edge.
		expect(tip.x).toBe(400 + TIP_GAP);
	});
});

describe("routeDependencyPath", () => {
	it("emits a path with rounded corners rather than sharp joins", () => {
		const { path } = routeDependencyPath(forward);
		expect(path.startsWith("M100,24")).toBe(true);
		expect(path).toContain("Q");
	});

	it("never emits NaN", () => {
		for (const params of [forward, backward]) {
			expect(routeDependencyPath(params).path).not.toContain("NaN");
		}
	});

	it("puts the label on the route, between the two rows for a backward edge", () => {
		const { labelX, labelY } = routeDependencyPath(backward);
		expect(Number.isFinite(labelX)).toBe(true);
		expect(labelY).toBe((24 + 72) / 2);
	});

	it("degrades to a straight join when the bars nearly touch", () => {
		// Segments shorter than the corner radius must not overshoot into a
		// visibly wrong curve.
		const { path } = routeDependencyPath({
			sourceX: 100,
			sourceY: 24,
			sourceDir: 1,
			targetX: 102,
			targetY: 72,
			targetDir: 1,
		});
		expect(path).not.toContain("NaN");
		expect(path.startsWith("M100,24")).toBe(true);
	});
});
