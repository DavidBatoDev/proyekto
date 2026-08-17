import type { Granularity } from "../../milestones/model/types";
import {
	addInterval,
	floorToUnit,
	getISOWeek,
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
	startIndex: number;
	colCount: number;
}

/**
 * The Thursday of the ISO week containing `date`. ISO weeks belong to the month
 * (and year) of their Thursday, so a week straddling a month boundary is
 * grouped under exactly one month instead of being split.
 */
export function isoWeekAnchor(date: Date): Date {
	const anchor = new Date(date);
	anchor.setHours(0, 0, 0, 0);
	anchor.setDate(anchor.getDate() + 3 - ((anchor.getDay() + 6) % 7));
	return anchor;
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
 * Label of the band above the date row. Each scale is grouped by the next
 * coarser unit, which is what makes the header readable:
 *   day -> month, week -> month, month -> year, year -> none.
 */
export function groupLabel(
	date: Date,
	granularity: Granularity,
): string | null {
	switch (granularity) {
		case "day":
			return date.toLocaleDateString("en-US", {
				month: "long",
				year: "numeric",
			});
		case "week":
			return isoWeekAnchor(date).toLocaleDateString("en-US", {
				month: "long",
				year: "numeric",
			});
		case "month":
			return String(date.getFullYear());
		case "year":
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

export function buildGroups(
	columns: TimelineColumn[],
	granularity: Granularity,
): TimelineGroup[] {
	if (granularity === "year") return [];

	const groups: TimelineGroup[] = [];

	columns.forEach((column, index) => {
		const label = groupLabel(column.start, granularity);
		if (label === null) return;

		const previous = groups[groups.length - 1];
		if (previous && previous.label === label) {
			previous.colCount += 1;
			return;
		}
		groups.push({
			key: `${label}-${index}`,
			label,
			startIndex: index,
			colCount: 1,
		});
	});

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
