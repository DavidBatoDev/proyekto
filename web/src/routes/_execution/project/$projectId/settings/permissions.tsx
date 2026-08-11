import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Redirect. Permissions have their own dedicated page now, under the Team
 * section rather than Settings.
 *
 * A bookmarked `?memberId=` lands on that person's access drawer on the
 * Members page — the old link meant "show me what this person can do", and
 * the drawer answers that better than the raw matrix did. `?role=` still
 * opens the role-template editor on the new Permissions page, which has no
 * lighter equivalent. The old `?tab=` values named tabs that no longer
 * exist, so they are dropped rather than mapped.
 */
export const Route = createFileRoute(
	"/_execution/project/$projectId/settings/permissions",
)({
	validateSearch: (
		search: Record<string, unknown>,
	): { role?: string; memberId?: string; tab?: string } => ({
		role: (search.role as string) || undefined,
		memberId: (search.memberId as string) || undefined,
		tab: (search.tab as string) || undefined,
	}),
	beforeLoad: ({ params, search }) => {
		if (search.role) {
			throw redirect({
				to: "/project/$projectId/team/permissions",
				params: { projectId: params.projectId },
				search: { role: search.role },
			});
		}
		throw redirect({
			to: "/project/$projectId/team",
			params: { projectId: params.projectId },
			search: search.memberId ? { memberId: search.memberId } : {},
		});
	},
});
