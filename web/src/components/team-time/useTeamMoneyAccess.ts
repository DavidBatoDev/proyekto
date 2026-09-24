import { useQuery } from "@tanstack/react-query";
import {
	getTeam,
	hasAnyActiveRate,
	listTeamMembers,
	type Team,
} from "@/services/teams.service";
import { useUser } from "@/stores/authStore";

export interface TeamMoneyAccess {
	/** True until the team, its members and the caller's rate check resolve. */
	isLoading: boolean;
	team: Team | undefined;
	/** Team owner, or a member with the owner/admin role. */
	isApprover: boolean;
	isTeamMember: boolean;
	timeTrackingEnabled: boolean;
	/** teams.member_rates_enabled — the Manage Rates surface. */
	hasRates: boolean;
	/** teams.payouts_enabled — the Payouts surface and paying from Team Logs. */
	canPay: boolean;
}

/**
 * The caller's standing on a team's time/money layer. Shares its query keys
 * with the rest of the Time section (["team", teamId] etc.), so mounting it
 * next to the workspace Time layout costs no extra requests.
 */
export function useTeamMoneyAccess(teamId: string): TeamMoneyAccess {
	const user = useUser();

	const teamQuery = useQuery({
		queryKey: ["team", teamId],
		queryFn: () => getTeam(teamId),
	});
	const membersQuery = useQuery({
		queryKey: ["team", teamId, "members"],
		queryFn: () => listTeamMembers(teamId),
	});
	const myActiveRateQuery = useQuery({
		queryKey: ["team", teamId, "rates", "anyActive", user?.id],
		queryFn: () => hasAnyActiveRate(teamId, user!.id),
		enabled: Boolean(user?.id),
	});

	const isLoading =
		teamQuery.isPending ||
		membersQuery.isPending ||
		Boolean(user?.id && myActiveRateQuery.isPending);

	const team = teamQuery.data;
	const myMembership = membersQuery.data?.find((m) => m.user_id === user?.id);
	const isApprover =
		team?.owner_id === user?.id ||
		myMembership?.role === "admin" ||
		myMembership?.role === "owner";

	return {
		isLoading,
		team,
		isApprover,
		isTeamMember: Boolean(myMembership),
		timeTrackingEnabled: team?.time_tracking_enabled === true,
		hasRates: team?.member_rates_enabled === true,
		canPay: team?.payouts_enabled === true,
	};
}
