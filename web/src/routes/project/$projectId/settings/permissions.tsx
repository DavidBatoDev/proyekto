import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Redirect. Permissions are part of the project's single People page now.
 *
 * A bookmarked `?memberId=` lands on that person's access drawer — the old
 * link meant "show me what this person can do", and the drawer answers that
 * better than the raw matrix did. `?role=` still opens the role-template
 * editor, which has no lighter equivalent. The old `?tab=` values named tabs
 * that no longer exist, so they are dropped rather than mapped.
 */
export const Route = createFileRoute(
	"/project/$projectId/settings/permissions",
)({
	validateSearch: (
		search: Record<string, unknown>,
	): { role?: string; memberId?: string; tab?: string } => ({
		role: (search.role as string) || undefined,
		memberId: (search.memberId as string) || undefined,
		tab: (search.tab as string) || undefined,
	}),
	beforeLoad: ({ params, search }) => {
		throw redirect({
			to: "/project/$projectId/team",
			params: { projectId: params.projectId },
			search: {
				...(search.memberId ? { memberId: search.memberId } : {}),
				...(search.role ? { role: search.role } : {}),
			},
		});
	},
});
