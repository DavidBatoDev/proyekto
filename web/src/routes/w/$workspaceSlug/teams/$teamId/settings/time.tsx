import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ChevronRight, Clock, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { TeamSettingsLayout } from "@/components/team/TeamSettingsLayout";
import { PayPeriodSettingsCard } from "@/components/team-time/PayPeriodSettingsCard";
import { SettingSwitch } from "@/components/team-time/SettingSwitch";
import { useToast } from "@/hooks/useToast";
import { getTeam, updateTeam } from "@/services/teams.service";
import { useAuthStore, useUser } from "@/stores/authStore";

/** Polar helper: a point on the clock face, measuring clockwise from 12. */
function clockPoint(degrees: number, radius: number) {
	const radians = ((degrees - 90) * Math.PI) / 180;
	return {
		x: 60 + radius * Math.cos(radians),
		y: 60 + radius * Math.sin(radians),
	};
}

const CLOCK_TICKS = Array.from({ length: 12 }, (_, i) => i * 30);
/** Elapsed sweep, 12 o'clock round to 2 — the same hour the hands read. */
const SWEEP_END = clockPoint(60, 48);

/**
 * The empty-state illustration: a ghosted clock face, drawn as inline SVG off
 * the theme's CSS variables (rather than an asset or hardcoded hex) so it
 * tracks light/dark and any brand-colour change automatically.
 *
 * The accent arc sweeps the same hour the hands read, so the drawing says
 * "elapsed time" rather than just "a clock".
 */
function GhostClock({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden
			viewBox="0 0 120 120"
			className={className}
			fill="none"
			role="presentation"
		>
			{/* Outer halo, echoing the soft ground the other empty states sit on. */}
			<circle
				cx="60"
				cy="60"
				r="56"
				stroke="var(--border)"
				strokeWidth="1"
				opacity="0.55"
			/>

			{/* Elapsed sweep: 12 → 2, drawn outside the face. */}
			<path
				d={`M 60 12 A 48 48 0 0 1 ${SWEEP_END.x.toFixed(2)} ${SWEEP_END.y.toFixed(2)}`}
				stroke="var(--primary)"
				strokeWidth="3"
				strokeLinecap="round"
				opacity="0.5"
			/>

			{/* Face */}
			<circle
				cx="60"
				cy="60"
				r="40"
				fill="var(--card)"
				stroke="var(--border)"
				strokeWidth="2"
			/>

			{/* Hour ticks — the quarters read heavier than the rest. */}
			{CLOCK_TICKS.map((angle) => {
				const isQuarter = angle % 90 === 0;
				const outer = clockPoint(angle, 33);
				const inner = clockPoint(angle, isQuarter ? 26 : 29);
				return (
					<line
						key={angle}
						x1={outer.x}
						y1={outer.y}
						x2={inner.x}
						y2={inner.y}
						stroke="var(--muted-foreground)"
						strokeWidth={isQuarter ? 2 : 1.5}
						strokeLinecap="round"
						opacity={isQuarter ? 0.4 : 0.22}
					/>
				);
			})}

			{/* Hands, reading 2 o'clock. */}
			<line
				x1="60"
				y1="60"
				x2="60"
				y2="32"
				stroke="var(--muted-foreground)"
				strokeWidth="3"
				strokeLinecap="round"
				opacity="0.55"
			/>
			<line
				x1="60"
				y1="60"
				x2={clockPoint(60, 20).x}
				y2={clockPoint(60, 20).y}
				stroke="var(--primary)"
				strokeWidth="3"
				strokeLinecap="round"
			/>
			<circle cx="60" cy="60" r="3.5" fill="var(--primary)" />
		</svg>
	);
}

export const Route = createFileRoute(
	"/w/$workspaceSlug/teams/$teamId/settings/time",
)({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
	},
	component: TeamTimeSettings,
});

