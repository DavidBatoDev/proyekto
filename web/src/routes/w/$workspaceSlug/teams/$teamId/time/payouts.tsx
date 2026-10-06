import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TeamPayoutsPanel } from "@/components/team-time/TeamPayoutsPanel";
import type { TeamTimeReportSearch } from "@/lib/timeSearch";

export const Route = createFileRoute(
	"/w/$workspaceSlug/teams/$teamId/time/payouts",
)({
	component: PayoutsRoute,
});

// Page body lives in TeamPayoutsPanel so the Engagements → Finance → Team page
// can render the same implementation; the Time layout (route.tsx) owns the
// chrome and gating here.
function PayoutsRoute() {
	const { workspaceSlug, teamId } = Route.useParams();
	const navigate = useNavigate();

	return (
		<TeamPayoutsPanel
			teamId={teamId}
			links={{
				// "Review" opens the team Report (the Time index) on one person
				// and one cut-off, where their not-yet-approved time shows.
				openReport: (search: TeamTimeReportSearch) => {
					void navigate({
						to: "/w/$workspaceSlug/teams/$teamId/time",
						params: { workspaceSlug, teamId },
						search,
					});
				},
			}}
		/>
	);
}
