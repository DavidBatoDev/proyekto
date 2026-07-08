/**
 * Timezone-aware date/time helpers for meeting scheduling.
 *
 * The meeting editor collects a *wall-clock* start (a calendar date + a clock
 * time) plus an IANA timezone, and must convert that to an absolute UTC instant
 * for the API. The old modal used `new Date("2026-07-08T16:00")`, which silently
 * interprets the wall-clock in the *browser's* zone — wrong the moment the user
 * picks a different timezone. These helpers do the conversion explicitly and
 * DST-correctly via date-fns-tz.
 */
import { format } from "date-fns";
import {
	formatInTimeZone,
	fromZonedTime,
	getTimezoneOffset,
} from "date-fns-tz";

/** The viewer's IANA timezone, falling back to UTC when unavailable. */
export function localTimeZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
}

/**
 * All IANA timezone identifiers for a picker. Uses the platform list when the
 * runtime supports it (all current evergreen browsers do), with a small curated
 * fallback so the picker is never empty.
 */
export function listTimeZones(): string[] {
	const supported = (
		Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
	).supportedValuesOf;
	if (typeof supported === "function") {
		try {
			return supported("timeZone");
		} catch {
			/* fall through */
		}
	}
	return FALLBACK_TIME_ZONES;
}

/**
 * Combine a wall-clock date ("yyyy-MM-dd") and time ("HH:mm") interpreted in
 * `timeZone` into an absolute UTC ISO string.
 */
export function wallTimeToUtcISO(
	date: string,
	time: string,
	timeZone: string,
): string {
	// A naive local timestamp with no offset; fromZonedTime resolves it in the
	// given zone (handling DST) and returns the corresponding UTC instant.
	const naive = `${date}T${normalizeTime(time)}:00`;
	return fromZonedTime(naive, timeZone).toISOString();
}

/** Split a UTC ISO instant into wall-clock parts in `timeZone` (for editing). */
export function utcToZonedParts(
	iso: string,
	timeZone: string,
): { date: string; time: string } {
	return {
		date: formatInTimeZone(iso, timeZone, "yyyy-MM-dd"),
		time: formatInTimeZone(iso, timeZone, "HH:mm"),
	};
}

/** A short GMT-offset label for a zone, e.g. "GMT+08:00". */
export function timeZoneOffsetLabel(
	timeZone: string,
	at: Date = REF_DATE,
): string {
	const offsetMs = getTimezoneOffset(timeZone, at);
	if (Number.isNaN(offsetMs)) return timeZone;
	const sign = offsetMs >= 0 ? "+" : "-";
	const abs = Math.abs(offsetMs);
	const hh = String(Math.floor(abs / 3_600_000)).padStart(2, "0");
	const mm = String(Math.floor((abs % 3_600_000) / 60_000)).padStart(2, "0");
	return `GMT${sign}${hh}:${mm}`;
}

/** Whole minutes between two ISO instants (end − start); negative if reversed. */
export function diffMinutes(startISO: string, endISO: string): number {
	return Math.round((Date.parse(endISO) - Date.parse(startISO)) / 60_000);
}

/** "HH:mm" for a Date's local clock time — for default form values. */
export function localTimeString(date: Date): string {
	return format(date, "HH:mm");
}

/** "HH:mm" (24h) → "4:00 PM" for display. */
export function formatTime12h(hhmm: string): string {
	const [h, m] = hhmm.split(":").map(Number);
	if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
	const period = h < 12 ? "AM" : "PM";
	const h12 = h % 12 === 0 ? 12 : h % 12;
	return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/**
 * Parse a loosely-typed time ("4pm", "4:30 PM", "16:00", "0930", "9") into a
 * canonical "HH:mm" (24h), or null when it isn't a valid time.
 */
export function parseTimeInput(input: string): string | null {
	const s = input.trim().toLowerCase();
	const match = s.match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/);
	if (!match) return null;
	let h = Number(match[1]);
	const min = match[2] ? Number(match[2]) : 0;
	const period = match[3];
	if (min > 59) return null;
	if (period) {
		if (h < 1 || h > 12) return null;
		if (period === "pm" && h !== 12) h += 12;
		if (period === "am" && h === 12) h = 0;
	} else if (h > 23) {
		return null;
	}
	return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Every "HH:mm" slot in a day at the given step (default 15 min). */
export function timeOptions(stepMin = 15): string[] {
	const out: string[] = [];
	for (let m = 0; m < 24 * 60; m += stepMin) {
		out.push(
			`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`,
		);
	}
	return out;
}

function normalizeTime(time: string): string {
	const [h = "0", m = "0"] = time.split(":");
	return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
}

// A fixed reference instant so offset labels are deterministic in tests. Callers
// that care about DST for a specific meeting pass the meeting's own date.
const REF_DATE = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));

// Minimal fallback for runtimes without Intl.supportedValuesOf.
const FALLBACK_TIME_ZONES = [
	"UTC",
	"Asia/Manila",
	"Asia/Singapore",
	"Asia/Tokyo",
	"Asia/Kolkata",
	"Europe/London",
	"Europe/Paris",
	"Europe/Berlin",
	"America/New_York",
	"America/Chicago",
	"America/Denver",
	"America/Los_Angeles",
	"Australia/Sydney",
];
