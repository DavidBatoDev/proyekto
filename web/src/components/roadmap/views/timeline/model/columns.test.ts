import { describe, expect, it } from "vitest";
import {
	buildColumns,
	buildGroups,
	columnLabel,
	findColumnIndex,
	groupLabel,
	isoWeekAnchor,
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

	it("anchors an ISO week to the month of its Thursday", () => {
		// Week starting Mon 29 Jun 2026 has its Thursday on 2 Jul -> July.
		const straddling = new Date(2026, 5, 29);
		expect(isoWeekAnchor(straddling).getMonth()).toBe(6);
		expect(groupLabel(straddling, "week")).toBe("July 2026");
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
	it("splits months into contiguous bands with correct spans", () => {
		const columns = buildColumns(
			new Date(2026, 0, 1),
			new Date(2026, 2, 31),
			"day",
		);
		const groups = buildGroups(columns, "day");

		expect(groups.map((g) => g.label)).toEqual([
			"January 2026",
			"February 2026",
			"March 2026",
		]);
		expect(groups[0].colCount).toBe(31);
		expect(groups[1].colCount).toBe(28);
		expect(groups[1].startIndex).toBe(31);
		expect(groups.reduce((sum, g) => sum + g.colCount, 0)).toBe(columns.length);
	});

	it("groups weeks by month rather than by ISO week-year", () => {
		const columns = buildColumns(
			new Date(2026, 0, 1),
			new Date(2026, 3, 1),
			"week",
		);
		const groups = buildGroups(columns, "week");

		// The old behaviour produced a single "2026" band spanning everything.
		expect(groups.length).toBeGreaterThan(1);
		expect(groups[0].label).toContain("2026");
		expect(groups[0].label).not.toBe("2026");
	});

	it("returns no groups for the year scale", () => {
		const columns = buildColumns(
			new Date(2020, 0, 1),
			new Date(2026, 0, 1),
			"year",
		);
		expect(buildGroups(columns, "year")).toEqual([]);
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
