/**
 * Characterization tests for `getLayoutedElements` — the hand-written canvas
 * layout. This function had ZERO coverage while being the sole source of every
 * node coordinate on the roadmap canvas, and it is the piece a renderer swap
 * must reproduce byte-for-byte. The numbers below were generated from the
 * current implementation and frozen deliberately: these assert "still the
 * same", not "still correct".
 */
import { describe, expect, it } from "vitest";
import {
	byId,
	makeEdges,
	makeEpic,
	makeFeature,
	makeNodes,
} from "./__fixtures__/canvasGraph";
import { getLayoutedElements } from "./layout";

// Mirrors the constants inside getLayoutedElements. Duplicated on purpose: if
// someone changes one, these tests should fail rather than silently follow.
const EPIC_X = 100;
const FEATURE_X = EPIC_X + 650;
const NODE_WIDTH = 500;
const BASE_EPIC_HEIGHT = 220;
const MAX_EPIC_HEIGHT = 420;
const BASE_FEATURE_HEIGHT = 150;
const MAX_FEATURE_HEIGHT = 300;
const FIRST_Y = 100;

describe("getLayoutedElements", () => {
	it("returns no nodes when there are no epics", () => {
		const result = getLayoutedElements([], [], []);
		expect(result.nodes).toEqual([]);
	});

	it("passes edges through untouched", () => {
		const epics = [
			makeEpic("e1", 0, { features: [makeFeature("f1", "e1", 0)] }),
		];
		const edges = makeEdges(epics);
		const result = getLayoutedElements(makeNodes(epics), edges, epics);
		expect(result.edges).toBe(edges);
	});

	it("places a lone bare epic at the layout origin", () => {
		const epics = [makeEpic("e1", 0)];
		const { nodes } = getLayoutedElements(makeNodes(epics), [], epics);

		expect(nodes).toHaveLength(1);
		expect(nodes[0]).toMatchObject({
			id: "e1",
			width: NODE_WIDTH,
			height: BASE_EPIC_HEIGHT,
			position: { x: EPIC_X, y: FIRST_Y },
		});
	});

	it("gives every node a numeric width and height", () => {
		// The DOM+SVG renderer anchors edges analytically from the node box, so
		// this invariant is load-bearing — a widget that sized to content would
		// silently detach its edges. Fail here instead.
		const epics = [
			makeEpic("e1", 0, {
				description: "x".repeat(300),
				features: [
					makeFeature("f1", "e1", 0, { description: "y".repeat(200) }),
					makeFeature("f2", "e1", 1),
				],
			}),
			makeEpic("e2", 1, { features: [makeFeature("f3", "e2", 0)] }),
		];
		const { nodes } = getLayoutedElements(makeNodes(epics), [], epics);

		expect(nodes).toHaveLength(5);
		for (const node of nodes) {
			expect(typeof node.width).toBe("number");
			expect(typeof node.height).toBe("number");
			expect(node.width).toBe(NODE_WIDTH);
			expect(node.height).toBeGreaterThan(0);
		}
	});

	it("grows epic height with description length and clamps at the maximum", () => {
		const short = getLayoutedElements(
			...argsFor([makeEpic("e1", 0, { description: "x".repeat(160) })]),
		);
		// ceil(160/80) = 2 lines * 16px = 32px of description
		expect(short.nodes[0].height).toBe(BASE_EPIC_HEIGHT + 32);

		const huge = getLayoutedElements(
			...argsFor([makeEpic("e1", 0, { description: "x".repeat(4000) })]),
		);
		expect(huge.nodes[0].height).toBe(MAX_EPIC_HEIGHT);
	});

	it("grows feature height with description length and clamps at the maximum", () => {
		const epics = [
			makeEpic("e1", 0, {
				features: [
					makeFeature("f1", "e1", 0, { description: "y".repeat(140) }),
					makeFeature("f2", "e1", 1, { description: "y".repeat(4000) }),
				],
			}),
		];
		const nodes = byId(getLayoutedElements(...argsFor(epics)).nodes);

		// ceil(140/70) = 2 lines * 16px
		expect(nodes.get("f1")?.height).toBe(BASE_FEATURE_HEIGHT + 32);
		expect(nodes.get("f2")?.height).toBe(MAX_FEATURE_HEIGHT);
	});

	it("columns features to the right of their epic", () => {
		const epics = [
			makeEpic("e1", 0, {
				features: [makeFeature("f1", "e1", 0), makeFeature("f2", "e1", 1)],
			}),
		];
		const nodes = byId(getLayoutedElements(...argsFor(epics)).nodes);

		expect(nodes.get("e1")?.position.x).toBe(EPIC_X);
		expect(nodes.get("f1")?.position.x).toBe(FEATURE_X);
		expect(nodes.get("f2")?.position.x).toBe(FEATURE_X);
	});

	it("centres an epic vertically against its feature stack", () => {
		const epics = [
			makeEpic("e1", 0, {
				features: [
					makeFeature("f1", "e1", 0),
					makeFeature("f2", "e1", 1),
					makeFeature("f3", "e1", 2),
				],
			}),
		];
		const nodes = byId(getLayoutedElements(...argsFor(epics)).nodes);
		const epic = nodes.get("e1");
		const first = nodes.get("f1");
		const last = nodes.get("f3");
		if (!epic || !first || !last) throw new Error("missing nodes");

		const epicCentre = epic.position.y + (epic.height ?? 0) / 2;
		const stackCentre =
			(first.position.y + last.position.y + (last.height ?? 0)) / 2;
		expect(epicCentre).toBeCloseTo(stackCentre, 5);
	});

	it("orders epics by their position field, not array order", () => {
		const epics = [makeEpic("late", 30), makeEpic("early", 10)];
		const nodes = byId(getLayoutedElements(...argsFor(epics)).nodes);

		const early = nodes.get("early");
		const late = nodes.get("late");
		if (!early || !late) throw new Error("missing nodes");
		expect(early.position.y).toBeLessThan(late.position.y);
		expect(early.position.y).toBe(FIRST_Y);
	});

	it("separates epic groups by at least the minimum gap", () => {
		const epics = [makeEpic("e1", 0), makeEpic("e2", 1)];
		const nodes = byId(getLayoutedElements(...argsFor(epics)).nodes);

		const first = nodes.get("e1");
		const second = nodes.get("e2");
		if (!first || !second) throw new Error("missing nodes");
		// groupHeight 220 -> gap = max(120, round(220 * 0.3) = 66) = 120
		expect(second.position.y - first.position.y).toBe(BASE_EPIC_HEIGHT + 120);
	});

	it("scales the group gap with group height once it exceeds the minimum", () => {
		// A tall feature stack pushes groupHeight * 0.3 above the 120px floor.
		const epics = [
			makeEpic("e1", 0, {
				features: Array.from({ length: 6 }, (_, i) =>
					makeFeature(`f${i}`, "e1", i),
				),
			}),
			makeEpic("e2", 1),
		];
		const nodes = byId(getLayoutedElements(...argsFor(epics)).nodes);

		const stackTop = nodes.get("f0");
		const second = nodes.get("e2");
		if (!stackTop || !second) throw new Error("missing nodes");
		// 6 features -> groupHeight well over 400, so the gap is height-scaled.
		const groupHeight = 6 * BASE_FEATURE_HEIGHT + 5 * 93;
		expect(second.position.y).toBeGreaterThan(
			stackTop.position.y + groupHeight,
		);
	});

	it("appends features whose epic is missing to the bottom as orphans", () => {
		// This branch is unreachable through the UI and easy to break silently.
		const epics = [makeEpic("e1", 0)];
		const orphanA = makeFeature("orphan-a", "gone", 0);
		const orphanB = makeFeature("orphan-b", "gone", 1);
		const nodes = byId(
			getLayoutedElements(makeNodes(epics, [orphanA, orphanB]), [], epics)
				.nodes,
		);

		const a = nodes.get("orphan-a");
		const b = nodes.get("orphan-b");
		if (!a || !b) throw new Error("orphan features were dropped");

		expect(a.position.x).toBe(FEATURE_X);
		expect(a.height).toBe(BASE_FEATURE_HEIGHT);
		// Orphans step down by BASE_FEATURE_SPACING (80), not the adaptive spacing.
		expect(b.position.y - a.position.y).toBe(80);
		// ...and they sit below the last real group.
		const epic = nodes.get("e1");
		expect(a.position.y).toBeGreaterThan(epic?.position.y ?? 0);
	});

	it("ignores features that have no corresponding node", () => {
		// epic.features lists f2, but no featureWidget node exists for it.
		const epics = [
			makeEpic("e1", 0, {
				features: [makeFeature("f1", "e1", 0), makeFeature("f2", "e1", 1)],
			}),
		];
		const allNodes = makeNodes(epics).filter((node) => node.id !== "f2");
		const { nodes } = getLayoutedElements(allNodes, [], epics);

		expect(byId(nodes).has("f2")).toBe(false);
		expect(byId(nodes).has("f1")).toBe(true);
	});
});

/** Convenience: build the (nodes, edges, epics) triple for a set of epics. */
function argsFor(
	epics: ReturnType<typeof makeEpic>[],
): [ReturnType<typeof makeNodes>, [], ReturnType<typeof makeEpic>[]] {
	return [makeNodes(epics), [], epics];
}
