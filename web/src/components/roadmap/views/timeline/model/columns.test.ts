import { describe, expect, it } from "vitest";
import { COL_WIDTH } from "../../milestones/model/constants";
import {
	buildColumns,
	buildGroups,
	columnLabel,
	findColumnIndex,
	groupLabel,
} from "./columns";

describe("column labels", () => {
	it("labels each scale with its own unit", () => {
		const date = new Date(2026, 7, 17); // Mon 17 Aug 2026, ISO week 34
		expect(columnLabel(date, "day")).toBe("17");
		expect(columnLabel(date, "week")).toBe("W34");
		expect(columnLabel(date, "month")).toBe("Aug");
		expect(columnLabel(date, "year")).toBe("2026");
	});

	it("groups each scale by the next coarser unit", () => {
		const date = new Date(2026, 7, 17);
		expect(groupLabel(date, "day")).toBe("August 2026");
		expect(groupLabel(date, "week")).toBe("August 2026");
		expect(groupLabel(date, "month")).toBe("2026");
		expect(groupLabel(date, "year")).toBeNull();
	});

	it("labels the band by the month the date itself is in", () => {
		// Mon 29 Jun 2026 opens a week that runs into July, but the date is June.
		// The straddle is expressed by where the band is cut, not by relabelling
		// the whole week — see the buildGroups tests below.
		expect(groupLabel(new Date(2026, 5, 29), "week")).toBe("June 2026");
	});
});

describe("buildColumns", () => {
	it("marks weekends on the day scale only", () => {
		const columns = buildColumns(
			new Date(2026, 7, 14), // Friday
			new Date(2026, 7, 17),
			"day",
		);
		expect(columns.map((c) => c.isWeekend)).toEqual([false, true, true, false]);
		expect(columns[0].subLabel).toBeTruthy();
	});

	it("does not mark weekends on coarser scales", () => {
		const columns = buildColumns(
			new Date(2026, 0, 1),
			new Date(2026, 5, 1),
			"month",
		);
		expect(columns.every((c) => !c.isWeekend)).toBe(true);
		expect(columns[0].subLabel).toBeUndefined();
	});
});

describe("buildGroups", () => {
	const DAY = COL_WIDTH.day;
	const WEEK = COL_WIDTH.week;

	it("splits months into contiguous bands with correct spans", () => {
		const columns = buildColumns(
			new Date(2026, 0, 1),
			new Date(2026, 2, 31),
			"day",
		);
		const groups = buildGroups(columns, "day", DAY);

		expect(groups.map((g) => g.label)).toEqual([
			"January 2026",
			"February 2026",
			"March 2026",
		]);
		expect(groups[0].left).toBe(0);
		expect(groups[0].width).toBe(31 * DAY);
		expect(groups[1].left).toBe(31 * DAY);
		expect(groups[1].width).toBe(28 * DAY);
		expect(groups.reduce((sum, g) => sum + g.width, 0)).toBe(
			columns.length * DAY,
		);
	});

	it("keeps every day-scale boundary on a column edge", () => {
		const columns = buildColumns(
			new Date(2026, 0, 1),
			new Date(2026, 2, 31),
			"day",
		);
		for (const group of buildGroups(columns, "day", DAY)) {
			expect(group.left % DAY).toBe(0);
			expect(group.width % DAY).toBe(0);
		}
	});

	it("cuts the band inside the week that straddles a month", () => {
		// The reported bug. Mon 1 Jun 2026 is a Monday, so the columns start
		// there; W27 is column 4 and runs Mon 29 Jun -> Sun 5 Jul. July begins
		// two sevenths of the way into that cell, not at its left edge.
		const columns = buildColumns(
			new Date(2026, 5, 1),
			new Date(2026, 7, 31),
			"week",
		);
		expect(columns[4].start).toEqual(new Date(2026, 5, 29));

		const groups = buildGroups(columns, "week", WEEK);
		const july = groups.find((g) => g.label === "July 2026");
		const june = groups.find((g) => g.label === "June 2026");
		if (!july || !june) throw new Error("expected June and July bands");

		const straddledColumnLeft = 4 * WEEK;
		expect(july.left).toBeCloseTo(straddledColumnLeft + (2 / 7) * WEEK, 6);
		expect(july.left).toBeGreaterThan(straddledColumnLeft);
		expect(july.left).toBeLessThan(straddledColumnLeft + WEEK);

		// No gap and no overlap: June ends exactly where July starts.
		expect(june.left + june.width).toBeCloseTo(july.left, 6);
	});

	it("covers the full width with no gaps at the week scale", () => {
		const columns = buildColumns(
			new Date(2026, 0, 1),
			new Date(2026, 3, 1),
			"week",
		);
		const groups = buildGroups(columns, "week", WEEK);

		expect(groups.length).toBeGreaterThan(1);
		expect(groups[0].left).toBe(0);
		expect(groups.reduce((sum, g) => sum + g.width, 0)).toBeCloseTo(
			columns.length * WEEK,
			6,
		);
	});

	it("groups the month scale by year, still on column edges", () => {
		const columns = buildColumns(
			new Date(2025, 10, 1),
			new Date(2026, 4, 1),
			"month",
		);
		const groups = buildGroups(columns, "month", COL_WIDTH.month);

		expect(groups.map((g) => g.label)).toEqual(["2025", "2026"]);
		expect(groups[0].width).toBe(2 * COL_WIDTH.month); // Nov, Dec
		expect(groups[1].left).toBe(2 * COL_WIDTH.month);
	});

	it("returns no groups for the year scale", () => {
		const columns = buildColumns(
			new Date(2020, 0, 1),
			new Date(2026, 0, 1),
			"year",
		);
		expect(buildGroups(columns, "year", COL_WIDTH.year)).toEqual([]);
	});
});

describe("findColumnIndex", () => {
	it("finds the column containing a date, mid-period included", () => {
		const columns = buildColumns(
			new Date(2026, 5, 1),
			new Date(2026, 10, 1),
			"month",
		);
		// 17 Aug sits inside the August column, which is index 2 (Jun, Jul, Aug).
		expect(findColumnIndex(columns, new Date(2026, 7, 17))).toBe(2);
		expect(columnLabel(columns[2].start, "month")).toBe("Aug");
	});

	it("returns -1 for a date before the first column", () => {
		const columns = buildColumns(
			new Date(2026, 5, 1),
			new Date(2026, 10, 1),
			"month",
		);
		expect(findColumnIndex(columns, new Date(2025, 0, 1))).toBe(-1);
	});
});
