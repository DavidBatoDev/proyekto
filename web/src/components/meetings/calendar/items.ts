/**
 * One shape for everything the calendar draws: Proyekto meetings and the
 * user's Google Calendar events (read-only overlay). The views lay out
 * CalendarItems without caring where they came from; `source` only picks the
 * calendar color and what clicking does.
 */
import type { GoogleCalendarEvent, Meeting } from "@/services/meetings.service";
import { googleEventBounds } from "./googleEvents";
import { durationMinutesOf, isActive } from "./model";
import type { LayoutEvent } from "./overlap/layout";

export type CalendarSource = "proyekto" | "google";

export interface CalendarItem {
	/** Unique across sources; doubles as the overlap-layout id. */
	key: string;
	source: CalendarSource;
	title: string;
	start: Date;
	/** Exclusive end. All-day items end at local midnight after the last day. */
	end: Date;
	allDay: boolean;
	/** Doesn't block time (Google "free"): drawn outlined. */
	free: boolean;
	meeting?: Meeting;
	googleEvent?: GoogleCalendarEvent;
}

const DAY_MINUTES = 24 * 60;
// A long all-day event is drawn on at most this many days.
const MAX_SPAN_DAYS = 62;

export function meetingItem(meeting: Meeting): CalendarItem {
	const start = new Date(meeting.scheduled_at);
	return {
		key: meeting.id,
		source: "proyekto",
		title: meeting.title,
		start,
		end: new Date(start.getTime() + durationMinutesOf(meeting) * 60_000),
		allDay: false,
		free: false,
		meeting,
	};
}

export function googleItem(event: GoogleCalendarEvent): CalendarItem {
	const { start, end } = googleEventBounds(event);
	return {
		key: `gcal:${event.id}`,
		source: "google",
		title: event.title,
		start,
		end,
		allDay: event.allDay,
		free: event.free,
		googleEvent: event,
	};
}

/** Active meetings + Google events as one list sorted by start. */
export function toCalendarItems(
	meetings: Meeting[],
	googleEvents: GoogleCalendarEvent[],
): CalendarItem[] {
	return [
		...meetings.filter(isActive).map(meetingItem),
		...googleEvents.map(googleItem),
	].sort(compareItems);
}

/** All-day first, then by start, then longer first (Google's ordering). */
export function compareItems(a: CalendarItem, b: CalendarItem): number {
	if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
	const byStart = a.start.getTime() - b.start.getTime();
	if (byStart !== 0) return byStart;
	return b.end.getTime() - a.end.getTime();
}

export function startOfLocalDay(day: Date): Date {
	return new Date(day.getFullYear(), day.getMonth(), day.getDate());
}

export function addLocalDays(day: Date, n: number): Date {
	return new Date(day.getFullYear(), day.getMonth(), day.getDate() + n);
}

/** Does the item cover any part of local `day`? */
export function touchesDay(item: CalendarItem, day: Date): boolean {
	const dayStart = startOfLocalDay(day);
	const dayEnd = addLocalDays(dayStart, 1);
	if (item.start.getTime() === item.end.getTime()) {
		return item.start >= dayStart && item.start < dayEnd;
	}
	return item.start < dayEnd && item.end > dayStart;
}

/**
 * Items drawn as bars (all-day row / month bars): all-day events and timed
 * events lasting a full day or more, as Google does.
 */
export function isBarItem(item: CalendarItem): boolean {
	return (
		item.allDay ||
		item.end.getTime() - item.start.getTime() >= DAY_MINUTES * 60_000
	);
}

export interface TimedPlacement {
	item: CalendarItem;
	startMin: number;
	endMin: number;
}

