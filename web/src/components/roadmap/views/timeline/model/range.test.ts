import { describe, expect, it } from "vitest";
import type { RoadmapEpic } from "@/types/roadmap";
import { getColumns, toISODateString } from "../../milestones/model/utils";
import { getTimelineExtent } from "./range";

const epicWith = (dates: Partial<RoadmapEpic>, features: unknown[] = []) =>
	({ id: "e1", features, ...dates }) as RoadmapEpic;

describe("getTimelineExtent", () => {
	it("covers epic dates, not just feature dates", () => {
		const epic = epicWith({ start_date: "2030-06-01", end_date: "2030-06-10" });
		const { start, end } = getTimelineExtent([epic], "week");

		expect(start.getTime()).toBeLessThan(new Date("2030-06-01").getTime());
		expect(end.getTime()).toBeGreaterThan(new Date("2030-06-10").getTime());
		expect(getColumns(start, end, "week").length).toBeGreaterThan(0);
	});

	it("ignores unparseable dates instead of poisoning the whole scale", () => {
		const epic = epicWith({ start_date: "not-a-date" }, [
			{ id: "f1", start_date: "2030-06-01", end_date: "2030-06-10" },
		]);
		const { start, end } = getTimelineExtent([epic], "week");

		expect(Number.isNaN(start.getTime())).toBe(false);
		expect(Number.isNaN(end.getTime())).toBe(false);
		expect(getColumns(start, end, "week").length).toBeGreaterThan(0);
	});

	it("falls back to a window around today when nothing has dates", () => {
		const { start, end } = getTimelineExtent([epicWith({})], "week");
		const today = Date.now();

		expect(start.getTime()).toBeLessThan(today);
		expect(end.getTime()).toBeGreaterThan(today);
	});

	it("keeps a drawn range inside the grid it produces", () => {
		const drawn = { start_date: "2030-06-01", end_date: "2030-06-04" };
		const epic = epicWith({}, [{ id: "f1", ...drawn }]);
		const { start, end } = getTimelineExtent([epic], "week");
		const columns = getColumns(start, end, "week");
		const last = columns[columns.length - 1];

		expect(toISODateString(start) < drawn.start_date).toBe(true);
		expect(toISODateString(last) > drawn.end_date).toBe(true);
	});
});
