import { describe, expect, it } from "vitest";
import { HandleRegistry, handlePoint } from "./handles";
import type { FlowNode } from "./types";

const epic: FlowNode = {
	id: "epic-1",
	position: { x: 100, y: 340 },
	data: {},
	width: 500,
	height: 220,
};

describe("handlePoint", () => {
	it("anchors to the midpoint of each edge of the node box", () => {
		expect(handlePoint(epic, "left")).toEqual({ x: 100, y: 450 });
		expect(handlePoint(epic, "right")).toEqual({ x: 600, y: 450 });
		expect(handlePoint(epic, "top")).toEqual({ x: 350, y: 340 });
		expect(handlePoint(epic, "bottom")).toEqual({ x: 350, y: 560 });
	});

	it("prefers the rendered content size over the declared box", () => {
		// The regression this guards: the roadmap's epic nodes declare a height of
		// 220 as SPACING metadata while the card inside renders at 137. Anchoring
		// to the declared box put the edge 83px below the card it should touch,
		// which on screen reads as an edge floating in empty space.
		const rendered = { width: 500, height: 137 };

		expect(handlePoint(epic, "bottom", rendered)).toEqual({ x: 350, y: 477 });
		expect(handlePoint(epic, "right", rendered)).toEqual({ x: 600, y: 408.5 });
		// Top and left are unaffected — they sit at the node origin either way.
		expect(handlePoint(epic, "top", rendered)).toEqual(
			handlePoint(epic, "top"),
		);
	});

	it("falls back to the declared box before anything is measured", () => {
		// First paint, and jsdom, have no measurement yet. Edges must still be
		// drawn somewhere sensible rather than collapsing to the origin.
		expect(handlePoint(epic, "bottom", undefined)).toEqual({ x: 350, y: 560 });
	});

	it("treats a node with no declared size as a point", () => {
		// Not a supported state, but it must degrade to the node origin rather
		// than producing NaN, which would poison every path string it touches.
		const sizeless: FlowNode = { id: "x", position: { x: 5, y: 7 }, data: {} };
		for (const side of ["left", "right", "top", "bottom"] as const) {
			expect(handlePoint(sizeless, side)).toEqual({ x: 5, y: 7 });
		}
	});
});

describe("HandleRegistry.resolve", () => {
	/** Mirrors EpicWidget's registration order exactly. */
	function epicRegistry(): HandleRegistry {
		const registry = new HandleRegistry();
		registry.register("epic-1", {
			id: "epic-top",
			type: "target",
			position: "top",
			order: 0,
		});
		registry.register("epic-1", {
			id: "epic-bottom",
			type: "source",
			position: "bottom",
			order: 1,
		});
		registry.register("epic-1", {
			id: "epic-right",
			type: "source",
			position: "right",
			order: 2,
		});
		return registry;
	}

	/** Mirrors FeatureWidget: two UNNAMED handles, target/left then source/right. */
	function featureRegistry(): HandleRegistry {
		const registry = new HandleRegistry();
		registry.register("feature-1", {
			type: "target",
			position: "left",
			order: 0,
		});
		registry.register("feature-1", {
			type: "source",
			position: "right",
			order: 1,
		});
		return registry;
	}

	it("resolves named handles by id", () => {
		const registry = epicRegistry();
		expect(registry.resolve("epic-1", "epic-right", "source")?.position).toBe(
			"right",
		);
		expect(registry.resolve("epic-1", "epic-bottom", "source")?.position).toBe(
			"bottom",
		);
		expect(registry.resolve("epic-1", "epic-top", "target")?.position).toBe(
			"top",
		);
	});

	it("falls back to the first registered handle of the type when no id is given", () => {
		// This is the case every feature edge depends on: they specify
		// sourceHandle "epic-right" but omit targetHandle entirely.
		const registry = featureRegistry();
		expect(registry.resolve("feature-1", undefined, "target")?.position).toBe(
			"left",
		);
		expect(registry.resolve("feature-1", null, "source")?.position).toBe(
			"right",
		);
	});

	it("orders the fallback by registration order, not insertion order", () => {
		// Registration can arrive out of order (StrictMode double-invokes layout
		// effects, remounts re-register). The declared `order` is what decides.
		const registry = new HandleRegistry();
		registry.register("n", { type: "target", position: "right", order: 5 });
		registry.register("n", { type: "target", position: "left", order: 1 });

		expect(registry.resolve("n", undefined, "target")?.position).toBe("left");
	});

	it("does not resolve a handle of the wrong type", () => {
		const registry = epicRegistry();
		// epic-right is a source; asking for it as a target must fail rather than
		// silently anchoring an edge to the wrong end of the node.
		expect(registry.resolve("epic-1", "epic-right", "target")).toBeNull();
	});

	it("returns null for unknown nodes and unknown handle ids", () => {
		const registry = epicRegistry();
		expect(registry.resolve("nope", "epic-top", "target")).toBeNull();
		expect(registry.resolve("epic-1", "does-not-exist", "target")).toBeNull();
	});

	it("forgets handles on unregister", () => {
		const registry = new HandleRegistry();
		const registration = {
			type: "target" as const,
			position: "left" as const,
			order: 0,
		};
		registry.register("n", registration);
		expect(registry.resolve("n", undefined, "target")).not.toBeNull();

		registry.unregister("n", registration);
		expect(registry.resolve("n", undefined, "target")).toBeNull();
		expect(registry.get("n")).toEqual([]);
	});
});
