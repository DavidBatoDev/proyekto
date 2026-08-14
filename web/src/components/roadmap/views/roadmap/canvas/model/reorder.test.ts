/**
 * Characterization tests for `computeReorderedEpics` — the function that turns a
 * drop position into new `position` integers for epics and features. It had ZERO
 * coverage, it is what every canvas drag ultimately persists, and both the local
 * drag and the remote-collaborator mirror run it, so a regression here corrupts
 * ordering for everyone in the room.
 *
 * Two behaviours are load-bearing and specifically pinned below:
 *   1. insertion uses feature CENTRE-Y, not top-Y (nodes are 150-300px tall);
 *   2. non-dragged features stay anchored to their original epic, even when they
 *      sit nearer another epic's midpoint.
 */
import type { Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { byId, makeEpic, makeFeature } from "./__fixtures__/canvasGraph";
import { computeReorderedEpics } from "./reorder";

type Box = { id: string; y: number; height: number };

const epicNode = ({ id, y, height }: Box): Node =>
	({
		id,
		type: "epicWidget",
		position: { x: 100, y },
		height,
		data: {},
	}) as unknown as Node;

const featureNode = ({ id, y, height }: Box): Node =>
	({
		id,
		type: "featureWidget",
		position: { x: 750, y },
		height,
		data: {},
	}) as unknown as Node;

describe("computeReorderedEpics — epic drag", () => {
	it("orders epics by their current Y and renumbers position by index * 1000", () => {
		const epics = [makeEpic("a", 0), makeEpic("b", 1000), makeEpic("c", 2000)];
		const nodes = [
			epicNode({ id: "a", y: 900, height: 220 }),
			epicNode({ id: "b", y: 100, height: 220 }),
			epicNode({ id: "c", y: 500, height: 220 }),
		];

		const result = computeReorderedEpics(
			nodes,
			{ nodeId: "a", type: "epic" },
			epics,
		);

		expect(result.map((epic) => epic.id)).toEqual(["b", "c", "a"]);
		expect(result.map((epic) => epic.position)).toEqual([0, 1000, 2000]);
	});

	it("drops epics that have no node in the current graph", () => {
		const epics = [makeEpic("a", 0), makeEpic("ghost", 1000)];
		const nodes = [epicNode({ id: "a", y: 100, height: 220 })];

		const result = computeReorderedEpics(
			nodes,
			{ nodeId: "a", type: "epic" },
			epics,
		);

		expect(result.map((epic) => epic.id)).toEqual(["a"]);
	});
});

describe("computeReorderedEpics — feature drag", () => {
	it("inserts by centre-Y, not top-Y", () => {
		// f1 is very tall (600px) starting at y=0, so its TOP is above the dragged
		// feature but its CENTRE is well below it. Top-Y logic would append the
		// dragged feature after f1; centre-Y logic inserts before it.
		const f1 = makeFeature("f1", "e1", 0);
		const dragged = makeFeature("dragged", "e1", 1000);
		const epics = [makeEpic("e1", 0, { features: [f1, dragged] })];

		const nodes = [
			epicNode({ id: "e1", y: 0, height: 220 }),
			featureNode({ id: "f1", y: 0, height: 600 }),
			featureNode({ id: "dragged", y: 100, height: 150 }), // centre 175 < 300
		];

		const result = computeReorderedEpics(
			nodes,
			{ nodeId: "dragged", type: "feature", sourceEpicId: "e1" },
			epics,
		);

		expect(result[0].features?.map((f) => f.id)).toEqual(["dragged", "f1"]);
		expect(result[0].features?.map((f) => f.position)).toEqual([0, 1000]);
	});

	it("appends to the end when the dragged feature is below every centre", () => {
		const epics = [
			makeEpic("e1", 0, {
				features: [
					makeFeature("f1", "e1", 0),
					makeFeature("f2", "e1", 1000),
					makeFeature("dragged", "e1", 2000),
				],
			}),
		];
		const nodes = [
			epicNode({ id: "e1", y: 0, height: 220 }),
			featureNode({ id: "f1", y: 0, height: 150 }),
			featureNode({ id: "f2", y: 200, height: 150 }),
			featureNode({ id: "dragged", y: 900, height: 150 }),
		];

		const result = computeReorderedEpics(
			nodes,
			{ nodeId: "dragged", type: "feature", sourceEpicId: "e1" },
			epics,
		);

		expect(result[0].features?.map((f) => f.id)).toEqual([
			"f1",
			"f2",
			"dragged",
		]);
	});

	it("moves the dragged feature to the epic whose centre is closest", () => {
		const dragged = makeFeature("dragged", "e2", 0);
		const epics = [
			makeEpic("e1", 0, { features: [makeFeature("f1", "e1", 0)] }),
			makeEpic("e2", 1000, { features: [dragged] }),
		];
		const nodes = [
			epicNode({ id: "e1", y: 0, height: 220 }), // centre 110
			epicNode({ id: "e2", y: 1000, height: 220 }), // centre 1110
			featureNode({ id: "f1", y: 200, height: 150 }), // centre 275
			featureNode({ id: "dragged", y: 0, height: 150 }), // centre 75 -> e1
		];

		const result = computeReorderedEpics(
			nodes,
			{ nodeId: "dragged", type: "feature", sourceEpicId: "e2" },
			epics,
		);

		const epicsById = byId(result);
		expect(epicsById.get("e1")?.features?.map((f) => f.id)).toEqual([
			"dragged",
			"f1",
		]);
		expect(epicsById.get("e2")?.features).toEqual([]);
		// epic_id is rewritten on the target epic's features.
		expect(
			epicsById.get("e1")?.features?.every((f) => f.epic_id === "e1"),
		).toBe(true);
	});

	it("keeps non-dragged features anchored to their original epic", () => {
		// `stray` belongs to e1 but is rendered right on top of e2's midpoint.
		// Reassigning by Y proximity would steal it into e2 — the exact bug the
		// implementation comment warns about.
		const stray = makeFeature("stray", "e1", 1000);
		const dragged = makeFeature("dragged", "e2", 0);
		const epics = [
			makeEpic("e1", 0, { features: [makeFeature("f1", "e1", 0), stray] }),
			makeEpic("e2", 1000, { features: [dragged] }),
		];
		const nodes = [
			epicNode({ id: "e1", y: 0, height: 220 }), // centre 110
			epicNode({ id: "e2", y: 1000, height: 220 }), // centre 1110
			featureNode({ id: "f1", y: 0, height: 150 }),
			featureNode({ id: "stray", y: 1035, height: 150 }), // centre 1110 == e2
			featureNode({ id: "dragged", y: 0, height: 150 }), // centre 75 -> e1
		];

		const result = computeReorderedEpics(
			nodes,
			{ nodeId: "dragged", type: "feature", sourceEpicId: "e2" },
			epics,
		);

		const epicsById = byId(result);
		expect(epicsById.get("e1")?.features?.map((f) => f.id)).toContain("stray");
		expect(epicsById.get("e2")?.features?.map((f) => f.id)).not.toContain(
			"stray",
		);
	});

	it("appends rather than prepends when two centres tie exactly", () => {
		// The comparison is a strict `<`, so an exact centre tie loses and the
		// dragged feature lands after the incumbent. Pinned because it is the kind
		// of boundary a reimplementation flips without noticing.
		const epics = [
			makeEpic("e1", 0, {
				features: [
					makeFeature("f1", "e1", 0),
					makeFeature("dragged", "e1", 1000),
				],
			}),
		];
		const nodes = [
			epicNode({ id: "e1", y: 0, height: 220 }),
			featureNode({ id: "f1", y: 0, height: 150 }), // centre 75
			featureNode({ id: "dragged", y: 0, height: 150 }), // centre 75
		];

		const result = computeReorderedEpics(
			nodes,
			{ nodeId: "dragged", type: "feature", sourceEpicId: "e1" },
			epics,
		);

		expect(result[0].features?.map((f) => f.id)).toEqual(["f1", "dragged"]);
	});

	it("returns the source epics untouched when the dragged node is absent", () => {
		const epics = [
			makeEpic("e1", 0, { features: [makeFeature("f1", "e1", 0)] }),
		];
		const nodes = [
			epicNode({ id: "e1", y: 0, height: 220 }),
			featureNode({ id: "f1", y: 0, height: 150 }),
		];

		const result = computeReorderedEpics(
			nodes,
			{ nodeId: "not-rendered", type: "feature", sourceEpicId: "e1" },
			epics,
		);

		expect(result).toBe(epics);
	});

	it("derives epic order from Y during a feature drag too", () => {
		// An epic reorder earlier in the same gesture must survive a feature drag.
		const epics = [
			makeEpic("e1", 0, { features: [makeFeature("dragged", "e1", 0)] }),
			makeEpic("e2", 1000),
		];
		const nodes = [
			epicNode({ id: "e1", y: 1000, height: 220 }),
			epicNode({ id: "e2", y: 0, height: 220 }),
			featureNode({ id: "dragged", y: 1000, height: 150 }),
		];

		const result = computeReorderedEpics(
			nodes,
			{ nodeId: "dragged", type: "feature", sourceEpicId: "e1" },
			epics,
		);

		expect(result.map((epic) => epic.id)).toEqual(["e2", "e1"]);
		expect(result.map((epic) => epic.position)).toEqual([0, 1000]);
	});

	it("falls back to default heights when nodes carry none", () => {
		const epics = [
			makeEpic("e1", 0, {
				features: [
					makeFeature("f1", "e1", 0),
					makeFeature("dragged", "e1", 1000),
				],
			}),
		];
		const nodes = [
			{
				id: "e1",
				type: "epicWidget",
				position: { x: 100, y: 0 },
				data: {},
			} as unknown as Node,
			{
				id: "f1",
				type: "featureWidget",
				position: { x: 750, y: 400 },
				data: {},
			} as unknown as Node,
			{
				id: "dragged",
				type: "featureWidget",
				position: { x: 750, y: 0 },
				data: {},
			} as unknown as Node,
		];

		const result = computeReorderedEpics(
			nodes,
			{ nodeId: "dragged", type: "feature", sourceEpicId: "e1" },
			epics,
		);

		// dragged centre 75 (0 + 150/2) < f1 centre 475 -> inserted first.
		expect(result[0].features?.map((f) => f.id)).toEqual(["dragged", "f1"]);
	});
});
