import { getViewportForBounds as rfViewportForBounds } from "@xyflow/system";
import { describe, expect, it } from "vitest";
import {
	constrainTransform,
	flowToScreen,
	getNodesBounds,
	getViewportForBounds,
	scaleBy,
	screenToFlow,
	visibleRect,
} from "./transform";
import type { FlowNode, TranslateExtent, Viewport } from "./types";

/**
 * The `@xyflow/system` cross-checks below must be DELETED with the dependency;
 * the surrounding assertions on our own output stay. See edgePath.test.ts for
 * the same arrangement and the reasoning.
 */

// A container that is NOT at the page origin. Using {left:0,top:0} would let an
// offset bug pass every test here, and the app always renders the canvas below
// a header and beside a sidebar.
const RECT = { left: 37, top: 91 };

const node = (id: string, x: number, y: number, h = 220): FlowNode => ({
	id,
	position: { x, y },
	data: {},
	width: 500,
	height: h,
});

describe("screenToFlow / flowToScreen", () => {
	it("round-trips under a non-zero container offset and non-unit zoom", () => {
		const viewport: Viewport = { x: -50, y: 0, zoom: 0.67 };
		const original = { x: 812.5, y: -344.25 };

		const screen = flowToScreen(original, RECT, viewport);
		const back = screenToFlow(screen, RECT, viewport);

		expect(back.x).toBeCloseTo(original.x, 9);
		expect(back.y).toBeCloseTo(original.y, 9);
	});

	it("accounts for the container offset rather than ignoring it", () => {
		const viewport: Viewport = { x: 0, y: 0, zoom: 1 };
		const atOrigin = screenToFlow(
			{ x: 0, y: 0 },
			{ left: 0, top: 0 },
			viewport,
		);
		const offset = screenToFlow({ x: 0, y: 0 }, RECT, viewport);

		expect(atOrigin).toEqual({ x: 0, y: 0 });
		expect(offset).toEqual({ x: -37, y: -91 });
	});

	it("divides by zoom, so a zoomed-out canvas maps further in flow space", () => {
		const point = { x: RECT.left + 100, y: RECT.top + 100 };
		expect(screenToFlow(point, RECT, { x: 0, y: 0, zoom: 0.5 })).toEqual({
			x: 200,
			y: 200,
		});
		expect(screenToFlow(point, RECT, { x: 0, y: 0, zoom: 2 })).toEqual({
			x: 50,
			y: 50,
		});
	});
});

describe("scaleBy", () => {
	it("keeps the pivot point stationary", () => {
		const viewport: Viewport = { x: -120, y: 44, zoom: 0.67 };
		const pivot = { x: 600, y: 400 };
		const before = (pivot.x - viewport.x) / viewport.zoom;

		const next = scaleBy(viewport, 1.2, pivot, 0.2, 1.5);
		const after = (pivot.x - next.x) / next.zoom;

		expect(next.zoom).toBeCloseTo(0.804, 9);
		expect(after).toBeCloseTo(before, 9);
	});

	it("clamps to the zoom range and returns the same viewport at the limit", () => {
		const atMax: Viewport = { x: 0, y: 0, zoom: 1.5 };
		expect(scaleBy(atMax, 1.2, { x: 0, y: 0 }, 0.4, 1.5)).toBe(atMax);

		const atMin: Viewport = { x: 0, y: 0, zoom: 0.4 };
		expect(scaleBy(atMin, 1 / 1.2, { x: 0, y: 0 }, 0.4, 1.5)).toBe(atMin);
	});
});

