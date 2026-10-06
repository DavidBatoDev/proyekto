import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TeamRatesPanel } from "@/components/team-time/TeamRatesPanel";
import type { TeamTimeReportSearch } from "@/lib/timeSearch";

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
				viewMemberTime: (userId) => {
					// The team Report (the Time index), filtered to this person.
					const search: TeamTimeReportSearch = { person: userId };
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
