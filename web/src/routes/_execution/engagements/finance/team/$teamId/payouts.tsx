import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TeamFinanceChrome } from "@/components/finance/team/TeamFinanceChrome";
import { TimeSettingsLink } from "@/components/finance/team/TimeSettingsLink";
import { TeamMoneyGate } from "@/components/team-time/TeamMoneyGate";
import { TeamPayoutsPanel } from "@/components/team-time/TeamPayoutsPanel";
import type { TeamTimeReportSearch } from "@/lib/timeSearch";

/** Payouts owed and recorded, inside the team's finance. */
export const Route = createFileRoute(
	"/_execution/engagements/finance/team/$teamId/payouts",
)({
	component: TeamPayoutsPage,
});

function TeamPayoutsPage() {
	const { teamId } = Route.useParams();
	const navigate = useNavigate();

	return (
		<TeamFinanceChrome teamId={teamId} section="payouts">
			<TeamMoneyGate
				teamId={teamId}
				need="payouts"
				settingsLink={<TimeSettingsLink teamId={teamId} />}
			>
				<TeamPayoutsPanel
					teamId={teamId}
					links={{
						// "Review" opens the finance Time tab (the team Report) on one
						// person and one cut-off.
						openReport: (search: TeamTimeReportSearch) =>
							void navigate({
								to: "/engagements/finance/team/$teamId/time-logs",
								params: { teamId },
								search,
							}),
					}}
				/>
			</TeamMoneyGate>
		</TeamFinanceChrome>
	);
}
