import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TeamRatesPanel } from "@/components/team-time/TeamRatesPanel";

export const Route = createFileRoute(
	"/w/$workspaceSlug/teams/$teamId/time/manage-rates/",
)({
	component: ManageRatesTab,
});

// Page body lives in TeamRatesPanel so the Engagements → Finance → Team page
// can render the same implementation; the Time layout (route.tsx) owns the
// chrome and gating here.
function ManageRatesTab() {
	const { workspaceSlug, teamId } = Route.useParams();
	const navigate = useNavigate();

	return (
		<TeamRatesPanel
			teamId={teamId}
			links={{
				viewMemberLogs: (userId) => {
					// Team Logs, pre-filtered to this member (replaces the old
					// per-member sub-page).
					void navigate({
						to: "/w/$workspaceSlug/teams/$teamId/time/team-logs",
						params: { workspaceSlug, teamId },
						search: { member: userId },
					});
				},
			}}
		/>
	);
}
