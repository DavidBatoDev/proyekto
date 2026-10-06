import { createFileRoute, redirect } from "@tanstack/react-router";
import type { TeamTimeReportSearch } from "@/lib/timeSearch";

// The per-member page was retired: a member's time is the team Report
// filtered to them. This route stays only to redirect old links (bookmarks,
// old notifications) to that Report (`/w/<slug>/teams/<t>/time?person=<u>`).
// A non-uuid id drops out in the Report's search validation.
export const Route = createFileRoute(
	"/w/$workspaceSlug/teams/$teamId/time/manage-rates/$userId",
)({
	beforeLoad: ({ params }) => {
		const search: TeamTimeReportSearch = { person: params.userId };
		throw redirect({
			to: "/w/$workspaceSlug/teams/$teamId/time",
			params: { workspaceSlug: params.workspaceSlug, teamId: params.teamId },
			search,
		});
	},
});
