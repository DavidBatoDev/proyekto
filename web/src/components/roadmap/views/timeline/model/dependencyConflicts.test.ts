import { describe, expect, it } from "vitest";
import type { FeatureDependency } from "@/types/roadmap";
import {
	detectConflicts,
	earliestStartFor,
	indexConflicts,
	proposeReschedule,
	type ScheduledFeature,
} from "./dependencyConflicts";

const feature = (
	id: string,
	start?: string,
	end?: string,
): ScheduledFeature => ({ id, title: id, start_date: start, end_date: end });

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

const index = (features: ScheduledFeature[]) =>
	new Map(features.map((f) => [f.id, f]));

describe("earliestStartFor", () => {
	it("puts an FS successor the day after the predecessor ends", () => {
		// End dates are inclusive, so 'the day after' is the first legal start.
		expect(
			earliestStartFor("FS", feature("a", "2026-08-01", "2026-08-10"), 0),
		).toBe("2026-08-11");
	});

	it("applies positive and negative lag", () => {
		const a = feature("a", "2026-08-01", "2026-08-10");
		expect(earliestStartFor("FS", a, 3)).toBe("2026-08-14");
		expect(earliestStartFor("FS", a, -2)).toBe("2026-08-09");
	});

	it("aligns an SS successor with the predecessor's start", () => {
		expect(
			earliestStartFor("SS", feature("a", "2026-08-01", "2026-08-10"), 0),
		).toBe("2026-08-01");
	});
});

describe("detectConflicts", () => {
	it("does NOT flag a successor starting the day after (the boundary)", () => {
		const features = index([
			feature("a", "2026-08-01", "2026-08-10"),
			feature("b", "2026-08-11", "2026-08-20"),
		]);
		expect(detectConflicts([dep("d1", "a", "b")], features)).toHaveLength(0);
	});

	it("flags a successor starting on the predecessor's last day", () => {
		const features = index([
			feature("a", "2026-08-01", "2026-08-10"),
			feature("b", "2026-08-10", "2026-08-20"),
		]);
		const [conflict] = detectConflicts([dep("d1", "a", "b")], features);

		expect(conflict.earliestStart).toBe("2026-08-11");
		expect(conflict.currentStart).toBe("2026-08-10");
		expect(conflict.slipDays).toBe(1);
	});

	it("reports the full slip when the successor starts well before", () => {
		const features = index([
			feature("a", "2026-08-01", "2026-08-20"),
			feature("b", "2026-08-05", "2026-08-15"),
		]);
		const [conflict] = detectConflicts([dep("d1", "a", "b")], features);
		expect(conflict.slipDays).toBe(16); // 2026-08-05 -> 2026-08-21
	});

	it("skips edges with an unscheduled endpoint rather than flagging them", () => {
		const features = index([
			feature("a", "2026-08-01", "2026-08-10"),
			feature("b"),
		]);
		expect(detectConflicts([dep("d1", "a", "b")], features)).toHaveLength(0);
	});

	it("skips edges whose endpoints are not in the map at all", () => {
		expect(detectConflicts([dep("d1", "a", "gone")], index([]))).toHaveLength(
			0,
		);
	});

	it("respects lag when deciding a conflict", () => {
		const features = index([
			feature("a", "2026-08-01", "2026-08-10"),
			feature("b", "2026-08-11", "2026-08-20"),
		]);
		// Legal at lag 0, but 3 days of lag pushes the earliest start out.
		const conflicts = detectConflicts(
			[dep("d1", "a", "b", { lag_days: 3 })],
			features,
		);
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0].earliestStart).toBe("2026-08-14");
	});
});

describe("proposeReschedule", () => {
	it("preserves the duration rather than only moving the start", () => {
		const successor = feature("b", "2026-08-10", "2026-08-20"); // 11 days
		const features = index([
			feature("a", "2026-08-01", "2026-08-10"),
			successor,
		]);
		const [conflict] = detectConflicts([dep("d1", "a", "b")], features);

		expect(proposeReschedule(conflict, successor)).toEqual({
			start_date: "2026-08-11",
			end_date: "2026-08-21",
		});
	});

	it("survives a month boundary", () => {
		const successor = feature("b", "2026-08-30", "2026-08-31");
		const features = index([
			feature("a", "2026-08-25", "2026-09-02"),
			successor,
		]);
		const [conflict] = detectConflicts([dep("d1", "a", "b")], features);

		expect(proposeReschedule(conflict, successor)).toEqual({
			start_date: "2026-09-03",
			end_date: "2026-09-04",
		});
	});

	it("returns null for an unscheduled successor", () => {
		const conflict = {
			dependencyId: "d",
			blockingFeatureId: "a",
			blockedFeatureId: "b",
			type: "FS" as const,
			earliestStart: "2026-08-11",
			currentStart: "2026-08-10",
			slipDays: 1,
		};
		expect(proposeReschedule(conflict, feature("b"))).toBeNull();
	});
});

describe("indexConflicts", () => {
	it("keeps the worst slip per successor, since fixing it satisfies the rest", () => {
		const features = index([
			feature("a", "2026-08-01", "2026-08-10"),
			feature("b", "2026-08-01", "2026-08-05"),
			feature("c", "2026-08-02", "2026-08-20"),
		]);
		const conflicts = detectConflicts(
			[dep("d1", "a", "c"), dep("d2", "b", "c")],
			features,
		);
		const { bySuccessorId, byDependencyId } = indexConflicts(conflicts);

		expect(byDependencyId.size).toBe(2);
		expect(bySuccessorId.size).toBe(1);
		expect(bySuccessorId.get("c")?.earliestStart).toBe("2026-08-11");
	});
});
