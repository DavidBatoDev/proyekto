import { useQuery } from "@tanstack/react-query";
import { featureLimitInfo } from "@/components/billing/PlanLimitNotice";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useMyWorkspacesQuery } from "@/hooks/useWorkspaceQueries";
import type { EntitlementsStatus } from "@/lib/entitlements";
import type { PlanLimitInfo } from "@/lib/planLimitErrors";
import { getTeam, listTeamMembers, type Team } from "@/services/teams.service";
import type { Workspace } from "@/services/workspaces.service";
import { useUser } from "@/stores/authStore";

export interface TeamMoneyAccess {
	/** True until the team and its members resolve. */
	isLoading: boolean;
	/**
	 * The team or its member list failed to load (a refusal or a failure).
	 * Without them nothing below is known, so callers must not read the flags
	 * as "time tracking is off" or "not an approver".
	 */
	error: unknown;
	team: Team | undefined;
	/**
	 * Team owner, or a member with the owner/admin role: `can_manage_team`,
	 * the same rule the backend uses for the team report, rates and payouts.
	 */
	isApprover: boolean;
	isTeamMember: boolean;
	timeTrackingEnabled: boolean;
	/** teams.member_rates_enabled: the Rates surface. */
	hasRates: boolean;
	/** teams.payouts_enabled: the Payouts surface. */
	canPay: boolean;
	/**
	 * The workspace whose plan governs the team's money (the team's own
	 * workspace). Null for a team whose workspace was deleted.
	 */
	planWorkspaceId: string | null;
	/** That workspace as the caller sees it (slug and role for upgrade links), when they are a member. */
	planWorkspace: Workspace | null;
	/** A granted plan changes through Proyekto, so plan notices skip the upgrade link. */
	isComplimentary: boolean;
	/**
	 * Whether the plan answers below are known yet. Callers that would fire a
	 * plan-gated read (owed balances) wait for "ready" or "unavailable", so a
	 * plan that lacks the feature never trips the app-wide upgrade prompt.
	 */
	planStatus: EntitlementsStatus;
	/**
	 * `time_payouts` is missing from the team's plan: recording payments and
	 * the owed balances are refused (history stays readable and voidable).
	 * Null when the plan has it, and while usage is unknown (fails open).
	 */
	payoutsPlanLimit: PlanLimitInfo | null;
	/**
	 * `time_team_rules` is missing: member rates are kept but price approved
	 * time at 0 until the plan has it again. Null when present or unknown.
	 */
	teamRulesPlanLimit: PlanLimitInfo | null;
}

/**
 * The caller's standing on a team's time and money layer. Shares its query
 * keys with the rest of the team pages (["team", teamId] etc.), so mounting
 * it next to the team Time layout costs no extra requests.
 *
 * Logging time no longer needs a rate (the time rebuild: a rate only prices
 * approved team time), so the old per-caller "has an active rate" lookup is
 * gone.
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

	const team = teamQuery.data;
	const planWorkspaceId = team?.workspace_id ?? null;
	// Plan answers fail open while usage loads or is unreadable; the server
	// re-checks every gated call.
	const entitlements = useEntitlements(planWorkspaceId);
	const workspacesQuery = useMyWorkspacesQuery();
	const planWorkspace =
		(planWorkspaceId &&
			workspacesQuery.data?.find((ws) => ws.id === planWorkspaceId)) ||
		null;

	const error = teamQuery.error ?? membersQuery.error ?? null;
	const isLoading = !error && (teamQuery.isPending || membersQuery.isPending);

	const myMembership = membersQuery.data?.find((m) => m.user_id === user?.id);
	const isApprover =
		Boolean(user?.id) &&
		(team?.owner_id === user?.id ||
			myMembership?.role === "admin" ||
			myMembership?.role === "owner");

	return {
		isLoading,
		error,
		team,
		isApprover,
		isTeamMember: Boolean(myMembership),
		timeTrackingEnabled: team?.time_tracking_enabled === true,
		hasRates: team?.member_rates_enabled === true,
		canPay: team?.payouts_enabled === true,
		planWorkspaceId,
		planWorkspace,
		isComplimentary: entitlements.isComplimentary,
		planStatus: entitlements.status,
		payoutsPlanLimit: featureLimitInfo(entitlements, "time_payouts"),
		teamRulesPlanLimit: featureLimitInfo(entitlements, "time_team_rules"),
	};
}
