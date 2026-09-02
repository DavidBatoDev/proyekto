import { createFileRoute, redirect } from "@tanstack/react-router";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { CreateWorkspaceCard } from "@/components/workspace/CreateWorkspaceCard";
import { resolveLastVisitedWorkspace } from "@/lib/workspaceRouting";

/**
 * Bare /dashboard: forward to the last-visited workspace's dashboard (or the
 * user's default when this device has none stored). The page itself lives at
 * /w/<slug>/dashboard. Permanent, not transitional — bare paths keep arriving
 * from post-auth continuation, persisted notification links, and push
 * payloads.
 *
 * This is also the only landing for an account with no workspace at all: the
 * server provisions one at signup, so that state should be unreachable, but
 * if the backstop ever fails the user gets a way to create one instead of a
 * redirect loop.
 */
export const Route = createFileRoute("/_execution/dashboard")({
	beforeLoad: async ({ context, location }) => {
		const workspace = await resolveLastVisitedWorkspace(
			context.queryClient,
			location,
		);
		if (workspace) {
			throw redirect({
				to: "/w/$workspaceSlug/dashboard",
				params: { workspaceSlug: workspace.slug },
				search: true,
				replace: true,
			});
		}
	},
	component: NoWorkspaceFallback,
});

function NoWorkspaceFallback() {
	return (
		<DashboardShell>
			<div className="mx-auto max-w-7xl px-4 pt-10 pb-10 sm:px-6 lg:px-8">
				<CreateWorkspaceCard />
			</div>
		</DashboardShell>
	);
}
