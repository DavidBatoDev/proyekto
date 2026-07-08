/**
 * Pure helpers that map Meeting rows onto calendar days/times. Kept free of
 * React/DOM so the geometry stays testable and the views stay thin.
 *
 * Everything works in the viewer's *local* timezone (matching the previous
 * month calendar). Projecting the whole grid into an arbitrary display timezone
 * is a later enhancement; the editor's timezone picker governs the stored
 * meeting instant regardless.
 */
import type { Meeting } from "@/services/meetings.service";
import { type LayoutEvent, minutesFromMidnight } from "./overlap/layout";

export const DEFAULT_DURATION_MIN = 30;

/** Cancelled/rescheduled meetings are hidden from the calendar. */
export function isActive(m: Meeting): boolean {
	return m.status !== "cancelled" && m.status !== "rescheduled";
}

/** Effective duration in minutes — from ends_at, else duration_minutes, else default. */
export function durationMinutesOf(m: Meeting): number {
	if (m.ends_at) {
		const d = Math.round(
			(Date.parse(m.ends_at) - Date.parse(m.scheduled_at)) / 60_000,
		);
		if (d > 0) return d;
	}
	return m.duration_minutes && m.duration_minutes > 0
		? m.duration_minutes
		: DEFAULT_DURATION_MIN;
}

export function sameLocalDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

export function dayKey(d: Date): string {
	return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Group active meetings by local day, each list sorted by start time. */
export function groupByDay(meetings: Meeting[]): Map<string, Meeting[]> {
	const map = new Map<string, Meeting[]>();
	for (const m of meetings) {
		if (!isActive(m)) continue;
		const key = dayKey(new Date(m.scheduled_at));
		const list = map.get(key);
		if (list) list.push(m);
		else map.set(key, [m]);
	}
	for (const list of map.values()) {
		list.sort(
			(a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at),
		);
	}
	return map;
}

/** Active meetings that start on `day`, sorted by start time. */
export function meetingsOnDay(meetings: Meeting[], day: Date): Meeting[] {
	return meetings
		.filter(isActive)
		.filter((m) => sameLocalDay(new Date(m.scheduled_at), day))
		.sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));
}

export interface TimedMeeting {
	meeting: Meeting;
	startMin: number;
	endMin: number;
}

/** Meetings on `day` with their minute spans, for a time-grid layout. */
export function timedMeetingsOnDay(
	meetings: Meeting[],
	day: Date,
): TimedMeeting[] {
	return meetingsOnDay(meetings, day).map((m) => {
		const startMin = minutesFromMidnight(new Date(m.scheduled_at));
		const endMin = Math.min(24 * 60, startMin + durationMinutesOf(m));
		return { meeting: m, startMin, endMin };
	});
}

/** Adapt timed meetings to the overlap layout's event shape. */
export function toLayoutEvents(timed: TimedMeeting[]): LayoutEvent[] {
	return timed.map((t) => ({
		id: t.meeting.id,
		start: t.startMin,
		end: t.endMin,
	}));
}
