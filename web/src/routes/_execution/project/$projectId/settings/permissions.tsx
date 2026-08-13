import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Redirect. Permissions have their own dedicated page now, under the Team
 * section rather than Settings.
 *
 * A bookmarked `?memberId=` lands on that person's permission editor. Legacy
 * `?role=` and `?tab=` values named views that no longer exist, so they are
 * accepted during parsing and dropped during the redirect.
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
		throw redirect({
			to: "/project/$projectId/team",
			params: { projectId: params.projectId },
			search: search.memberId ? { memberId: search.memberId } : {},
		});
	},
});
