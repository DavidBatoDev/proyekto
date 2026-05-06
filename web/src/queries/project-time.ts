// @ts-nocheck
//
// REFERENCE: kept alongside the time route + component pages.
// Project-level Time page removed in May 2026; backend project-time
// module is gone, so calls to these functions error at runtime. Code
// kept for shape / query-key patterns when wiring time UI into the
// team detail page.

import type { AxiosError } from "axios";

const RATE_REQUIRED_HINT = "not enabled for time tracking";

export const projectTimeKeys = {
  all: ["project-time"] as const,
  permissions: (projectId: string, actorKey: string) =>
    ["project-time", "permissions", projectId, actorKey] as const,
  myLogs: (projectId: string, actorKey: string, page: number, limit: number) =>
    ["project-time", "my-logs", projectId, actorKey, page, limit] as const,
  myRate: (projectId: string, actorKey: string) =>
    ["project-time", "my-rate", projectId, actorKey] as const,
  teamLogs: (
    projectId: string,
    actorKey: string,
    memberUserId: string,
    page: number,
    limit: number,
    scope: "team" | "approvals" = "team",
  ) =>
    [
      "project-time",
      "team-logs",
      scope,
      projectId,
      actorKey,
      memberUserId,
      page,
      limit,
    ] as const,
  tasks: (projectId: string, actorKey: string) =>
    ["project-time", "tasks", projectId, actorKey] as const,
  rates: (projectId: string, actorKey: string) =>
    ["project-time", "rates", projectId, actorKey] as const,
  teamMembers: (projectId: string, actorKey: string) =>
    ["project-time", "team-members", projectId, actorKey] as const,
};

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}

export function isForbiddenError(error: unknown): boolean {
  const maybeAxiosError = error as AxiosError | undefined;
  if (maybeAxiosError?.response?.status === 403) return true;
  const maybeError = error as { status?: number } | undefined;
  return maybeError?.status === 403;
}

export function isRateRequiredError(error: unknown): boolean {
  const message = getErrorMessage(error, "").toLowerCase();
  return message.includes(RATE_REQUIRED_HINT);
}