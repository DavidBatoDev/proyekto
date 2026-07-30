import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Redirect. Attached teams are collapsible groups inside the project's single
 * People page now, so there is no separate teams surface to land on.
 */
export const Route = createFileRoute("/project/$projectId/settings/teams")({
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/project/$projectId/team",
			params: { projectId: params.projectId },
			search: {},
		});
	},
});
