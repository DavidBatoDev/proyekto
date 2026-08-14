import { describe, expect, it } from "vitest";
import { computeExtraRightPadding, computeTranslateExtent } from "./extent";
import type { CanvasNode } from "./types";

const node = (x: number, y: number): CanvasNode =>
	({ id: `${x}-${y}`, position: { x, y }, data: {} }) as CanvasNode;

describe("computeExtraRightPadding", () => {
	it("steps through the task-count tiers", () => {
		// Boundaries matter: a roadmap sitting exactly on a tier edge should not
		// flip padding between renders.
		expect(computeExtraRightPadding(0)).toBe(1200);
		expect(computeExtraRightPadding(19)).toBe(1200);
		expect(computeExtraRightPadding(20)).toBe(2000);
		expect(computeExtraRightPadding(39)).toBe(2000);
		expect(computeExtraRightPadding(40)).toBe(2400);
		expect(computeExtraRightPadding(59)).toBe(2400);
		expect(computeExtraRightPadding(60)).toBe(2800);
		expect(computeExtraRightPadding(500)).toBe(2800);
	});
});

describe("computeTranslateExtent", () => {
	it("falls back to fixed bounds when nothing is laid out", () => {
		expect(computeTranslateExtent([], 1200)).toEqual([
			[-1000, -400],
			[2400, 800],
		]);
	});

	it("derives bounds from node positions plus fixed margins", () => {
		const nodes = [node(100, 100), node(750, 900)];

		expect(computeTranslateExtent(nodes, 1200)).toEqual([
			[100 - 400, 100 - 240],
			[750 + 680 + 1200, 900 + 720],
		]);
	});

	it("widens the right bound as padding grows", () => {
		const nodes = [node(100, 100)];
		const [, [narrowMaxX]] = computeTranslateExtent(nodes, 1200);
		const [, [wideMaxX]] = computeTranslateExtent(nodes, 2800);

		expect(wideMaxX - narrowMaxX).toBe(1600);
	});

	it("handles negative positions", () => {
		const nodes = [node(-500, -300), node(0, 0)];
		const [[minX, minY], [maxX, maxY]] = computeTranslateExtent(nodes, 1200);

		expect(minX).toBe(-900);
		expect(minY).toBe(-540);
		expect(maxX).toBe(1880);
		expect(maxY).toBe(720);
	});
});
