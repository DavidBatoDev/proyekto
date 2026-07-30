import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy redirect. People management is all on the Team page now; this used to
// point at /settings/permissions, which itself redirects there.
export const Route = createFileRoute("/project/$projectId/settings/team")({
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/project/$projectId/team",
			params: { projectId: params.projectId },
		});
	},
});