describe("constrainTransform", () => {
	const size = { width: 1200, height: 800 };

	it("pulls a viewport panned past the extent back to the boundary", () => {
		// Extent much larger than the viewport, panned far past its left edge.
		const extent: TranslateExtent = [
			[-1000, -400],
			[4000, 3000],
		];
		const constrained = constrainTransform(
			{ x: 5000, y: 0, zoom: 1 },
			size,
			extent,
		);
		// Left edge of the viewport must sit at the extent's minimum x.
		expect(-constrained.x / constrained.zoom).toBeCloseTo(-1000, 9);
	});

	it("leaves a viewport already inside the extent untouched", () => {
		const extent: TranslateExtent = [
			[-1000, -400],
			[4000, 3000],
		];
		const viewport: Viewport = { x: -200, y: -100, zoom: 1 };
		expect(constrainTransform(viewport, size, extent)).toEqual(viewport);
	});

	it("CENTRES content when the extent is narrower than the viewport", () => {
		// This is the branch a naive clamp gets wrong: with content smaller than
		// the viewport, d3 centres it instead of jamming it against an edge.
		const extent: TranslateExtent = [
			[0, 0],
			[400, 200],
		];
		const constrained = constrainTransform(
			{ x: 0, y: 0, zoom: 1 },
			size,
			extent,
		);

		const visibleLeft = -constrained.x / constrained.zoom;
		const visibleRight = visibleLeft + size.width / constrained.zoom;
		// Equal slack on both sides of the 400-wide extent.
		expect(0 - visibleLeft).toBeCloseTo(visibleRight - 400, 9);
	});
});

describe("getNodesBounds", () => {
	it("uses declared width/height, not just positions", () => {
		const bounds = getNodesBounds([node("a", 100, 100), node("b", 750, 400)]);
		expect(bounds).toEqual({ x: 100, y: 100, width: 1150, height: 520 });
	});

	it("returns a zero rect for an empty graph rather than Infinity", () => {
		expect(getNodesBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
	});
});

describe("getViewportForBounds", () => {
	// The real call sites: padding 0.12 / maxZoom 0.67, minZoom 0.4 in the app
	// and 0.2 on template previews.
	const CASES = [
		{
			name: "app defaults",
			bounds: { x: 100, y: 100, width: 1150, height: 3200 },
			size: { width: 1200, height: 800 },
			minZoom: 0.4,
			maxZoom: 0.67,
		},
		{
			name: "template preview (minZoom 0.2)",
			bounds: { x: 100, y: 100, width: 1150, height: 9000 },
			size: { width: 1200, height: 800 },
			minZoom: 0.2,
			maxZoom: 0.67,
		},
		{
			name: "tiny graph clamps to maxZoom",
			bounds: { x: 100, y: 100, width: 500, height: 220 },
			size: { width: 1200, height: 800 },
			minZoom: 0.4,
			maxZoom: 0.67,
		},
		{
			name: "phone viewport",
			bounds: { x: 100, y: 100, width: 1150, height: 3200 },
			size: { width: 390, height: 844 },
			minZoom: 0.2,
			maxZoom: 0.67,
		},
	];

	for (const testCase of CASES) {
		it(`matches React Flow's framing — ${testCase.name}`, () => {
			const ours = getViewportForBounds(
				testCase.bounds,
				testCase.size.width,
				testCase.size.height,
				testCase.minZoom,
				testCase.maxZoom,
				0.12,
			);
			const theirs = rfViewportForBounds(
				testCase.bounds,
				testCase.size.width,
				testCase.size.height,
				testCase.minZoom,
				testCase.maxZoom,
				0.12,
			);
			expect(ours).toEqual(theirs);
		});
	}
});

describe("visibleRect", () => {
	it("grows by the margin on all sides", () => {
		const tight = visibleRect(
			{ x: 0, y: 0, zoom: 1 },
			{
				width: 1000,
				height: 800,
			},
		);
		const loose = visibleRect(
			{ x: 0, y: 0, zoom: 1 },
			{ width: 1000, height: 800 },
			200,
		);

		// toBeCloseTo, not toEqual: `-viewport.x / zoom` yields -0 at the origin,
		// and toEqual distinguishes -0 from 0. The sign of zero is meaningless
		// here — it only ever feeds an intersection test.
		expect(tight.x).toBeCloseTo(0, 9);
		expect(tight.y).toBeCloseTo(0, 9);
		expect(tight.width).toBe(1000);
		expect(tight.height).toBe(800);
		expect(loose).toEqual({ x: -200, y: -200, width: 1400, height: 1200 });
	});

	it("covers more flow area when zoomed out", () => {
		const out = visibleRect(
			{ x: 0, y: 0, zoom: 0.5 },
			{
				width: 1000,
				height: 800,
			},
		);
		expect(out.width).toBe(2000);
		expect(out.height).toBe(1600);
	});
});
