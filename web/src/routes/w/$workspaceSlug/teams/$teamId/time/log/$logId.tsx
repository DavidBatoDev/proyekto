import { createFileRoute, redirect } from "@tanstack/react-router";
import { validateTimePageSearch } from "@/lib/timeSearch";

/**
 * Old deep link to an entry's detail page (ux.md › Routes and Redirects):
 * `…/time/log/:id` → `/time?entry=:id`, for anyone. The Time page opens the
 * entry's detail, or its "doesn't exist or you can't open it" card, so this
 * stub needs no lookup of its own.
 */
export const Route = createFileRoute(
	"/w/$workspaceSlug/teams/$teamId/time/log/$logId",
)({
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/time",
			search: validateTimePageSearch({ entry: params.logId }),
			replace: true,
		});
	},
});
