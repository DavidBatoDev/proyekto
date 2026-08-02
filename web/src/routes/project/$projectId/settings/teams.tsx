import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Redirect. Attached teams have their own dedicated management page now,
 * under the Team section rather than Settings.
 */
export const Route = createFileRoute("/project/$projectId/settings/teams")({
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/project/$projectId/team/teams",
			params: { projectId: params.projectId },
			search: {},
		});
	},
});
