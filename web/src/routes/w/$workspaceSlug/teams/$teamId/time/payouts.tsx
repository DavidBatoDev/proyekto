import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TeamPayoutsPanel } from "@/components/team-time/TeamPayoutsPanel";

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
				openTeamLogs: (search) => {
					navigate({
						to: "/w/$workspaceSlug/teams/$teamId/time/team-logs",
						params: { workspaceSlug, teamId },
						search,
					});
				},
			}}
		/>
	);
}
