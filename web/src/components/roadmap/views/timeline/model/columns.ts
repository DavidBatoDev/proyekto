import type { Granularity } from "../../milestones/model/types";
import {
	addInterval,
	floorToUnit,
	getISOWeek,
	toTimelinePx,
} from "../../milestones/model/utils";

export interface TimelineColumn {
	/** Start of the period this column covers. */
	start: Date;
	/** Short label shown in the date row (e.g. "17", "W34", "Aug", "2026"). */
	label: string;
	/** Sub-label for the day scale only (e.g. "Mo") — undefined otherwise. */
	subLabel?: string;
	isWeekend: boolean;
}

export interface TimelineGroup {
	key: string;
	label: string;
	/**
	 * Left edge in timeline px, on the same scale as every bar. NOT snapped to a
	 * column edge — see buildGroups.
	 */
	left: number;
	width: number;
}

export function columnLabel(date: Date, granularity: Granularity): string {
	switch (granularity) {
		case "day":
			return String(date.getDate());
		case "week":
			return `W${String(getISOWeek(date)).padStart(2, "0")}`;
		case "month":
			return date.toLocaleDateString("en-US", { month: "short" });
		case "year":
			return String(date.getFullYear());
	}
}

/**
 * The unit the band above the date row is cut into. Each scale is grouped by
 * the next coarser unit, which is what makes the header readable:
 *   day -> month, week -> month, month -> year, year -> none.
 */
function bandUnit(granularity: Granularity): Granularity | null {
	switch (granularity) {
		case "day":
		case "week":
			return "month";
		case "month":
			return "year";
		case "year":
			return null;
	}
}

/** Label of the band that `date` falls in. */
export function groupLabel(
	date: Date,
	granularity: Granularity,
): string | null {
	switch (bandUnit(granularity)) {
		case "month":
			return date.toLocaleDateString("en-US", {
				month: "long",
				year: "numeric",
			});
		case "year":
			return String(date.getFullYear());
		default:
			return null;
	}
}

export function buildColumns(
	start: Date,
	end: Date,
	granularity: Granularity,
): TimelineColumn[] {
	const columns: TimelineColumn[] = [];
	let cursor = floorToUnit(start, granularity);

	while (cursor.getTime() <= end.getTime()) {
		const day = cursor.getDay();
		columns.push({
			start: new Date(cursor),
			label: columnLabel(cursor, granularity),
			subLabel:
				granularity === "day"
					? cursor.toLocaleDateString("en-US", { weekday: "narrow" })
					: undefined,
			isWeekend: granularity === "day" && (day === 0 || day === 6),
		});
		cursor = addInterval(cursor, granularity);
	}

	return columns;
}

/**
 * The bands above the date row, measured in pixels at the *true* period
 * boundary rather than snapped to the nearest column edge.
 *
 * This matters only at the week scale, and it is the whole point of the
 * function. A week straddles a month: W27 of 2026 runs Mon 29 Jun to Sun 5 Jul.
 * Counting whole columns forces that week entirely into one month, so the
 * header claims all of W27 is July while a bar ending 30 June is drawn two
 * sevenths of the way into the same cell. The header and the bars are then
 * describing different timelines, and the bar is the one telling the truth.
 *
 * Cutting the band where the month actually turns puts both on one scale: a bar
 * ending on the last day of July now ends exactly on the August divider.
 *
 * At the day and month scales every boundary already falls on a column edge, so
 * this returns what the old column-counting did, to the pixel.
 */
export function buildGroups(
	columns: TimelineColumn[],
	granularity: Granularity,
	colWidth: number,
): TimelineGroup[] {
	const unit = bandUnit(granularity);
	if (unit === null || columns.length === 0) return [];

	const rangeStart = columns[0].start;
	const totalWidth = columns.length * colWidth;
	const rangeEnd = addInterval(
		columns[columns.length - 1].start,
		granularity,
		1,
	);

	const groups: TimelineGroup[] = [];
	let cursor = floorToUnit(rangeStart, unit);

	while (cursor.getTime() < rangeEnd.getTime()) {
		const next = addInterval(cursor, unit, 1);
		const label = groupLabel(cursor, granularity);
		// Clamped: the first and last bands are usually partial.
		const left = Math.max(
			0,
			toTimelinePx(cursor, rangeStart, granularity, colWidth),
		);
		const right = Math.min(
			totalWidth,
			toTimelinePx(next, rangeStart, granularity, colWidth),
		);

		if (label !== null && right > left) {
			groups.push({
				key: String(cursor.getTime()),
				label,
				left,
				width: right - left,
			});
		}
		cursor = next;
	}

	return groups;
}

/**
 * Index of the column containing `date`, or -1 when it falls outside.
 * Callers align highlights to the column, never to the fractional offset of the
 * date itself — otherwise the marker straddles two columns.
 */
export function findColumnIndex(columns: TimelineColumn[], date: Date): number {
	const time = date.getTime();
	for (let index = columns.length - 1; index >= 0; index -= 1) {
		if (columns[index].start.getTime() <= time) return index;
	}
	return -1;
}
