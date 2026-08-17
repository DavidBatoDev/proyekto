import { describe, expect, it } from "vitest";
import type { FeatureDependency } from "@/types/roadmap";
import {
	buildAdjacency,
	hasEdge,
	rejectDrop,
	wouldCreateCycle,
} from "./dependencyGraph";

const dep = (blocking: string, blocked: string): FeatureDependency =>
	({
		id: `${blocking}->${blocked}`,
		roadmap_id: "rm",
		blocking_feature_id: blocking,
		blocked_feature_id: blocked,
		dependency_type: "FS",
		lag_days: 0,
		created_at: "",
	}) as FeatureDependency;

describe("wouldCreateCycle", () => {
	it("rejects a self link", () => {
		expect(wouldCreateCycle(buildAdjacency([]), "a", "a")).toBe(true);
	});

	it("rejects the direct reverse of an existing edge", () => {
		expect(wouldCreateCycle(buildAdjacency([dep("a", "b")]), "b", "a")).toBe(
			true,
		);
	});

	it("rejects a transitive loop A->B->C->A", () => {
		const adjacency = buildAdjacency([dep("a", "b"), dep("b", "c")]);
		expect(wouldCreateCycle(adjacency, "c", "a")).toBe(true);
	});

	it("allows a diamond, which is not a cycle", () => {
		// a->b, a->c, b->d, then c->d closes a diamond, not a loop.
		const adjacency = buildAdjacency([
			dep("a", "b"),
			dep("a", "c"),
			dep("b", "d"),
		]);
		expect(wouldCreateCycle(adjacency, "c", "d")).toBe(false);
	});

	it("allows an edge between disconnected components", () => {
		const adjacency = buildAdjacency([dep("a", "b"), dep("x", "y")]);
		expect(wouldCreateCycle(adjacency, "b", "x")).toBe(false);
	});

	it("terminates when the data already contains a cycle", () => {
		// Should not hang: the visited set bounds the walk.
		const adjacency = buildAdjacency([dep("a", "b"), dep("b", "a")]);
		expect(wouldCreateCycle(adjacency, "b", "c")).toBe(false);
	});
});

describe("hasEdge", () => {
	it("is direction-sensitive", () => {
		const adjacency = buildAdjacency([dep("a", "b")]);
		expect(hasEdge(adjacency, "a", "b")).toBe(true);
		expect(hasEdge(adjacency, "b", "a")).toBe(false);
	});
});

describe("rejectDrop", () => {
	const adjacency = buildAdjacency([dep("a", "b")]);

	it("names each reason so the drag can explain itself", () => {
		expect(rejectDrop(adjacency, "a", "a")).toBe("self");
		expect(rejectDrop(adjacency, "a", "b")).toBe("duplicate");
		expect(rejectDrop(adjacency, "b", "a")).toBe("cycle");
		expect(rejectDrop(adjacency, "a", null)).toBe("not-a-feature");
	});

	it("returns null for a legal drop", () => {
		expect(rejectDrop(adjacency, "b", "c")).toBeNull();
	});
});