/** Timed (non-bar) items on `day`, clipped to the day, for the time grid. */
export function timedItemsOnDay(
	items: CalendarItem[],
	day: Date,
): TimedPlacement[] {
	const dayStart = startOfLocalDay(day).getTime();
	return items
		.filter((item) => !isBarItem(item) && touchesDay(item, day))
		.map((item) => {
			const startMin = Math.max(
				0,
				Math.round((item.start.getTime() - dayStart) / 60_000),
			);
			const endMin = Math.min(
				DAY_MINUTES,
				Math.round((item.end.getTime() - dayStart) / 60_000),
			);
			return { item, startMin, endMin: Math.max(endMin, startMin) };
		});
}

export function toLayout(placements: TimedPlacement[]): LayoutEvent[] {
	return placements.map((p) => ({
		id: p.item.key,
		start: p.startMin,
		end: p.endMin,
	}));
}

export interface BarSegment {
	item: CalendarItem;
	/** 0-based first column within the row of days. */
	startCol: number;
	/** Number of columns covered. */
	span: number;
	/** 0-based stacking lane (row) within the bar area. */
	lane: number;
	/** The item starts before / continues after this row of days. */
	clippedStart: boolean;
	clippedEnd: boolean;
}

/**
 * Bar items laid across a row of consecutive days (a week): each becomes one
 * segment spanning the days it covers, stacked into lanes so segments never
 * overlap — the all-day row of the week view and the bars of the month view.
 */
export function barSegments(items: CalendarItem[], days: Date[]): BarSegment[] {
	if (days.length === 0) return [];
	const rowStart = startOfLocalDay(days[0]);
	const rowEnd = addLocalDays(startOfLocalDay(days[days.length - 1]), 1);
	const lanes: number[][] = []; // lane -> occupied column flags
	const segments: BarSegment[] = [];

	for (const item of items.filter(isBarItem).sort(compareItems)) {
		if (!(item.start < rowEnd && item.end > rowStart)) continue;
		const cols = days
			.map((day, col) => (touchesDay(item, day) ? col : -1))
			.filter((col) => col >= 0)
			.slice(0, MAX_SPAN_DAYS);
		if (cols.length === 0) continue;
		const startCol = cols[0];
		const span = cols[cols.length - 1] - startCol + 1;
		let lane = 0;
		while (
			lanes[lane]?.slice(startCol, startCol + span).some(Boolean) ??
			false
		) {
			lane += 1;
		}
		lanes[lane] ??= Array(days.length).fill(0);
		for (let c = startCol; c < startCol + span; c += 1) lanes[lane][c] = 1;
		segments.push({
			item,
			startCol,
			span,
			lane,
			clippedStart: item.start < rowStart,
			clippedEnd: item.end > rowEnd,
		});
	}
	return segments;
}

/** Timed (non-bar) items starting on `day` — the "• 4pm Title" lines. */
export function timedItemsStartingOn(
	items: CalendarItem[],
	day: Date,
): CalendarItem[] {
	const dayStart = startOfLocalDay(day);
	const dayEnd = addLocalDays(dayStart, 1);
	return items.filter(
		(item) => !isBarItem(item) && item.start >= dayStart && item.start < dayEnd,
	);
}

// ── Google-style time labels ──────────────────────────────────────────────

function parts(date: Date): { h: number; m: number; pm: boolean } {
	const h24 = date.getHours();
	return {
		h: h24 % 12 === 0 ? 12 : h24 % 12,
		m: date.getMinutes(),
		pm: h24 >= 12,
	};
}

/** "4pm", "8:30am" */
export function shortTime(date: Date): string {
	const { h, m, pm } = parts(date);
	return `${h}${m ? `:${String(m).padStart(2, "0")}` : ""}${pm ? "pm" : "am"}`;
}

/** "3 – 4pm", "8 – 10:30am", "11am – 1pm" (meridiem only where it changes). */
export function timeRange(start: Date, end: Date): string {
	const a = parts(start);
	const b = parts(end);
	const startLabel = `${a.h}${a.m ? `:${String(a.m).padStart(2, "0")}` : ""}`;
	return a.pm === b.pm
		? `${startLabel} – ${shortTime(end)}`
		: `${shortTime(start)} – ${shortTime(end)}`;
}
