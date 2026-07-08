/**
 * Derives the fetch window and the visible span for a calendar view. The fetch
 * window is snapped to month boundaries with a ±1-month buffer so day/week
 * navigation within a month reuses the same query key (served from cache via
 * useMeetingsRange's staleTime) instead of refetching on every step.
 */
import {
	addMonths,
	endOfDay,
	endOfMonth,
	endOfWeek,
	endOfYear,
	startOfDay,
	startOfMonth,
	startOfWeek,
	startOfYear,
	subMonths,
} from "date-fns";
import { useMemo } from "react";
import type { ListMeetingsParams } from "@/services/meetings.service";

export type CalendarView = "day" | "week" | "month" | "year";

/** The range a view actually renders (the day, the week, the 6-week grid, the year). */
export function visibleRange(
	view: CalendarView,
	anchor: Date,
): { start: Date; end: Date } {
	switch (view) {
		case "day":
			return { start: startOfDay(anchor), end: endOfDay(anchor) };
		case "week":
			return { start: startOfWeek(anchor), end: endOfWeek(anchor) };
		case "year":
			return { start: startOfYear(anchor), end: endOfYear(anchor) };
		default:
			// The month grid shows leading/trailing days of adjacent months.
			return {
				start: startOfWeek(startOfMonth(anchor)),
				end: endOfWeek(endOfMonth(anchor)),
			};
	}
}

/** The `{from, to}` params to feed useMeetingsRange for a view + anchor. */
export function useCalendarRange(
	view: CalendarView,
	anchor: Date,
): ListMeetingsParams {
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the anchor's instant, not identity.
	return useMemo(() => {
		const { start, end } = visibleRange(view, anchor);
		const from = startOfMonth(subMonths(start, 1));
		const to = endOfMonth(addMonths(end, 1));
		return { from: from.toISOString(), to: to.toISOString() };
	}, [view, anchor.getTime()]);
}
