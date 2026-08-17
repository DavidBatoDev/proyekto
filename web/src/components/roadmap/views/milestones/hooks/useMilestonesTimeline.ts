import { useMemo } from "react";
import type { RoadmapEpic, RoadmapMilestone } from "@/types/roadmap";
import { COL_WIDTH } from "../model/constants";
import type { Granularity, MilestoneMarker } from "../model/types";
import {
	getColumns,
	getSuperGroups,
	getTimelineRange,
	toTimelinePx,
} from "../model/utils";

interface UseMilestonesTimelineParams {
	sortedEpics: RoadmapEpic[];
	sortedMilestones: RoadmapMilestone[];
	granularity: Granularity;
}

export function useMilestonesTimeline({
	sortedEpics,
	sortedMilestones,
	granularity,
}: UseMilestonesTimelineParams) {
	const { rangeStart, columns, superGroups } = useMemo(() => {
		const range = getTimelineRange(sortedEpics, granularity);
		const cols = getColumns(range.start, range.end, granularity);
		return {
			rangeStart: cols[0] ?? range.start,
			columns: cols,
			superGroups: getSuperGroups(cols, granularity),
		};
	}, [sortedEpics, granularity]);

	const cw = COL_WIDTH[granularity];
	const totalWidth = columns.length * cw;
	const todayPx = toTimelinePx(new Date(), rangeStart, granularity, cw);
	const todayColIndex = todayPx >= 0 ? Math.floor(todayPx / cw) : -1;
	const todayColLeft = todayColIndex * cw;
	const todayColInRange = todayColIndex >= 0 && todayColLeft < totalWidth;
	const hasAnyDates = sortedEpics.some((epic) =>
		(epic.features ?? []).some(
			(feature) => feature.start_date || feature.end_date,
		),
	);

	const milestoneMarkers = useMemo(() => {
		return sortedMilestones
			.map((milestone) => {
				const parsed = new Date(milestone.target_date);
				if (Number.isNaN(parsed.getTime())) return null;
				const left = toTimelinePx(parsed, rangeStart, granularity, cw);
				return { milestone, left };
			})
			.filter((item): item is MilestoneMarker => Boolean(item));
	}, [sortedMilestones, rangeStart, granularity, cw]);

	// A single-column tile that the compositor repeats, NOT a
	// repeating-linear-gradient spanning the whole timeline. The repeating form
	// makes the browser evaluate one gradient across the full scroll width, so
	// every raster tile that scrolls into view during a horizontal pan is
	// expensive; a `background-size` tile is rasterized once and reused.
	const gridBg = useMemo(
		() => ({
			backgroundImage: `linear-gradient(90deg, transparent ${cw - 1}px, #e5e7eb ${cw - 1}px)`,
			backgroundSize: `${cw}px 100%`,
			backgroundRepeat: "repeat",
		}),
		[cw],
	);

	return {
		rangeStart,
		columns,
		superGroups,
		cw,
		totalWidth,
		todayPx,
		todayColIndex,
		todayColLeft,
		todayColInRange,
		hasAnyDates,
		milestoneMarkers,
		gridBg,
	};
}
