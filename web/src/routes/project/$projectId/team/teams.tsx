import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/project/$projectId/team/teams")({
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/project/$projectId/team",
			params: { projectId: params.projectId },
		});
	},
});
