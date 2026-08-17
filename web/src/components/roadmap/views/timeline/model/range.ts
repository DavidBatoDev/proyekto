import type { RoadmapEpic } from "@/types/roadmap";
import type { Granularity } from "../../milestones/model/types";

/** Padding either side of the dated content, per granularity. */
const PAD_DAYS: Record<Granularity, number> = {
	day: 28,
	week: 20 * 7,
	month: 0,
	year: 0,
};

/**
 * Timeline extent.
 *
 * Unlike the shared milestones helper this also counts EPIC dates, not just
 * feature dates. Drawing a range on an epic row would otherwise place a bar
 * outside the computed columns — off the grid, and invisible.
 */
export function getTimelineExtent(
	epics: RoadmapEpic[],
	granularity: Granularity,
): { start: Date; end: Date } {
	const stamps: number[] = [];

	const push = (value?: string) => {
		if (!value) return;
		const time = new Date(value).getTime();
		if (!Number.isNaN(time)) stamps.push(time);
	};

	for (const epic of epics) {
		push(epic.start_date);
		push(epic.end_date);
		for (const feature of epic.features ?? []) {
			push(feature.start_date);
			push(feature.end_date);
		}
	}

	const today = new Date();
	const min = stamps.length ? new Date(Math.min(...stamps)) : today;
	const max = stamps.length ? new Date(Math.max(...stamps)) : today;

	switch (granularity) {
		case "month":
			return {
				start: new Date(min.getFullYear(), min.getMonth() - 12, 1),
				end: new Date(max.getFullYear(), max.getMonth() + 12, 1),
			};
		case "year":
			return {
				start: new Date(min.getFullYear() - 4, 0, 1),
				end: new Date(max.getFullYear() + 4, 0, 1),
			};
		default: {
			const pad = PAD_DAYS[granularity];
			const start = new Date(min);
			start.setDate(start.getDate() - pad);
			const end = new Date(max);
			end.setDate(end.getDate() + pad);
			return { start, end };
		}
	}
}
