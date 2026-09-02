import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	resolveLastVisitedWorkspace,
	throwWorkspacePathRedirect,
} from "@/lib/workspaceRouting";

/**
 * Bare /workspace[/settings/…]: forward to /w/<slug>/settings/… for the
 * last-visited workspace. The settings pages themselves live under
 * routes/w/$workspaceSlug/settings/; the leaves below this file are empty
 * shells that keep the bare paths real routes for persisted links.
 */
export const Route = createFileRoute("/workspace")({
	beforeLoad: async ({ context, location }) => {
		const workspace = await resolveLastVisitedWorkspace(
			context.queryClient,
			location,
		);
		if (!workspace) throw redirect({ to: "/dashboard", replace: true });
		throwWorkspacePathRedirect(location.pathname, workspace.slug);
	},
});
