// web/src/components/time/timer/liveDuration.ts
//
// Live clocks for a running time entry, in server time.
//
// A running entry's `started_at` and `paused_at` are server-stamped, so "now"
// is the server's clock (`serverNow`), not the device's: a device clock a
// minute slow would otherwise hold a fresh timer at 00:00:00. Pause state lives
// on the server (`paused_at`, `break_seconds`), so a break survives a refresh,
// a crash or a move to another device.
//
// Ported from the old `components/team-time/time-utils.ts` helpers, which
// went with the old team-time pages. The Needs review threshold (10 h) lives in
// `components/time/entries/entryRules.ts` (`NEEDS_REVIEW_SECONDS`).

import { useEffect, useState } from "react";
import { serverNow } from "@/lib/serverClock";
import type { TimeEntryView } from "@/services/time.types";

/** The fields a live clock reads. */
export type LiveEntry = Pick<
	TimeEntryView,
	| "started_at"
	| "ended_at"
	| "paused_at"
	| "duration_seconds"
	| "break_seconds"
	| "break_minutes"
>;

function parseMs(value: string | null | undefined): number | null {
	if (!value) return null;
	const ms = new Date(value).getTime();
	return Number.isNaN(ms) ? null : ms;
}

/** Break seconds banked on the row, ignoring a pause in progress. */
export function bankedBreakSeconds(entry: Partial<LiveEntry>): number {
	const seconds =
		typeof entry.break_seconds === "number"
			? entry.break_seconds
			: (entry.break_minutes ?? 0) * 60;
	return Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
}

/** Live break total, including the pause in progress. */
export function liveBreakSeconds(
	entry: Partial<LiveEntry>,
	nowMs: number,
): number {
	const banked = bankedBreakSeconds(entry);
	const pausedAt = parseMs(entry.paused_at);
	if (pausedAt === null || entry.ended_at) return banked;
	return banked + Math.max(0, Math.floor((nowMs - pausedAt) / 1000));
}

/**
 * Live worked seconds, net of breaks. While paused the clock is frozen at
 * `paused_at` (breaks are not work). A finished entry reads its stored
 * duration.
 */
export function liveWorkSeconds(
	entry: Partial<LiveEntry>,
	nowMs: number,
): number {
	if (entry.ended_at) return Math.max(0, entry.duration_seconds ?? 0);
	const started = parseMs(entry.started_at);
	if (started === null) return Math.max(0, entry.duration_seconds ?? 0);
	const pausedAt = parseMs(entry.paused_at);
	const upTo = pausedAt === null ? nowMs : Math.min(nowMs, pausedAt);
	return Math.max(
		0,
		Math.floor((upTo - started) / 1000) - bankedBreakSeconds(entry),
	);
}

function pad(value: number): string {
	return value.toString().padStart(2, "0");
}

/** `01:12:44`: the running clock. */
export function formatClock(totalSeconds: number): string {
	const safe = Math.max(0, Math.floor(totalSeconds || 0));
	const h = Math.floor(safe / 3600);
	const m = Math.floor((safe % 3600) / 60);
	const s = safe % 60;
	return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** `1:12`: `h:mm`, the table format (ux.md › Formats). */
export function formatHoursMinutes(totalSeconds: number): string {
	const safe = Math.max(0, Math.floor(totalSeconds || 0));
	const h = Math.floor(safe / 3600);
	const m = Math.floor((safe % 3600) / 60);
	return `${h}:${pad(m)}`;
}

/** `05:30`: a break countdown (minutes and seconds). */
export function formatBreak(totalSeconds: number): string {
	const safe = Math.max(0, Math.floor(totalSeconds || 0));
	return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`;
}

// ── One shared 1 Hz tick ────────────────────────────────────────────────────
//
// Every live clock subscribes to one interval, so a page with many rows costs
// one timer. Components that are not subscribed (and finished entries) never
// re-render on the tick.

let tickHandle: ReturnType<typeof setInterval> | null = null;
const subscribers = new Set<(now: number) => void>();

function startTick(): void {
	if (tickHandle !== null) return;
	tickHandle = setInterval(() => {
		const now = serverNow();
		for (const subscriber of subscribers) subscriber(now);
	}, 1000);
}

function stopTickIfIdle(): void {
	if (subscribers.size > 0 || tickHandle === null) return;
	clearInterval(tickHandle);
	tickHandle = null;
}

/** Test helper: how many components listen to the tick. */
export function liveTickSubscriberCount(): number {
	return subscribers.size;
}

/**
 * The server-corrected "now", updated once a second while `active`. Inactive
 * callers get the value from their first render and never re-render on the
 * tick.
 */
export function useLiveNowMs(active: boolean): number {
	const [now, setNow] = useState(() => serverNow());
	useEffect(() => {
		if (!active) return;
		setNow(serverNow());
		subscribers.add(setNow);
		startTick();
		return () => {
			subscribers.delete(setNow);
			stopTickIfIdle();
		};
	}, [active]);
	return now;
}
