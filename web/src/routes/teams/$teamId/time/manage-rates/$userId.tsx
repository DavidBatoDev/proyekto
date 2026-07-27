import { createFileRoute, redirect } from "@tanstack/react-router";

// The per-member logs page was retired: "View logs" now opens Team Logs
// pre-filtered to the member. This route stays only to redirect any old links
// (e.g. bookmarks) to that filtered Team Logs view.
export const Route = createFileRoute("/teams/$teamId/time/manage-rates/$userId")(
	{
		beforeLoad: ({ params }) => {
			throw redirect({
				to: "/teams/$teamId/time/team-logs",
				params: { teamId: params.teamId },
				search: { member: params.userId },
			});
		},
	},
);
