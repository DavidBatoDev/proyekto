import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import {
	featureLimitInfo,
	PlanLimitNotice,
} from "@/components/billing/PlanLimitNotice";
import {
	AppSectionHeader,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { FinanceTrail } from "@/components/finance/nav/FinanceTrail";
import { useToast } from "@/contexts/ToastContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useMyWorkspacesQuery } from "@/hooks/useWorkspaceQueries";
import { isPlanLimitError } from "@/lib/planLimitErrors";
import { timePlanCopy, timePlanDowngradeCopy } from "@/lib/timeErrors";
import { invalidateTime } from "@/queries/time";
import { getTeam, updateTeam } from "@/services/teams.service";
import { useProfile } from "@/stores/authStore";

/**
 * The team's add-on surface inside Engagements finance. The toggle writes the
 * same team flag the team settings page writes; this page exists so module
 * enablement lives where the money does.
 *
 * The old "contract-gated time tracking" dial (teams.contract_enforcement) is
 * gone (C12): the time rebuild never reads it, and an agreement's own
 * tracking terms (`tracking_mode`) cover what it was for. The column drops
 * in M5.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/team/$teamId/addons",
)({
	component: TeamAddonsPage,
});

function TeamAddonsPage() {
	const { teamId } = Route.useParams();
	const profile = useProfile();
	const toast = useToast();
	const queryClient = useQueryClient();

	const teamQuery = useQuery({
		queryKey: ["teams", teamId],
		queryFn: () => getTeam(teamId),
	});
	const team = teamQuery.data;
	const isOwner = Boolean(profile && team && team.owner_id === profile.id);
	const enabled = team?.time_tracking_enabled === true;

	// Turning team time on needs the team workspace's time_tracking plan
	// feature (the server refuses otherwise). Fails open while usage is
	// unknown; turning it off is never gated.
	const workspaceId = team?.workspace_id ?? null;
	const entitlements = useEntitlements(workspaceId);
	const workspacesQuery = useMyWorkspacesQuery();
	const workspace =
		(workspaceId &&
			workspacesQuery.data?.find((ws) => ws.id === workspaceId)) ||
		null;
	const trackingLimit = featureLimitInfo(entitlements, "time_tracking");
	const enableBlocked = trackingLimit !== null && !enabled;

	const patchMutation = useMutation({
		mutationFn: (patch: { time_tracking_enabled: boolean }) =>
			updateTeam(teamId, patch),
		onSuccess: () => {
			// The same keys the team settings switch refreshes: this page's
			// read, the team settings page, the sidebar's team list (its Time
			// sub-item) and the team's For option.
			void queryClient.invalidateQueries({ queryKey: ["teams", teamId] });
			void queryClient.invalidateQueries({
				queryKey: ["teams", "detail", teamId],
			});
			void queryClient.invalidateQueries({ queryKey: ["team", teamId] });
			void queryClient.invalidateQueries({ queryKey: ["teams", "mine"] });
			void invalidateTime(queryClient, "policy");
			toast.success("Add-on settings updated.");
		},
		onError: (error) => {
			// The plan prompt is raised globally (api/axios notifyPlanLimit).
			if (isPlanLimitError(error)) return;
			toast.error(
				error instanceof Error ? error.message : "Failed to update add-ons",
			);
		},
	});

	return (
		<div className="app-shell-bg min-h-full px-5 py-4 md:px-8 md:py-5">
			<div className="mx-auto w-full max-w-4xl">
				<FinanceTrail
					team={{ id: teamId, name: team?.name ?? "Team" }}
					current="Add-ons"
				/>

				<AppSectionHeader
					title="Add-ons"
					subtitle="Modules this team can turn on inside Engagements."
					className="mt-4"
				/>

				<AppSurfaceCard className="mt-5 p-5">
					<div className="flex items-start justify-between gap-4">
						<div className="flex min-w-0 items-start gap-3">
							<span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground/10 text-foreground">
								<Clock className="h-4 w-4" aria-hidden="true" />
							</span>
							<div className="min-w-0">
								<h3 className="text-sm font-semibold text-foreground">Time</h3>
								<p className="mt-0.5 text-xs text-muted-foreground">
									Timers, timesheets and approvals for this team's projects.
									Member rates, payouts and pay cut-offs are set in the team's
									Time settings.
								</p>
							</div>
						</div>
						<label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
							<input
								type="checkbox"
								checked={enabled}
								disabled={!isOwner || patchMutation.isPending || enableBlocked}
								onChange={(event) =>
									patchMutation.mutate({
										time_tracking_enabled: event.target.checked,
									})
								}
								className="h-4 w-4 accent-primary"
							/>
							{enabled ? "Enabled" : "Disabled"}
						</label>
					</div>

					{trackingLimit ? (
						<PlanLimitNotice
							info={trackingLimit}
							workspace={workspace}
							isComplimentary={entitlements.isComplimentary}
							message={
								enabled
									? timePlanDowngradeCopy({ workspaceName: workspace?.name })
									: timePlanCopy("time_tracking", {
											workspaceName: workspace?.name,
										})
							}
							className="mt-4"
						/>
					) : null}

					{!isOwner ? (
						<p className="mt-4 text-xs text-muted-foreground">
							Only the team owner can change add-ons.
						</p>
					) : null}
				</AppSurfaceCard>
			</div>
		</div>
	);
}
