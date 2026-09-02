import { createFileRoute, redirect } from "@tanstack/react-router";
import { resolveLastVisitedWorkspace } from "@/lib/workspaceRouting";

/**
 * Bare /teams: forward to the last-visited workspace's team list. The page
 * itself lives at /w/<slug>/teams. Permanent, not transitional — bare paths
 * keep arriving from persisted notification links and push payloads.
 */
export const Route = createFileRoute("/_execution/teams/")({
	beforeLoad: async ({ context, location }) => {
		const workspace = await resolveLastVisitedWorkspace(
			context.queryClient,
			location,
		);
		if (!workspace) throw redirect({ to: "/dashboard", replace: true });
		throw redirect({
			to: "/w/$workspaceSlug/teams",
			params: { workspaceSlug: workspace.slug },
			search: true,
			replace: true,
		});
	},
});
