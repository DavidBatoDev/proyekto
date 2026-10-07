import { describe, expect, it } from "vitest";
import type { GoogleCalendarEvent } from "@/services/meetings.service";
import {
	allDayGoogleEventsOnDay,
	googleEventsOnDay,
	googleLayoutId,
	googleToLayoutEvents,
	groupGoogleByDay,
	timedGoogleEventsOnDay,
} from "./googleEvents";
import { dayKey } from "./model";
import { layoutDay } from "./overlap/layout";

// Built from local wall-clock parts so the assertions hold in any timezone.
const local = (d: number, h: number, m = 0) =>
	new Date(2026, 9, d, h, m).toISOString();
const day = (d: number) => new Date(2026, 9, d);

function event(overrides: Partial<GoogleCalendarEvent>): GoogleCalendarEvent {
	return {
		id: "e",
		recurringEventId: null,
		title: "Event",
		start: local(2, 9),
		end: local(2, 10),
		allDay: false,
		location: null,
		htmlLink: null,
		meetUrl: null,
		free: false,
		...overrides,
	};
}

describe("googleEvents", () => {
	it("places a timed event on its day with minute offsets", () => {
		const timed = timedGoogleEventsOnDay(
			[event({ start: local(2, 9, 30), end: local(2, 11) })],
			day(2),
		);
		expect(timed).toHaveLength(1);
		expect(timed[0].startMin).toBe(9 * 60 + 30);
		expect(timed[0].endMin).toBe(11 * 60);
		expect(
			timedGoogleEventsOnDay(
				timed.map((t) => t.event),
				day(3),
			),
		).toEqual([]);
	});

	it("clips an overnight event to each day it crosses", () => {
		const overnight = event({ start: local(2, 22), end: local(3, 2) });
		const first = timedGoogleEventsOnDay([overnight], day(2));
		const second = timedGoogleEventsOnDay([overnight], day(3));
		expect(first[0]).toMatchObject({ startMin: 22 * 60, endMin: 24 * 60 });
		expect(second[0]).toMatchObject({ startMin: 0, endMin: 2 * 60 });
	});

	it("treats an all-day event's end date as exclusive", () => {
		const trip = event({
			id: "trip",
			allDay: true,
			start: "2026-10-05",
			end: "2026-10-07",
		});
		expect(allDayGoogleEventsOnDay([trip], day(4))).toEqual([]);
		expect(allDayGoogleEventsOnDay([trip], day(5))).toEqual([trip]);
		expect(allDayGoogleEventsOnDay([trip], day(6))).toEqual([trip]);
		expect(allDayGoogleEventsOnDay([trip], day(7))).toEqual([]);
		// All-day events never enter the time grid.
		expect(timedGoogleEventsOnDay([trip], day(5))).toEqual([]);
	});

	it("lists all-day events before timed ones for a day", () => {
		const timed = event({ id: "timed", start: local(5, 8), end: local(5, 9) });
		const allDay = event({
			id: "allday",
			allDay: true,
			start: "2026-10-05",
			end: "2026-10-06",
		});
		expect(googleEventsOnDay([timed, allDay], day(5)).map((e) => e.id)).toEqual(
			["allday", "timed"],
		);
	});

	it("groups multi-day events under every day they touch", () => {
		const grouped = groupGoogleByDay([
			event({
				id: "trip",
				allDay: true,
				start: "2026-10-05",
				end: "2026-10-08",
			}),
			event({ id: "late", start: local(9, 23), end: local(10, 1) }),
		]);
		expect(grouped.get(dayKey(day(5)))?.map((e) => e.id)).toEqual(["trip"]);
		expect(grouped.get(dayKey(day(7)))?.map((e) => e.id)).toEqual(["trip"]);
		expect(grouped.has(dayKey(day(8)))).toBe(false);
		expect(grouped.get(dayKey(day(9)))?.map((e) => e.id)).toEqual(["late"]);
		expect(grouped.get(dayKey(day(10)))?.map((e) => e.id)).toEqual(["late"]);
	});

	it("uses namespaced layout ids so Google and meeting ids never collide", () => {
		const google = event({ id: "m1", start: local(2, 9), end: local(2, 10) });
		const layout = layoutDay([
			{ id: "m1", start: 9 * 60, end: 10 * 60 },
			...googleToLayoutEvents(timedGoogleEventsOnDay([google], day(2))),
		]);
		expect(layout.map((b) => b.id).sort()).toEqual(["gcal:m1", "m1"]);
		expect(googleLayoutId(google)).toBe("gcal:m1");
		// Overlapping blocks share the column width instead of stacking.
		expect(layout.every((b) => b.columnCount === 2)).toBe(true);
	});
});
