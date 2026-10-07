/**
 * Turns a Google Calendar event (the read-only overlay) into local Dates.
 * Google has two shapes meetings don't: all-day events, which are date-only
 * with an exclusive end day, and timed events that cross midnight. Placement
 * on the grid lives in items.ts, which works on these bounds.
 */
import type { GoogleCalendarEvent } from "@/services/meetings.service";

/** `YYYY-MM-DD` → local midnight of that calendar date. */
function localDate(ymd: string): Date {
	const [y, m, d] = ymd.split("-").map(Number);
	return new Date(y, (m || 1) - 1, d || 1);
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
		return {
			start,
			end:
				end > start
					? end
					: new Date(
							start.getFullYear(),
							start.getMonth(),
							start.getDate() + 1,
						),
		};
	}
	const start = new Date(event.start);
	const end = new Date(event.end);
	return { start, end: end > start ? end : start };
}
