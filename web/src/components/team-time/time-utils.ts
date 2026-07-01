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
