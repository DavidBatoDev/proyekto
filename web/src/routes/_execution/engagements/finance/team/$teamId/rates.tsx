import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TeamFinanceChrome } from "@/components/finance/team/TeamFinanceChrome";
import { TimeSettingsLink } from "@/components/finance/team/TimeSettingsLink";
import { TeamMoneyGate } from "@/components/team-time/TeamMoneyGate";
import { TeamRatesPanel } from "@/components/team-time/TeamRatesPanel";

/** Member rates, inside the team's finance. */
export const Route = createFileRoute(
	"/_execution/engagements/finance/team/$teamId/rates",
)({
	component: TeamRatesPage,
});

function TeamRatesPage() {
	const { teamId } = Route.useParams();
	const navigate = useNavigate();

	return (
		<TeamFinanceChrome teamId={teamId} section="rates">
			<TeamMoneyGate
				teamId={teamId}
				need="rates"
				settingsLink={<TimeSettingsLink teamId={teamId} />}
			>
				<TeamRatesPanel
					teamId={teamId}
					links={{
						viewMemberLogs: (userId) =>
							void navigate({
								to: "/engagements/finance/team/$teamId/time-logs",
								params: { teamId },
								search: { member: userId },
							}),
					}}
				/>
			</TeamMoneyGate>
		</TeamFinanceChrome>
	);
}
