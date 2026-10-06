// web/src/components/time/forms/useLoggableProjects.ts
//
// The projects a person can put time on (A9, `GET /time/me/projects`): every
// project where they hold `time.log` and have at least one For option
// (ux.md › Timer › Picker order, CHANGE-1, CHANGE-12). A project with no
// option is never listed, so the pickers never offer a dead end.
//
// The server orders the list most recently logged first, then by title, and
// caches it for 30 s per user (D82 accepts that staleness). The web keeps that
// order and only sinks archived projects to the bottom. The default project is
// the most recently logged one (ux.md: "The default is the most recently
// logged project"), unless the caller names one that is in the list.

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { timeQueries } from "@/queries/time";
import type {
	MyTimeProject,
	MyTimeProjectsResult,
} from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";

/** Statuses the pickers sink below the rest (still loggable: the resolver allows them). */
const SUNK_STATUSES: ReadonlySet<string> = new Set(["archived"]);

/** True for a project the pickers show last, muted. */
export function isArchivedProject(
	project: Pick<MyTimeProject, "status"> | null | undefined,
): boolean {
	return Boolean(project?.status && SUNK_STATUSES.has(project.status));
}

/** The server's order (most recently logged first), archived projects last. */
export function orderLoggableProjects(
	projects: readonly MyTimeProject[] | null | undefined,
): MyTimeProject[] {
	const list = (projects ?? []).filter(
		(project): project is MyTimeProject =>
			Boolean(project?.id) && (project.options ?? 1) > 0,
	);
	return [
		...list.filter((project) => !isArchivedProject(project)),
		...list.filter((project) => isArchivedProject(project)),
	];
}

/**
 * The project a new entry starts on: `preferred` when it is loggable, else the
 * first of the ordered list (the most recently logged, never an archived one
 * while another exists). Null when the list is empty.
 */
export function defaultLoggableProjectId(
	ordered: readonly MyTimeProject[],
	preferred?: string | null,
): string | null {
	if (preferred && ordered.some((project) => project.id === preferred)) {
		return preferred;
	}
	return ordered[0]?.id ?? null;
}

/** The title a picker shows for a project. */
export function projectTitle(
	project: Pick<MyTimeProject, "title"> | null | undefined,
): string {
	return project?.title?.trim() || "Untitled project";
}

export interface UseLoggableProjectsOptions {
	enabled?: boolean;
	/** A project to default to when it is loggable (`?project=` on /time). */
	preferredProjectId?: string | null;
}

export interface LoggableProjects {
	/** Ordered: most recently logged first, archived last. */
	projects: MyTimeProject[];
	byId: ReadonlyMap<string, MyTimeProject>;
	defaultProjectId: string | null;
	/** More than 200 loggable projects: the least recently logged were left out. */
	truncated: boolean;
	isLoading: boolean;
	isError: boolean;
	error: unknown;
	/** Loaded, and nothing to log on. */
	isEmpty: boolean;
	query: UseQueryResult<MyTimeProjectsResult, unknown>;
}

export function useLoggableProjects(
	options: UseLoggableProjectsOptions = {},
): LoggableProjects {
	const userId = useAuthStore((state) => state.user?.id ?? null);
	const query = useQuery({
		...timeQueries.myProjects(userId),
		enabled: Boolean(userId) && options.enabled !== false,
	});
	const data = query.data;
	const projects = useMemo(() => orderLoggableProjects(data?.projects), [data]);
	const byId = useMemo(
		() => new Map(projects.map((project) => [project.id, project] as const)),
		[projects],
	);
	const defaultProjectId = useMemo(
		() => defaultLoggableProjectId(projects, options.preferredProjectId),
		[projects, options.preferredProjectId],
	);
	return {
		projects,
		byId,
		defaultProjectId,
		truncated: data?.truncated === true,
		isLoading: query.isPending && query.fetchStatus !== "idle",
		isError: query.isError,
		error: query.error,
		isEmpty: query.isSuccess && projects.length === 0,
		query,
	};
}
