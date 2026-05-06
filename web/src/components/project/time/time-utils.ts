// @ts-nocheck
//
// REFERENCE: kept as a visual / structural reference for the future
// team-level time pages. Project-level Time page removed in May 2026;
// references removed types and the project-time backend module.
// Restore or rewrite against `team_members.hourly_rate` when re-enabling.

import type { TaskTimeLog } from "@/services/project-time.service";

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

export function initialsFromName(name?: string) {
  const base = (name || "?").trim();
  if (!base) return "?";
  return base
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}