import { describe, expect, it } from "vitest";
import type { GoogleCalendarEvent, Meeting } from "@/services/meetings.service";
import {
	barSegments,
	isBarItem,
	shortTime,
	timedItemsOnDay,
	timedItemsStartingOn,
	timeRange,
	toCalendarItems,
} from "./items";

// Local wall-clock parts so the assertions hold in any timezone.
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m);
const day = (d: number) => new Date(2026, 9, d);
const week = (first: number) =>
	Array.from({ length: 7 }, (_, i) => day(first + i));

function meeting(overrides: Partial<Meeting>): Meeting {
	return {
		id: "m",
		title: "Sync",
		scheduled_at: at(7, 15).toISOString(),
		ends_at: at(7, 16).toISOString(),
		duration_minutes: 60,
		status: "scheduled",
		...overrides,
	} as Meeting;
}

function gEvent(overrides: Partial<GoogleCalendarEvent>): GoogleCalendarEvent {
	return {
		id: "g",
		recurringEventId: null,
		title: "Event",
		start: at(8, 8).toISOString(),
		end: at(8, 10, 30).toISOString(),
		allDay: false,
		location: null,
		htmlLink: null,
		meetUrl: null,
		free: false,
		...overrides,
	};
}

describe("calendar items", () => {
	it("merges meetings and Google events, hiding inactive meetings", () => {
		const items = toCalendarItems(
			[meeting({ id: "a" }), meeting({ id: "gone", status: "cancelled" })],
			[gEvent({ id: "g1" })],
		);
		expect(items.map((i) => i.key)).toEqual(["a", "gcal:g1"]);
		expect(items.map((i) => i.source)).toEqual(["proyekto", "google"]);
	});

	it("labels times the way Google Calendar does", () => {
		expect(shortTime(at(7, 16))).toBe("4pm");
		expect(shortTime(at(7, 8, 30))).toBe("8:30am");
		expect(shortTime(at(7, 0))).toBe("12am");
		expect(timeRange(at(7, 15), at(7, 16))).toBe("3 – 4pm");
		expect(timeRange(at(7, 8), at(7, 10, 30))).toBe("8 – 10:30am");
		expect(timeRange(at(7, 11), at(7, 13))).toBe("11am – 1pm");
	});

	it("puts all-day and 24h+ events in bars, everything else in the grid", () => {
		const items = toCalendarItems(
			[],
			[
				gEvent({
					id: "a",
					allDay: true,
					start: "2026-10-09",
					end: "2026-10-11",
				}),
				gEvent({
					id: "b",
					start: at(9, 13).toISOString(),
					end: at(11, 13).toISOString(),
				}),
				gEvent({ id: "c" }),
			],
		);
		const bar = Object.fromEntries(items.map((i) => [i.key, isBarItem(i)]));
		expect(bar).toEqual({ "gcal:a": true, "gcal:b": true, "gcal:c": false });
	});

	it("lays a multi-day bar across the week and stacks overlaps into lanes", () => {
		const items = toCalendarItems(
			[],
			[
				gEvent({
					id: "trip",
					allDay: true,
					start: "2026-10-09",
					end: "2026-10-11",
				}),
				gEvent({
					id: "fri",
					allDay: true,
					start: "2026-10-09",
					end: "2026-10-10",
				}),
				gEvent({
					id: "mon",
					allDay: true,
					start: "2026-10-05",
					end: "2026-10-06",
				}),
			],
		);
		const segments = barSegments(items, week(4)); // Sun 4 … Sat 10
		const byId = Object.fromEntries(segments.map((s) => [s.item.key, s]));
		// Sun=0 … Sat=6. The trip covers Fri 9 + Sat 10.
		expect(byId["gcal:trip"]).toMatchObject({ startCol: 5, span: 2 });
		expect(byId["gcal:mon"]).toMatchObject({ startCol: 1, span: 1, lane: 0 });
		// The Friday-only event overlaps the trip, so it gets its own lane.
		expect(byId["gcal:fri"].lane).not.toBe(byId["gcal:trip"].lane);
	});

	it("clips a bar that continues past the visible week", () => {
		const items = toCalendarItems(
			[],
			[
				gEvent({
					id: "x",
					allDay: true,
					start: "2026-10-09",
					end: "2026-10-14",
				}),
			],
		);
		const [segment] = barSegments(items, week(4));
		expect(segment).toMatchObject({
			startCol: 5,
			span: 2,
			clippedStart: false,
			clippedEnd: true,
		});
		const [next] = barSegments(items, week(11));
		// Oct 9–13 continues into Sun 11, Mon 12, Tue 13 of the next week.
		expect(next).toMatchObject({ startCol: 0, span: 3, clippedStart: true });
	});

	it("places timed items on their day in minutes, and lists them by start day", () => {
		const items = toCalendarItems(
			[meeting({ id: "a" })],
			[gEvent({ id: "g" })],
		);
		const onWed = timedItemsOnDay(items, day(7));
		expect(onWed).toHaveLength(1);
		expect(onWed[0]).toMatchObject({ startMin: 15 * 60, endMin: 16 * 60 });
		expect(timedItemsStartingOn(items, day(8)).map((i) => i.key)).toEqual([
			"gcal:g",
		]);
	});
	it("clips an overnight event to each day it crosses", () => {
		const items = toCalendarItems(
			[],
			[
				gEvent({
					id: "late",
					start: at(9, 22).toISOString(),
					end: at(10, 2).toISOString(),
				}),
			],
		);
		expect(timedItemsOnDay(items, day(9))[0]).toMatchObject({
			startMin: 22 * 60,
			endMin: 24 * 60,
		});
		expect(timedItemsOnDay(items, day(10))[0]).toMatchObject({
			startMin: 0,
			endMin: 2 * 60,
		});
	});

	it("treats an all-day event's end date as exclusive", () => {
		const items = toCalendarItems(
			[],
			[
				gEvent({
					id: "d",
					allDay: true,
					start: "2026-10-05",
					end: "2026-10-06",
				}),
			],
		);
		const [segment] = barSegments(items, week(4));
		expect(segment).toMatchObject({ startCol: 1, span: 1 });
		expect(timedItemsOnDay(items, day(5))).toEqual([]);
	});
});
