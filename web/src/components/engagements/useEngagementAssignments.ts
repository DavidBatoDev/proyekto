/**
 * Queries and cache refreshes for the engagement page's Assignments section.
 *
 * An assignment changes more than the engagement page: it decides what its
 * worker may log (the For options, `me/projects`, a project's "Who can log
 * time here"), it may place a flexible engagement on a project (the
 * engagement's `project_links`), it may grant the worker editor access (the
 * project's people), and ending one stops the worker's running timer. So a
 * write refreshes all of those.
 */

import {
	type QueryClient,
	queryOptions,
	useQuery,
} from "@tanstack/react-query";
import { hasProjectAdminAccess, isPersonalProject } from "@/lib/projectAccess";
import { projectKeys } from "@/queries/project";
import { invalidateTime } from "@/queries/time";
import type { Engagement } from "@/services/engagement.service";
import {
	type EngagementAssignment,
	engagementAssignmentKeys,
	engagementAssignmentsService,
} from "@/services/engagementAssignments.service";
import { type Project, projectService } from "@/services/project.service";
import { useAuthStore } from "@/stores/authStore";

/** A miss is a 404 by design (party-only), and a 4xx never succeeds on retry. */
function retryAssignments(failureCount: number, error: unknown): boolean {
	const status = (error as { status?: unknown })?.status;
	if (typeof status === "number" && status >= 400 && status < 500) {
		return false;
	}
	return failureCount < 2;
}

export function engagementAssignmentsQuery(engagementId: string) {
	return queryOptions({
		queryKey: engagementAssignmentKeys.list(engagementId),
		queryFn: () => engagementAssignmentsService.list(engagementId),
		staleTime: 30_000,
		refetchOnMount: true,
		retry: retryAssignments,
	});
}

/** `GET /api/engagements/:id/assignments`. */
export function useEngagementAssignments(
	engagementId: string,
	options: { enabled?: boolean } = {},
) {
	return useQuery({
		...engagementAssignmentsQuery(engagementId),
		enabled: Boolean(engagementId) && options.enabled !== false,
	});
}

/** A project the dialog can offer. */
export interface AssignableProject {
	id: string;
	title: string;
	/** On the engagement already (`project_links`); otherwise assigning places it there. */
	linked: boolean;
}

/** The engagement's active linked projects, one per project, in link order. */
export function linkedProjects(engagement: Engagement): AssignableProject[] {
	const seen = new Set<string>();
	const out: AssignableProject[] = [];
	for (const link of engagement.project_links) {
		if (link.status !== "active" || !link.project_id) continue;
		if (seen.has(link.project_id)) continue;
		seen.add(link.project_id);
		out.push({
			id: link.project_id,
			title: link.project_title_snapshot,
			linked: true,
		});
	}
	return out;
}

/**
 * Projects a flexible engagement could be placed on: the caller administers
 * them (the server's `assertCanPlace` asks for project admin), they aren't a
 * personal project, and the engagement isn't on them yet.
 */
export function placeableProjects(
	projects: readonly Project[],
	userId: string | null,
	linkedIds: ReadonlySet<string>,
): AssignableProject[] {
	return projects
		.filter(
			(project) =>
				!linkedIds.has(project.id) &&
				hasProjectAdminAccess(project, userId) &&
				!isPersonalProject(project),
		)
		.map((project) => ({ id: project.id, title: project.title, linked: false }))
		.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Every project the Assign dialog offers: the linked ones first, then (for a
 * flexible engagement) the ones the caller could place it on.
 */
export function useAssignableProjects(
	engagement: Engagement,
	options: { enabled?: boolean } = {},
) {
	const userId = useAuthStore((state) => state.user?.id ?? null);
	const linked = linkedProjects(engagement);
	const flexible = engagement.scope_mode === "flexible";
	const query = useQuery({
		queryKey: engagementAssignmentKeys.placeableProjects(userId),
		queryFn: () => projectService.list(),
		enabled: flexible && Boolean(userId) && options.enabled !== false,
		staleTime: 30_000,
		retry: retryAssignments,
	});
	const linkedIds = new Set(linked.map((project) => project.id));
	const others =
		flexible && query.data
			? placeableProjects(query.data, userId, linkedIds)
			: [];
	return {
		projects: [...linked, ...others],
		/** Still loading the placeable list (linked projects are known at once). */
		loading: flexible && Boolean(userId) && query.isPending,
		failed: flexible && query.isError,
	};
}

/** True when this worker already has an active assignment on the project. */
export function isAlreadyAssigned(
	rows: readonly EngagementAssignment[],
	projectId: string,
	options: { self: boolean; viewerId: string | null },
): boolean {
	return rows.some(
		(row) =>
			row.status === "active" &&
			row.project_id === projectId &&
			(!options.self || row.worker_user_id === options.viewerId),
	);
}

/** After an assignment is created or ended: everything it can change. */
export async function invalidateAfterAssignmentChange(
	queryClient: QueryClient,
	engagementId: string,
	projectId: string | null,
): Promise<void> {
	const keys: Array<readonly unknown[]> = [
		// The detail (project_links) and, under it, the assignments list.
		["engagement", engagementId],
		["engagements"],
	];
	if (projectId) {
		keys.push(projectKeys.members(projectId), projectKeys.detail(projectId));
	}
	await Promise.all([
		...keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
		// For options, me/projects, loggers, the running timer an end stops.
		invalidateTime(queryClient, ["entry", "policy"]),
	]);
}
