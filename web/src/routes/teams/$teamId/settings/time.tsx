import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Loader2, ShieldCheck } from "lucide-react";
import { TeamSettingsLayout } from "@/components/team/TeamSettingsLayout";
import { useToast } from "@/hooks/useToast";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import { useAuthStore, useUser } from "@/stores/authStore";
import { getTeam, updateTeam } from "@/services/teams.service";

export const Route = createFileRoute("/teams/$teamId/settings/time")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
	},
	component: TeamTimeSettings,
});

function TeamTimeSettings() {
	const { teamId } = Route.useParams();
	const user = useUser();
	const toast = useToast();
	const qc = useQueryClient();
	const { data: profile } = useProfileQuery();

	const teamQuery = useQuery({
		queryKey: ["teams", "detail", teamId],
		queryFn: () => getTeam(teamId),
	});

	const team = teamQuery.data;
	const isOwner = team?.owner_id === user?.id;
	// The flag can only be flipped by the team owner, and only when that
	// owner is a consultant-verified profile. For viewers who are not
	// the owner the toggle is read-only with an explainer.
	const isConsultantVerified = Boolean(profile?.is_consultant_verified);
	const canToggle = isOwner && isConsultantVerified;
	const enabled = team?.time_tracking_enabled === true;

	const toggleMutation = useMutation({
		mutationFn: (next: boolean) =>
			updateTeam(teamId, { time_tracking_enabled: next }),
		onSuccess: (updated) => {
			toast.success(
				updated.time_tracking_enabled
					? "Time tracking enabled"
					: "Time tracking disabled",
			);
			qc.invalidateQueries({ queryKey: ["teams", "detail", teamId] });
			qc.invalidateQueries({ queryKey: ["team", teamId] });
			// Sidebar reads from listMyTeams; refetch so the new "Time"
			// sub-link appears (or disappears) immediately.
			qc.invalidateQueries({ queryKey: ["teams", "mine"] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	return (
		<TeamSettingsLayout teamId={teamId} teamName={team?.name}>
			<section className="space-y-3">
				<div className="flex items-center gap-2">
					<Clock className="h-5 w-5 text-slate-700" />
					<h2 className="text-[30px] font-semibold leading-none text-slate-900">
						Time tracking
					</h2>
				</div>

				{teamQuery.isPending ? (
					<div className="flex justify-center p-12">
						<Loader2 className="h-6 w-6 animate-spin text-slate-400" />
					</div>
				) : (
					<div className="app-surface-card-strong overflow-hidden rounded-2xl">
						<div className="space-y-4 px-5 py-6">
							<div className="flex items-start justify-between gap-4">
								<div className="space-y-1">
									<div className="text-sm font-semibold text-slate-900">
										Enable time tracking for this team
									</div>
									<p className="max-w-xl text-sm text-slate-600">
										Members log time on tasks across the projects this team is
										attached to; team owners and admins approve those logs and
										manage per-member rates. Pages live at{" "}
										<Link
											to="/teams/$teamId/time"
											params={{ teamId }}
											className="text-sky-600 hover:underline"
										>
											/teams/{team?.name ?? "…"}/time
										</Link>{" "}
										and{" "}
										<Link
											to="/teams/$teamId/time/manage-rates"
											params={{ teamId }}
											className="text-sky-600 hover:underline"
										>
											/teams/{team?.name ?? "…"}/time/manage-rates
										</Link>
										.
									</p>
								</div>
								<button
									type="button"
									role="switch"
									aria-checked={enabled}
									disabled={!canToggle || toggleMutation.isPending}
									onClick={() => toggleMutation.mutate(!enabled)}
									className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
										enabled ? "bg-emerald-500" : "bg-slate-300"
									}`}
								>
									<span
										className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
											enabled ? "translate-x-5" : "translate-x-0"
										}`}
									/>
								</button>
							</div>

							{!isOwner && (
								<div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
									Only the team owner can change this setting.
								</div>
							)}

							{isOwner && !isConsultantVerified && (
								<div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
									<ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
									<div>
										<div className="font-semibold">
											Consultant verification required
										</div>
										<p className="mt-0.5">
											Time tracking and per-member rates are only available to
											teams owned by a verified consultant. Apply for
											consultant verification to enable this feature.
										</p>
									</div>
								</div>
							)}

							{enabled && (
								<div className="flex flex-wrap gap-2 pt-1">
									<Link
										to="/teams/$teamId/time"
										params={{ teamId }}
										className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
									>
										Open team time
									</Link>
									<Link
										to="/teams/$teamId/time/manage-rates"
										params={{ teamId }}
										className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
									>
										Manage rates
									</Link>
								</div>
							)}
						</div>
					</div>
				)}
			</section>
		</TeamSettingsLayout>
	);
}
