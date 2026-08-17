import { useCallback, useMemo } from "react";
import type { RoadmapEpic, RoadmapMilestone } from "@/types/roadmap";
import { COL_WIDTH } from "../../milestones/model/constants";
import type {
	Granularity,
	MilestoneMarker,
} from "../../milestones/model/types";
import { dateFromTimelinePx, toTimelinePx } from "../../milestones/model/utils";
import { buildColumns, buildGroups, findColumnIndex } from "../model/columns";
import { getTimelineExtent } from "../model/range";

/**
 * Date <-> pixel scale for the timeline grid. Pure derivation — no DOM — so it
 * is safe to call during a drag.
 */
export function useTimelineScale(
	epics: RoadmapEpic[],
	milestones: RoadmapMilestone[],
	granularity: Granularity,
) {
	const cw = COL_WIDTH[granularity];

	const { rangeStart, columns, groups } = useMemo(() => {
		const extent = getTimelineExtent(epics, granularity);
		const cols = buildColumns(extent.start, extent.end, granularity);
		return {
			rangeStart: cols[0]?.start ?? extent.start,
			columns: cols,
			groups: buildGroups(cols, granularity),
		};
	}, [epics, granularity]);

	const totalWidth = columns.length * cw;

	const dateToPx = useCallback(
		(date: Date | string) =>
			toTimelinePx(
				typeof date === "string" ? new Date(date) : date,
				rangeStart,
				granularity,
				cw,
			),
		[rangeStart, granularity, cw],
	);

	const pxToDate = useCallback(
		(px: number) => dateFromTimelinePx(px, rangeStart, granularity, cw),
		[rangeStart, granularity, cw],
	);

	// Today is tracked by COLUMN, not by its fractional offset: a highlight
	// drawn at the exact position of "now" straddles two columns.
	const todayColIndex = useMemo(
		() => findColumnIndex(columns, new Date()),
		[columns],
	);
	const todayColLeft = todayColIndex * cw;
	const todayInRange = todayColIndex >= 0;
	const todayPx = dateToPx(new Date());

	const milestoneMarkers = useMemo<MilestoneMarker[]>(() => {
		return milestones
			.map((milestone) => {
				const parsed = new Date(milestone.target_date);
				if (Number.isNaN(parsed.getTime())) return null;
				return { milestone, left: dateToPx(parsed) };
			})
			.filter((marker): marker is MilestoneMarker => marker !== null);
	}, [milestones, dateToPx]);

	// One repeated column tile rather than a gradient spanning the full scroll
	// width — the wide form makes every raster tile that scrolls into view
	// expensive.
	const gridBackground = useMemo(
		() => ({
			backgroundImage: `linear-gradient(90deg, transparent ${cw - 1}px, #eef1f5 ${cw - 1}px)`,
			backgroundSize: `${cw}px 100%`,
		}),
		[cw],
	);

	return {
		cw,
		columns,
		groups,
		rangeStart,
		totalWidth,
		dateToPx,
		pxToDate,
		todayPx,
		todayColIndex,
		todayColLeft,
		todayInRange,
		milestoneMarkers,
		gridBackground,
	};
}
