import { describe, expect, it } from "vitest";
import { findEpicAtCanvasPoint } from "./hitTest";
import type { CanvasNode } from "./types";

const epic = (
	id: string,
	x: number,
	y: number,
	dims?: { width?: number; height?: number },
): CanvasNode =>
	({
		id,
		type: "epicWidget",
		position: { x, y },
		width: dims?.width,
		height: dims?.height,
		data: {},
	}) as CanvasNode;

const feature = (id: string, x: number, y: number): CanvasNode =>
	({
		id,
		type: "featureWidget",
		position: { x, y },
		width: 500,
		height: 150,
		data: {},
	}) as CanvasNode;

describe("findEpicAtCanvasPoint", () => {
	const nodes = [
		epic("e1", 100, 100, { width: 500, height: 220 }),
		epic("e2", 100, 500, { width: 500, height: 220 }),
		feature("f1", 750, 100),
	];

	it("finds the epic whose box contains the point", () => {
		expect(findEpicAtCanvasPoint(nodes, { x: 300, y: 200 })?.id).toBe("e1");
		expect(findEpicAtCanvasPoint(nodes, { x: 300, y: 600 })?.id).toBe("e2");
	});

	it("treats the box bounds as inclusive", () => {
		expect(findEpicAtCanvasPoint(nodes, { x: 100, y: 100 })?.id).toBe("e1");
		expect(findEpicAtCanvasPoint(nodes, { x: 600, y: 320 })?.id).toBe("e1");
	});

	it("returns undefined just outside the box", () => {
		expect(findEpicAtCanvasPoint(nodes, { x: 601, y: 200 })).toBeUndefined();
		expect(findEpicAtCanvasPoint(nodes, { x: 300, y: 321 })).toBeUndefined();
	});

	it("ignores feature nodes even when the point is over one", () => {
		// The toolbar only supports dropping an epic onto an epic.
		expect(findEpicAtCanvasPoint(nodes, { x: 800, y: 150 })).toBeUndefined();
	});

	it("falls back to default dimensions when a node has none", () => {
		const unsized = [epic("e1", 0, 0)];

		expect(findEpicAtCanvasPoint(unsized, { x: 499, y: 219 })?.id).toBe("e1");
		expect(findEpicAtCanvasPoint(unsized, { x: 501, y: 0 })).toBeUndefined();
	});

	it("returns the first match when boxes overlap", () => {
		const overlapping = [
			epic("front", 0, 0, { width: 500, height: 220 }),
			epic("behind", 100, 100, { width: 500, height: 220 }),
		];

		expect(findEpicAtCanvasPoint(overlapping, { x: 200, y: 150 })?.id).toBe(
			"front",
		);
	});

	it("returns undefined for an empty graph", () => {
		expect(findEpicAtCanvasPoint([], { x: 0, y: 0 })).toBeUndefined();
	});
});
