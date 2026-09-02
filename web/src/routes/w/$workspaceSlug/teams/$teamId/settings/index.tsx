import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute(
	"/w/$workspaceSlug/teams/$teamId/settings/",
)({
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/w/$workspaceSlug/teams/$teamId/settings/general",
			params: { workspaceSlug: params.workspaceSlug, teamId: params.teamId },
			replace: true,
		});
	},
	component: () => null,
});
