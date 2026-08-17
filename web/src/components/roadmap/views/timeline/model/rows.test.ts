import { describe, expect, it } from "vitest";
import type { RoadmapEpic, RoadmapFeature } from "@/types/roadmap";
import { buildTimelineRows, getRowDates } from "./rows";

const feature = (id: string, extra: Partial<RoadmapFeature> = {}) =>
	({
		id,
		roadmap_id: "r1",
		epic_id: "e1",
		title: `Feature ${id}`,
		position: 0,
		is_deliverable: false,
		status: "not_started",
		created_at: "",
		updated_at: "",
		...extra,
	}) as RoadmapFeature;

const epic = (id: string, features: RoadmapFeature[] = []) =>
	({
		id,
		roadmap_id: "r1",
		title: `Epic ${id}`,
		priority: "medium",
		status: "planned",
		position: 0,
		created_at: "",
		updated_at: "",
		features,
	}) as RoadmapEpic;

describe("buildTimelineRows", () => {
	it("flattens epics with their features in order", () => {
		const rows = buildTimelineRows(
			[epic("e1", [feature("f1"), feature("f2")]), epic("e2")],
			new Set(),
		);

		expect(rows.map((row) => row.rowKey)).toEqual([
			"epic:e1",
			"feature:f1",
			"feature:f2",
			"epic:e2",
		]);
	});

	it("omits the features of a collapsed epic so index * ROW_H stays exact", () => {
		const rows = buildTimelineRows(
			[epic("e1", [feature("f1"), feature("f2")]), epic("e2")],
			new Set(["e1"]),
		);

		expect(rows.map((row) => row.rowKey)).toEqual(["epic:e1", "epic:e2"]);
		expect(rows[0].isExpanded).toBe(false);
		expect(rows[0].hasChildren).toBe(true);
	});

	it("reports dates only when both ends are set", () => {
		const [withDates, withoutDates] = buildTimelineRows(
			[
				epic("e1", [
					feature("f1", { start_date: "2026-01-01", end_date: "2026-01-05" }),
					feature("f2", { start_date: "2026-01-01" }),
				]),
			],
			new Set(),
		).slice(1);

		expect(getRowDates(withDates)).toEqual({
			startDate: "2026-01-01",
			endDate: "2026-01-05",
		});
		expect(getRowDates(withoutDates)).toBeNull();
	});
});
