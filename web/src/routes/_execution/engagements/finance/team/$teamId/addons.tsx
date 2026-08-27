import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock, FileSignature } from "lucide-react";
import {
	AppSectionHeader,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import {
	FINANCE_CRUMB_LINK_CLASS,
	FinanceBreadcrumbs,
	FinanceCurrentCrumb,
} from "@/components/finance/portfolio/FinanceBreadcrumbs";
import { useToast } from "@/contexts/ToastContext";
import { getTeam, updateTeam } from "@/services/teams.service";
import { useProfile } from "@/stores/authStore";

/**
 * The team's add-on surface inside Engagements finance. Add-ons are free
 * today; the toggles write the same team flags the settings pages always
 * wrote — this page exists so module enablement lives where the money does.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/team/$teamId/addons",
)({
	component: TeamAddonsPage,
});

const ENFORCEMENT_OPTIONS: Array<{
	value: "off" | "warn" | "enforce";
	label: string;
	description: string;
}> = [
	{
		value: "off",
		label: "Off",
		description: "Anyone on the team can log time (grandfathered default).",
	},
	{
		value: "warn",
		label: "Warn",
		description:
			"Members without a signed contract can still log time, but see a warning and their logs are flagged for review.",
	},
	{
		value: "enforce",
		label: "Enforce",
		description:
			"The timer refuses to start for members without a signed contract on the project.",
	},
];

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

	const patchMutation = useMutation({
		mutationFn: (patch: {
			time_tracking_enabled?: boolean;
			contract_enforcement?: "off" | "warn" | "enforce";
		}) => updateTeam(teamId, patch),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["teams", teamId] });
			toast.success("Add-on settings updated.");
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : "Failed to update add-ons",
			);
		},
	});

	return (
		<div className="app-shell-bg min-h-full px-5 py-4 md:px-8 md:py-5">
			<div className="mx-auto w-full max-w-4xl">
				<FinanceBreadcrumbs
					items={[
						<Link
							key="engagements"
							to="/engagements"
							className={FINANCE_CRUMB_LINK_CLASS}
						>
							Engagements
						</Link>,
						<Link
							key="team"
							to="/engagements/finance/team/$teamId"
							params={{ teamId }}
							className={FINANCE_CRUMB_LINK_CLASS}
						>
							{team?.name ?? "Team finance"}
						</Link>,
						<FinanceCurrentCrumb key="addons">Add-ons</FinanceCurrentCrumb>,
					]}
				/>

				<AppSectionHeader
					title="Add-ons"
					subtitle="Modules this team can enable inside Engagements. Everything here is free today."
					className="mt-4"
				/>

				<AppSurfaceCard className="mt-5 p-5">
					<div className="flex items-start justify-between gap-4">
						<div className="flex min-w-0 items-start gap-3">
							<span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground/10 text-foreground">
								<Clock className="h-4 w-4" />
							</span>
							<div className="min-w-0">
								<h3 className="text-sm font-semibold text-slate-900">Time</h3>
								<p className="mt-0.5 text-xs text-slate-600">
									Timers, time logs, approvals, rates, and payouts for this
									team. Free.
								</p>
							</div>
						</div>
						<label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
							<input
								type="checkbox"
								checked={team?.time_tracking_enabled ?? false}
								disabled={!isOwner || patchMutation.isPending}
								onChange={(event) =>
									patchMutation.mutate({
										time_tracking_enabled: event.target.checked,
									})
								}
								className="h-4 w-4 accent-slate-900"
							/>
							{team?.time_tracking_enabled ? "Enabled" : "Disabled"}
						</label>
					</div>

					{team?.time_tracking_enabled ? (
						<div className="mt-5 border-t border-slate-200 pt-4">
							<div className="flex items-start gap-3">
								<span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground/10 text-foreground">
									<FileSignature className="h-4 w-4" />
								</span>
								<div className="min-w-0">
									<h4 className="text-sm font-semibold text-slate-900">
										Contract-gated time tracking
									</h4>
									<p className="mt-0.5 text-xs text-slate-600">
										Require a signed contract before members can log time.
									</p>
								</div>
							</div>
							<div className="mt-3 space-y-2 pl-12">
								{ENFORCEMENT_OPTIONS.map((option) => (
									<label
										key={option.value}
										className="flex cursor-pointer items-start gap-2.5"
									>
										<input
											type="radio"
											name="contract-enforcement"
											value={option.value}
											checked={
												(team?.contract_enforcement ?? "off") === option.value
											}
											disabled={!isOwner || patchMutation.isPending}
											onChange={() =>
												patchMutation.mutate({
													contract_enforcement: option.value,
												})
											}
											className="mt-0.5 h-4 w-4 accent-slate-900"
										/>
										<span className="min-w-0">
											<span className="text-sm font-medium text-slate-900">
												{option.label}
											</span>
											<span className="block text-xs text-slate-600">
												{option.description}
											</span>
										</span>
									</label>
								))}
							</div>
						</div>
					) : null}

					{!isOwner ? (
						<p className="mt-4 text-xs text-slate-500">
							Only the team owner can change add-ons.
						</p>
					) : null}
				</AppSurfaceCard>
			</div>
		</div>
	);
}
