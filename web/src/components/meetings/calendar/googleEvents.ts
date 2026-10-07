/**
 * Pure helpers that place the user's Google Calendar events (the read-only
 * overlay) onto local calendar days. Mirrors model.ts for meetings, plus the
 * two shapes Google has that meetings don't: all-day events (date-only, with an
 * exclusive end day) and timed events that cross midnight.
 */
import type { GoogleCalendarEvent } from "@/services/meetings.service";
import { dayKey } from "./model";
import type { LayoutEvent } from "./overlap/layout";

const DAY_MINUTES = 24 * 60;
// A multi-week all-day event (a holiday block, travel) is drawn on at most this
// many days so one long event can't flood a month grid.
const MAX_SPAN_DAYS = 62;

/** Layout ids are namespaced so a Google id can never collide with a meeting id. */
export const GOOGLE_LAYOUT_PREFIX = "gcal:";

export function googleLayoutId(event: GoogleCalendarEvent): string {
	return `${GOOGLE_LAYOUT_PREFIX}${event.id}`;
}

/** `YYYY-MM-DD` → local midnight of that calendar date. */
function localDate(ymd: string): Date {
	const [y, m, d] = ymd.split("-").map(Number);
	return new Date(y, (m || 1) - 1, d || 1);
}

function startOfLocalDay(day: Date): Date {
	return new Date(day.getFullYear(), day.getMonth(), day.getDate());
}

function addLocalDays(day: Date, n: number): Date {
	return new Date(day.getFullYear(), day.getMonth(), day.getDate() + n);
}

/** The event's [start, end) as local Dates (all-day: local midnights). */
export function googleEventBounds(event: GoogleCalendarEvent): {
	start: Date;
	end: Date;
} {
	if (event.allDay) {
		const start = localDate(event.start);
		const end = localDate(event.end);
		// Guard a malformed zero-length all-day event: treat it as one day.
		return { start, end: end > start ? end : addLocalDays(start, 1) };
	}
	const start = new Date(event.start);
	const end = new Date(event.end);
	return { start, end: end > start ? end : start };
}

/** Does the event cover any part of local `day`? */
export function googleEventTouchesDay(
	event: GoogleCalendarEvent,
	day: Date,
): boolean {
	const { start, end } = googleEventBounds(event);
	const dayStart = startOfLocalDay(day);
	const dayEnd = addLocalDays(dayStart, 1);
	// A zero-length timed event still belongs to the day it starts on.
	if (start.getTime() === end.getTime()) {
		return start >= dayStart && start < dayEnd;
	}
	return start < dayEnd && end > dayStart;
}

function byStart(a: GoogleCalendarEvent, b: GoogleCalendarEvent): number {
	return (
		googleEventBounds(a).start.getTime() - googleEventBounds(b).start.getTime()
	);
}

/** All-day events covering `day`. */
export function allDayGoogleEventsOnDay(
	events: GoogleCalendarEvent[],
	day: Date,
): GoogleCalendarEvent[] {
	return events
		.filter((e) => e.allDay && googleEventTouchesDay(e, day))
		.sort(byStart);
}

/** Every event (all-day first, then timed by start) touching `day`. */
export function googleEventsOnDay(
	events: GoogleCalendarEvent[],
	day: Date,
): GoogleCalendarEvent[] {
	const touching = events.filter((e) => googleEventTouchesDay(e, day));
	return [
		...touching.filter((e) => e.allDay).sort(byStart),
		...touching.filter((e) => !e.allDay).sort(byStart),
	];
}

export interface TimedGoogleEvent {
	event: GoogleCalendarEvent;
	/** Minutes from local midnight, clipped to the day. */
	startMin: number;
	endMin: number;
}

/** Timed events on `day` with their minute spans clipped to that day. */
export function timedGoogleEventsOnDay(
	events: GoogleCalendarEvent[],
	day: Date,
): TimedGoogleEvent[] {
	const dayStart = startOfLocalDay(day).getTime();
	return events
		.filter((e) => !e.allDay && googleEventTouchesDay(e, day))
		.sort(byStart)
		.map((event) => {
			const { start, end } = googleEventBounds(event);
			const startMin = Math.max(
				0,
				Math.round((start.getTime() - dayStart) / 60_000),
			);
			const endMin = Math.min(
				DAY_MINUTES,
				Math.round((end.getTime() - dayStart) / 60_000),
			);
			return { event, startMin, endMin: Math.max(endMin, startMin) };
		});
}

/** Adapt timed Google events to the overlap layout's event shape. */
export function googleToLayoutEvents(timed: TimedGoogleEvent[]): LayoutEvent[] {
	return timed.map((t) => ({
		id: googleLayoutId(t.event),
		start: t.startMin,
		end: t.endMin,
	}));
}

/** Group events by every local day they touch (for month cells / year dots). */
export function groupGoogleByDay(
	events: GoogleCalendarEvent[],
): Map<string, GoogleCalendarEvent[]> {
	const map = new Map<string, GoogleCalendarEvent[]>();
	for (const event of [...events].sort(byStart)) {
		const { start, end } = googleEventBounds(event);
		let day = startOfLocalDay(start);
		for (let i = 0; i < MAX_SPAN_DAYS; i += 1) {
			if (!googleEventTouchesDay(event, day)) break;
			const key = dayKey(day);
			const list = map.get(key);
			if (list) list.push(event);
			else map.set(key, [event]);
			day = addLocalDays(day, 1);
			if (day >= end) break;
		}
	}
	return map;
}
