import { useEffect, useState } from "react";
import type { TaskTimeLog } from "@/services/team-time.service";

export const formatDateTime = (value?: string | null) => {
	if (!value) return "-";
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return "-";
	return parsed.toLocaleString();
};

export const toLocalDateTimeInput = (value?: string | null) => {
	if (!value) return "";
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return "";
	const offset = parsed.getTimezoneOffset();
	const local = new Date(parsed.getTime() - offset * 60_000);
	return local.toISOString().slice(0, 16);
};

export const fromLocalDateTimeInput = (value: string) => {
	if (!value) return undefined;
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return undefined;
	return parsed.toISOString();
};

export const liveDurationSecondsFromLog = (log: TaskTimeLog, nowMs: number) => {
	if (log.ended_at) return log.duration_seconds ?? 0;
	const started = new Date(log.started_at).getTime();
	if (Number.isNaN(started)) return log.duration_seconds ?? 0;
	return Math.max(0, Math.floor((nowMs - started) / 1000));
};

/** Display name for a log's member, falling back through name parts to the raw id. */
export function memberLabel(log: TaskTimeLog): string {
	return (
		log.member?.display_name ||
		[log.member?.first_name, log.member?.last_name]
			.filter(Boolean)
			.join(" ")
			.trim() ||
		log.member?.email ||
		log.member_user_id ||
		"Unknown member"
	);
}

export function initialsFromName(name?: string | null) {
	const base = (name || "?").trim();
	if (!base) return "?";
	return base
		.split(" ")
		.map((part) => part[0])
		.join("")
		.slice(0, 2)
		.toUpperCase();
}

export function formatMoney(amount: number, currency: string): string {
	return new Intl.NumberFormat(undefined, {
		style: "currency",
		currency: currency || "USD",
	}).format(amount);
}

export function formatHours(seconds: number | null | undefined): string {
	if (!seconds || seconds <= 0) return "0.00";
	return (seconds / 3600).toFixed(2);
}

// ─── log time-range formatting (shared by My Logs + Team Logs) ───────
const TIME_ONLY_FORMATTER = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
});
const SHORT_DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
});

/** A log's start time, formatted time-only (em dash on an invalid date). */
export function formatLogStart(started: Date): string {
	return Number.isNaN(started.getTime()) ? "—" : TIME_ONLY_FORMATTER.format(started);
}

/**
 * A log's end time. Time-only when it lands on the same calendar day as the
 * start; includes the short date otherwise — so a multi-day log reads
 * "09:02 PM – Jun 30, 09:02 PM" instead of a misleading "09:02 PM – 09:02 PM".
 */
export function formatLogEnd(started: Date, ended: Date): string {
	if (Number.isNaN(ended.getTime())) return "—";
	return started.toDateString() === ended.toDateString()
		? TIME_ONLY_FORMATTER.format(ended)
		: SHORT_DATE_TIME_FORMATTER.format(ended);
}

/**
 * Logs longer than this are almost always a timer someone forgot to stop.
 * Used to flag them in the UI and to confirm before recording on stop.
 */
export const LONG_LOG_THRESHOLD_SECONDS = 16 * 3600; // 16h

/** True for a completed log whose duration exceeds LONG_LOG_THRESHOLD_SECONDS. */
export function isUnusuallyLongLog(log: TaskTimeLog): boolean {
	if (!log.ended_at) return false;
	return (log.duration_seconds ?? 0) > LONG_LOG_THRESHOLD_SECONDS;
}

/**
 * When stopping a timer that has run unusually long, ask the user to confirm
 * before recording it — a forgotten timer would otherwise log a large amount
 * of billable time. Returns true when it is safe to proceed with the stop.
 */
export function confirmStopLongTimer(elapsedSeconds: number): boolean {
	if (elapsedSeconds <= LONG_LOG_THRESHOLD_SECONDS) return true;
	const hours = (elapsedSeconds / 3600).toFixed(1);
	return window.confirm(
		`This timer has been running for ${hours} hours — unusually long, and a ` +
			`forgotten timer will record a large amount of billable time.\n\n` +
			`Stop and record it anyway?`,
	);
}

/** Semantic badge classes for a time-log status. Shared across grids/inbox. */
export function statusBadgeClass(status: string): string {
	if (status === "approved") return "bg-emerald-100 text-emerald-700";
	if (status === "paid") return "bg-indigo-100 text-indigo-700";
	if (status === "rejected") return "bg-rose-100 text-rose-700";
	if (status === "running") return "bg-sky-100 text-sky-700";
	if (status === "mixed") return "bg-slate-100 text-slate-700";
	return "bg-amber-100 text-amber-700"; // pending
}

/** Fee for one log from its own rate/duration snapshot (0 if still running). */
export function logFee(log: TaskTimeLog): number {
	const rate = Number(log.rate_snapshot ?? 0);
	const seconds = log.duration_seconds ?? 0;
	if (!Number.isFinite(rate) || rate <= 0 || seconds <= 0) return 0;
	return (seconds / 3600) * rate;
}

// ─── live "now" subscription ─────────────────────────────────────────
//
// A single shared 1Hz timer drives every cell that needs a live
// duration. Each subscriber gets re-rendered when the tick fires;
// non-subscribed components (and any cell rendered for a finished log)
// stay at their initial Date.now() value and don't re-render.
//
// This lets the time-tracking grids keep their `columns` array stable
// across ticks. Without it, putting `liveNowMs` in the grid's state
// caused TanStack Table to rebuild the row model every second and
// re-render every cell — visibly thrashing any open popover menus.

let nowTimerHandle: number | null = null;
const nowSubscribers = new Set<(now: number) => void>();

function startNowTimerIfNeeded() {
	if (nowTimerHandle !== null) return;
	nowTimerHandle = window.setInterval(() => {
		const now = Date.now();
		nowSubscribers.forEach((cb) => cb(now));
	}, 1000);
}

function stopNowTimerIfIdle() {
	if (nowSubscribers.size > 0) return;
	if (nowTimerHandle === null) return;
	window.clearInterval(nowTimerHandle);
	nowTimerHandle = null;
}

/**
 * Subscribes the calling component to a 1Hz "now" tick when `active`
 * is true. Returns the latest Date.now() (or the value at first render
 * when `active` is false). Many simultaneous subscribers share one
 * setInterval, so cost stays O(1) regardless of row count.
 */
export function useLiveNowMs(active: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		nowSubscribers.add(setNow);
		startNowTimerIfNeeded();
		return () => {
			nowSubscribers.delete(setNow);
			stopNowTimerIfIdle();
		};
	}, [active]);
	return now;
}