function TeamTimeSettings() {
	const { workspaceSlug, teamId } = Route.useParams();
	const user = useUser();
	const toast = useToast();
	const qc = useQueryClient();

	const teamQuery = useQuery({
		queryKey: ["teams", "detail", teamId],
		queryFn: () => getTeam(teamId),
	});

	const team = teamQuery.data;
	const [retroDays, setRetroDays] = useState(0);
	const [advancedOpen, setAdvancedOpen] = useState(false);
	useEffect(() => {
		setRetroDays(Number(team?.retroactive_log_days ?? 0));
	}, [team?.retroactive_log_days]);
	const isOwner = team?.owner_id === user?.id;
	// The switch is an operational setting, so the owner and team admins may
	// both flip it — no consultant capability involved. Everything below it that
	// moves money (retroactive window, currency, pay period) stays owner-only.
	// For everyone else the toggle is read-only with an explainer.
	const canToggle = isOwner || team?.viewer_role === "admin";
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

	const retroPolicyMutation = useMutation({
		mutationFn: (days: number) =>
			updateTeam(teamId, { retroactive_log_days: Math.max(0, days) }),
		onSuccess: (updated) => {
			toast.success(
				Number(updated.retroactive_log_days ?? 0) > 0
					? "Retroactive logging policy updated"
					: "Retroactive limit removed",
			);
			qc.invalidateQueries({ queryKey: ["teams", "detail", teamId] });
			qc.invalidateQueries({ queryKey: ["team", teamId] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	/**
	 * The backend treats retroactive_log_days of 0/null as "no restriction"
	 * (assertWithinRetroactiveWindow returns early), so the switch is a limit
	 * toggle, not a permission: OFF means members may log ANY past date. Turning
	 * it on seeds a week so the control has a meaningful starting value.
	 */
	const retroLimitOn = Number(team?.retroactive_log_days ?? 0) > 0;
	const RETRO_DEFAULT_DAYS = 7;

	const compensationMutation = useMutation({
		mutationFn: (next: boolean) =>
			updateTeam(teamId, { compensation_enabled: next }),
		onSuccess: (updated) => {
			toast.success(
				updated.compensation_enabled
					? "Payouts enabled"
					: "Payouts disabled for this team",
			);
			qc.invalidateQueries({ queryKey: ["teams", "detail", teamId] });
			qc.invalidateQueries({ queryKey: ["team", teamId] });
			qc.invalidateQueries({ queryKey: ["teams", "mine"] });
		},
		onError: (e: Error) => toast.error(e.message),
	});
	const paysMoney = team?.compensation_enabled === true;

	const currencyMutation = useMutation({
		mutationFn: (currency: "USD" | "CAD" | "PHP") =>
			updateTeam(teamId, { default_currency: currency }),
		onSuccess: (updated) => {
			toast.success(`Default currency set to ${updated.default_currency}`);
			qc.invalidateQueries({ queryKey: ["teams", "detail", teamId] });
			qc.invalidateQueries({ queryKey: ["team", teamId] });
		},
		onError: (e: Error) => toast.error(e.message),
	});
	const currency = (team?.default_currency ?? "USD") as "USD" | "CAD" | "PHP";

	return (
		<TeamSettingsLayout teamId={teamId} teamName={team?.name}>
			<section className="space-y-3">
				<div className="flex items-center gap-2">
					<Clock className="h-5 w-5 text-muted-foreground" />
					<h2 className="text-[30px] font-semibold leading-none text-foreground">
						Time tracking
					</h2>
				</div>

				{teamQuery.isPending ? (
					<div className="flex justify-center p-12">
						<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				) : (
					<div className="pt-2">
						<div className="space-y-4">
							<div className="flex items-start justify-between gap-4">
								<div className="space-y-1">
									<div className="text-sm font-semibold text-foreground">
										Enable time tracking for this team
									</div>
									<p className="max-w-xl text-sm text-muted-foreground">
										Members log time on tasks across the projects this team is
										attached to; team owners and admins approve those logs and
										manage per-member rates.
										{enabled && (
											<>
												{" "}
												Pages live at{" "}
												<Link
													to="/w/$workspaceSlug/teams/$teamId/time"
													params={{ workspaceSlug, teamId }}
													className="text-primary hover:underline"
												>
													/teams/{team?.name ?? "…"}/time
												</Link>{" "}
												and{" "}
												<Link
													to="/w/$workspaceSlug/teams/$teamId/time/manage-rates"
													params={{ workspaceSlug, teamId }}
													className="text-primary hover:underline"
												>
													/teams/{team?.name ?? "…"}/time/manage-rates
												</Link>
												.
											</>
										)}
									</p>
								</div>
								<SettingSwitch
									checked={enabled}
									disabled={!canToggle || toggleMutation.isPending}
									onChange={(next) => toggleMutation.mutate(next)}
									label="Enable time tracking for this team"
								/>
							</div>

							{enabled && (
								<div className="flex flex-wrap gap-2 pt-1">
									<Link
										to="/w/$workspaceSlug/teams/$teamId/time"
										params={{ workspaceSlug, teamId }}
										className="rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
									>
										Open team time
									</Link>
									<Link
										to="/w/$workspaceSlug/teams/$teamId/time/manage-rates"
										params={{ workspaceSlug, teamId }}
										className="rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-foreground hover:bg-muted"
									>
										Manage rates
									</Link>
								</div>
							)}

							{enabled && !canToggle && (
								<div className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
									Only the team owner or a team admin can change this setting.
								</div>
							)}

							{!enabled && (
								<div className="border-t border-border pb-4 pt-12 text-center">
									<GhostClock className="mx-auto mb-6 h-32 w-32" />
									<h4 className="text-base font-semibold text-foreground">
										No time tracked yet
									</h4>
									<p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
										{canToggle
											? "Turn tracking on and this team's members can start logging hours against their tasks. You'll approve the logs and set each member's rate."
											: "Once an owner or admin turns tracking on, you can log hours against your tasks on this team's projects."}
									</p>
									{canToggle && (
										<button
											type="button"
											onClick={() => toggleMutation.mutate(true)}
											disabled={toggleMutation.isPending}
											className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
										>
											{toggleMutation.isPending ? (
												<Loader2 className="h-4 w-4 animate-spin" />
											) : (
												<Clock className="h-4 w-4" />
											)}
											Enable time tracking
										</button>
									)}
								</div>
							)}

							{enabled && isOwner && (
								<div className="border-t border-border pt-5">
									<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
										Default currency
									</p>
									<p className="mt-1 text-xs text-muted-foreground">
										Used as the fallback currency for member rates and new logs.
										Existing logs keep the currency frozen when they were
										recorded.
									</p>
									<div className="mt-3 inline-flex rounded-lg border border-border bg-muted p-1">
										{(["USD", "CAD", "PHP"] as const).map((code) => {
											const active = currency === code;
											return (
												<button
													key={code}
													type="button"
													disabled={active || currencyMutation.isPending}
													onClick={() => currencyMutation.mutate(code)}
													className={
														active
															? "rounded-md bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm"
															: "rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-60"
													}
												>
													{code}
												</button>
											);
										})}
									</div>
								</div>
							)}

							{/* Advanced: the two policies most teams never touch. Owner-only,
							    because both shape what lands in a payout. */}
							{enabled && isOwner && (
								<div className="border-t border-border pt-4">
									<button
										type="button"
										onClick={() => setAdvancedOpen((open) => !open)}
										aria-expanded={advancedOpen}
										className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 -ml-2 text-sm font-semibold text-foreground hover:bg-muted"
									>
										<ChevronRight
											className={`h-4 w-4 text-muted-foreground transition-transform ${
												advancedOpen ? "rotate-90" : ""
											}`}
										/>
										Advanced options
									</button>

									{advancedOpen && (
										<div className="mt-4 space-y-6">
											<section>
												<div className="flex items-start justify-between gap-4">
													<div>
														<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
															Retroactive manual logs
														</p>
														<p className="mt-1 max-w-xl text-xs text-muted-foreground">
															{retroLimitOn
																? "Members can only add or edit manual logs within this window."
																: "Members can add or edit manual logs for any past date. Turn this on to lock older days."}
														</p>
													</div>
													<SettingSwitch
														checked={retroLimitOn}
														disabled={retroPolicyMutation.isPending}
														onChange={(next) =>
															retroPolicyMutation.mutate(
																next
																	? retroDays > 0
																		? retroDays
																		: RETRO_DEFAULT_DAYS
																	: 0,
															)
														}
														label="Limit retroactive manual logs"
													/>
												</div>

												{retroLimitOn && (
													<div className="mt-3 flex items-center gap-2">
														<input
															type="number"
															min={1}
															value={retroDays}
															onChange={(e) =>
																setRetroDays(
																	Math.max(1, Number(e.target.value || 1)),
																)
															}
															className="w-28 rounded-md border border-border px-2.5 py-1.5 text-sm"
															aria-label="Retroactive window in days"
														/>
														<span className="text-xs text-muted-foreground">
															days
														</span>
														<button
															type="button"
															onClick={() =>
																retroPolicyMutation.mutate(retroDays)
															}
															disabled={retroPolicyMutation.isPending}
															className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-60"
														>
															{retroPolicyMutation.isPending
																? "Saving..."
																: "Save policy"}
														</button>
													</div>
												)}
											</section>

											<section>
												<div className="flex items-start justify-between gap-4">
													<div>
														<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
															Payouts
														</p>
														<p className="mt-1 max-w-xl text-xs text-muted-foreground">
															{paysMoney
																? "This team pays through Proyekto: members carry rates, hours accrue a value, and you record payments against cut-off periods."
																: "This team tracks hours only. Turn payouts on to set per-member rates, group approved hours into cut-off periods, and record payments."}
														</p>
													</div>
													<SettingSwitch
														checked={paysMoney}
														disabled={compensationMutation.isPending}
														onChange={(next) =>
															compensationMutation.mutate(next)
														}
														label="Enable payouts for this team"
													/>
												</div>

												{!paysMoney && (
													<p className="mt-2 max-w-xl text-xs text-muted-foreground">
														While this is off, the Manage Rates and Payouts tabs
														are hidden and new logs record no fee. Existing
														rates and past amounts are kept, and reappear
														unchanged if you turn it back on.
													</p>
												)}

												{paysMoney && (
													<div className="mt-5 border-t border-border pt-5">
														<PayPeriodSettingsCard
															teamId={teamId}
															config={team?.pay_period_config}
															canManage={isOwner}
														/>
													</div>
												)}
											</section>
										</div>
									)}
								</div>
							)}
						</div>
					</div>
				)}
			</section>
		</TeamSettingsLayout>
	);
}
