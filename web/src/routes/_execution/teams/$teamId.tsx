import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	ensureMyWorkspaces,
	requireAuthenticatedUserId,
	resolveLastVisitedWorkspace,
	throwWorkspacePathRedirect,
} from "@/lib/workspaceRouting";
import { teamKeys } from "@/queries/teams";
import { getTeam } from "@/services/teams.service";

/**
 * Bare /teams/<id>/…: forward to the workspace-scoped twin, keeping the rest
 * of the path and the query string. The pages live under
 * /w/<slug>/teams/$teamId; the leaves below this file are empty shells that
 * exist only so the bare paths stay real routes.
 *
 * The team's OWN workspace wins when the user is in it — a push link to a
 * team's time logs must land in that team's workspace, not whichever one
 * this device visited last. The team lookup 403s for non-members, in which
 * case the last-visited workspace stands in and the page there decides.
 */
export const Route = createFileRoute("/_execution/teams/$teamId")({
	beforeLoad: async ({ params, context, location }) => {
		const userId = requireAuthenticatedUserId(location);
		const workspaces = await ensureMyWorkspaces(context.queryClient, userId);

		const team = await context.queryClient
			.ensureQueryData({
				queryKey: teamKeys.detail(params.teamId),
				queryFn: () => getTeam(params.teamId),
			})
			.catch(() => null);
		const own = team?.workspace_id
			? workspaces.find((workspace) => workspace.id === team.workspace_id)
			: undefined;

		const target =
			own ?? (await resolveLastVisitedWorkspace(context.queryClient, location));
		if (!target) throw redirect({ to: "/dashboard", replace: true });
		throwWorkspacePathRedirect(location.pathname, target.slug);
	},
});
