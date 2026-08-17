import { describe, expect, it } from "vitest";
import type { FeatureDependency } from "@/types/roadmap";
import type { BarGeometry } from "./barGeometry";
import {
	buildDependencyEdges,
	resolveEndpoint,
	rowBarCenterY,
} from "./dependencyGeometry";
import { BAR_H, ROW_H } from "./rows";

const dep = (
	id: string,
	blocking: string,
	blocked: string,
	extra: Partial<FeatureDependency> = {},
): FeatureDependency =>
	({
		id,
		roadmap_id: "rm",
		blocking_feature_id: blocking,
		blocked_feature_id: blocked,
		dependency_type: "FS",
		lag_days: 0,
		created_at: "",
		...extra,
	}) as FeatureDependency;

const geo = (left: number, right: number): BarGeometry => ({ left, right });

describe("rowBarCenterY", () => {
	it("matches the centre TimelineGrid computes, for both bar heights", () => {
		// TimelineGrid: top = rowIndex*ROW_H + (ROW_H - H)/2, height = H.
		for (const height of [BAR_H, BAR_H - 8]) {
			const rowIndex = 3;
			const top = rowIndex * ROW_H + (ROW_H - height) / 2;
			expect(rowBarCenterY(rowIndex)).toBe(top + height / 2);
		}
	});
});

describe("resolveEndpoint", () => {
	const rowIndexByRowKey = new Map([
		["epic:e1", 0],
		["feature:f1", 1],
	]);
	const epicIdByFeatureId = new Map([
		["f1", "e1"],
		["f2", "e1"],
		["f3", "e2"],
	]);
	const geometryByRowKey = new Map([
		["epic:e1", geo(0, 100)],
		["feature:f1", geo(10, 50)],
	]);

	it("anchors to the feature's own row when visible", () => {
		const result = resolveEndpoint(
			"f1",
			rowIndexByRowKey,
			epicIdByFeatureId,
			geometryByRowKey,
		);
		expect(result).toEqual({
			rowIndex: 1,
			geometry: geo(10, 50),
			isRollup: false,
		});
	});

	it("rolls up to the epic bar when the feature's row is collapsed away", () => {
		const result = resolveEndpoint(
			"f2",
			rowIndexByRowKey,
			epicIdByFeatureId,
			geometryByRowKey,
		);
		expect(result).toEqual({
			rowIndex: 0,
			geometry: geo(0, 100),
			isRollup: true,
		});
	});

	it("returns null when neither the feature nor its epic is present", () => {
		expect(
			resolveEndpoint(
				"f3",
				rowIndexByRowKey,
				epicIdByFeatureId,
				geometryByRowKey,
			),
		).toBeNull();
	});

	it("returns null when the anchor row has no bar", () => {
		expect(
			resolveEndpoint("f1", rowIndexByRowKey, epicIdByFeatureId, new Map()),
		).toBeNull();
	});
});

describe("buildDependencyEdges", () => {
	const base = {
		rows: [],
		rowIndexByRowKey: new Map([
			["feature:f1", 0],
			["feature:f2", 1],
		]),
		epicIdByFeatureId: new Map([
			["f1", "e1"],
			["f2", "e1"],
		]),
		geometryByRowKey: new Map([
			["feature:f1", geo(0, 100)],
			["feature:f2", geo(200, 300)],
		]),
		conflictDependencyIds: new Set<string>(),
	};

	it("starts at the predecessor's right edge for FS", () => {
		const { edges } = buildDependencyEdges({
			...base,
			dependencies: [dep("d1", "f1", "f2")],
		});

		expect(edges).toHaveLength(1);
		// Path begins exactly on the bar's finish edge, at the row centre.
		expect(edges[0].path.startsWith(`M100,${rowBarCenterY(0)}`)).toBe(true);
	});

	it("anchors FF to the successor's right edge instead of its left", () => {
		const { edges } = buildDependencyEdges({
			...base,
			dependencies: [dep("d1", "f1", "f2", { dependency_type: "FF" })],
		});
		// f2 spans 200..300, so an FF edge must terminate near 300, not 200.
		const finalX = Number(edges[0].path.split("L").pop()?.split(",")[0]);
		expect(finalX).toBeGreaterThan(290);
	});

	it("marks conflicting edges", () => {
		const { edges } = buildDependencyEdges({
			...base,
			dependencies: [dep("d1", "f1", "f2")],
			conflictDependencyIds: new Set(["d1"]),
		});
		expect(edges[0].isConflict).toBe(true);
	});

	it("counts, rather than draws, an edge with a missing endpoint", () => {
		const { edges, hiddenCount } = buildDependencyEdges({
			...base,
			dependencies: [dep("d1", "f1", "gone")],
		});
		expect(edges).toHaveLength(0);
		expect(hiddenCount).toBe(1);
	});

	it("does not draw a self-loop when both endpoints roll up to one epic", () => {
		const { edges, hiddenCount } = buildDependencyEdges({
			...base,
			rowIndexByRowKey: new Map([["epic:e1", 0]]),
			geometryByRowKey: new Map([["epic:e1", geo(0, 100)]]),
			dependencies: [dep("d1", "f1", "f2")],
		});
		expect(edges).toHaveLength(0);
		expect(hiddenCount).toBe(1);
	});

	it("never culls by viewport — every resolvable edge is returned", () => {
		// The window is irrelevant to this function by design; edges far outside
		// it must still be built. Regression guard for the FlowEdges flicker lesson.
		const rowIndexByRowKey = new Map<string, number>();
		const geometryByRowKey = new Map<string, BarGeometry>();
		const dependencies: FeatureDependency[] = [];
		for (let i = 0; i < 60; i += 1) {
			rowIndexByRowKey.set(`feature:f${i}`, i);
			geometryByRowKey.set(`feature:f${i}`, geo(i * 10, i * 10 + 50));
			if (i > 0) dependencies.push(dep(`d${i}`, `f${i - 1}`, `f${i}`));
		}

		const { edges, hiddenCount } = buildDependencyEdges({
			...base,
			rowIndexByRowKey,
			geometryByRowKey,
			epicIdByFeatureId: new Map(),
			dependencies,
		});

		expect(edges).toHaveLength(59);
		expect(hiddenCount).toBe(0);
	});
});
