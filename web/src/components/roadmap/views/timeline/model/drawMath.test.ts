import { describe, expect, it } from "vitest";
import { COL_WIDTH } from "../../milestones/model/constants";
import type { Granularity } from "../../milestones/model/types";
import {
	addDays,
	dateFromTimelinePx,
	floorToUnit,
	getColumns,
	getTimelineRange,
	toISODateString,
} from "../../milestones/model/utils";

const GRANULARITIES: Granularity[] = ["day", "week", "month", "year"];

describe("draw gesture date math", () => {
	it("produces a parseable ISO date for any pointer position", () => {
		const rangeStart = new Date(2026, 0, 1);

		for (const granularity of GRANULARITIES) {
			const cw = COL_WIDTH[granularity];
			// Includes negative px: the pointer can sit left of the grid origin
			// because the task column is sticky over it.
			for (const px of [-4000, -321, -1, 0, 1, 250, 5000, 123456]) {
				const date = floorToUnit(
					dateFromTimelinePx(px, rangeStart, granularity, cw),
					"day",
				);
				const iso = toISODateString(date);

				expect(
					Number.isNaN(date.getTime()),
					`${granularity} @ ${px}px -> Invalid Date`,
				).toBe(false);
				expect(iso, `${granularity} @ ${px}px -> ${iso}`).toMatch(
					/^\d{4}-\d{2}-\d{2}$/,
				);
				expect(Number.isNaN(new Date(iso).getTime())).toBe(false);
			}
		}
	});

	it("keeps the timeline scale usable after a single feature gets dates", () => {
		// The exact shape the draw gesture commits: one feature, one day range.
		const drawn = floorToUnit(new Date(), "day");
		const epics = [
			{
				id: "e1",
				features: [
					{
						id: "f1",
						start_date: toISODateString(drawn),
						end_date: toISODateString(addDays(drawn, 3)),
					},
				],
			},
		] as never;

		for (const granularity of GRANULARITIES) {
			const range = getTimelineRange(epics, granularity);
			const columns = getColumns(range.start, range.end, granularity);

			expect(Number.isNaN(range.start.getTime())).toBe(false);
			expect(Number.isNaN(range.end.getTime())).toBe(false);
			expect(
				columns.length,
				`${granularity} produced an empty column set`,
			).toBeGreaterThan(0);
		}
	});

	it("collapses to zero columns when a feature date is unparseable", () => {
		// Guards the failure mode: one bad date takes every bar down with it,
		// because the shared scale is what breaks, not the individual bar.
		const epics = [
			{
				id: "e1",
				features: [{ id: "f1", start_date: "NaN-NaN-NaN", end_date: "oops" }],
			},
		] as never;

		const range = getTimelineRange(epics, "week");
		expect(Number.isNaN(range.start.getTime())).toBe(true);
		expect(getColumns(range.start, range.end, "week")).toHaveLength(0);
	});
});
