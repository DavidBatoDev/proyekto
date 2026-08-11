import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_execution/teams/$teamId/settings/")({
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/teams/$teamId/settings/general",
			params: { teamId: params.teamId },
			replace: true,
		});
	},
	component: () => null,
});
