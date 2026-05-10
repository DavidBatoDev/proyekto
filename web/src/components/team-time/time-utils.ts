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
