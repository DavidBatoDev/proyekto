import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Clock, Loader2 } from "lucide-react";
import {
	featureLimitInfo,
	PlanLimitNotice,
} from "@/components/billing/PlanLimitNotice";
import { TeamMoneySection } from "@/components/team/settings/time/TeamMoneySection";
import {
	TeamRulesSection,
	type TeamTimeWorkspace,
} from "@/components/team/settings/time/TeamRulesSection";
import { TeamSettingsLayout } from "@/components/team/TeamSettingsLayout";
import { SettingSwitch } from "@/components/team-time/SettingSwitch";
import { TimeReasonCard } from "@/components/time/shared/TimeReasonCard";
import {
	SettingsPageHeader,
	SettingsSection,
	settingsButton,
} from "@/components/workspace/settings/SettingsPrimitives";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useToast } from "@/hooks/useToast";
import { useCurrentWorkspace } from "@/hooks/useWorkspaceQueries";
import { isAccessDeniedError } from "@/lib/apiErrors";
import { isPlanLimitError } from "@/lib/planLimitErrors";
import { isNativeApp } from "@/lib/platform";
import { timePlanCopy, timePlanDowngradeCopy } from "@/lib/timeErrors";
import { timeForParam } from "@/lib/timeSearch";
import { invalidateTime } from "@/queries/time";
import { getTeam, updateTeam } from "@/services/teams.service";
import { useAuthStore, useUser } from "@/stores/authStore";

/**
 * Team settings › Time (ux.md › Team Override): the team's time switch, its
 * rules on top of the workspace policy (Business), and its money settings
 * (member rates, payouts, billing and pay cut-offs; web only). Logging,
 * submitting and approving moved to `/time`; this page only configures.
 */

const COPY = {
	title: "Time",
	tracking: "Time tracking",
	trackingDescription: "Members log time for this team on attached projects.",
	on: "On",
	off: "Off",
	// L34
	timeOff:
		"Members can't log for this team while time is off. They can still track time just for themselves.",
	enable: "Enable time tracking",
	enabled: "Time tracking enabled",
	disabled: "Time tracking disabled",
	managersOnly: "Only the team owner or a team admin can change this setting.",
	openTeamTime: "Open team time",
	openTime: "Open Time",
	loadFailed: "Proyekto couldn't load this team. Try again.",
	notFound: "This team doesn't exist or you can't open it.",
} as const;

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
 * The time-off illustration: a ghosted clock face, drawn as inline SVG off
 * the theme's CSS variables (rather than an asset or hardcoded hex) so it
 * tracks light/dark and any brand-colour change automatically.
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
			<circle
				cx="60"
				cy="60"
				r="56"
				stroke="var(--border)"
				strokeWidth="1"
				opacity="0.55"
			/>
			<path
				d={`M 60 12 A 48 48 0 0 1 ${SWEEP_END.x.toFixed(2)} ${SWEEP_END.y.toFixed(2)}`}
				stroke="var(--primary)"
				strokeWidth="3"
				strokeLinecap="round"
				opacity="0.5"
			/>
			<circle
				cx="60"
				cy="60"
				r="40"
				fill="var(--card)"
				stroke="var(--border)"
				strokeWidth="2"
			/>
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
	const { workspace } = Route.useRouteContext();
	const { workspaces } = useCurrentWorkspace();
	const user = useUser();
	const toast = useToast();
	const qc = useQueryClient();
	const native = isNativeApp();

	const teamQuery = useQuery({
		queryKey: ["teams", "detail", teamId],
		queryFn: () => getTeam(teamId),
	});
	const team = teamQuery.data;

	const isOwner =
		Boolean(team && user?.id) &&
		(team?.owner_id === user?.id || team?.viewer_role === "owner");
	// The switch is operational, so team admins flip it too. The rules section
	// splits owner-only fields itself (D62); money is the owner's.
	const isManager = isOwner || team?.viewer_role === "admin";
	const enabled = team?.time_tracking_enabled === true;

	// Time is a plan feature of the TEAM's workspace, which may not be the one
	// in the URL. Without it the switch can't be turned on; a team that has it
	// on keeps its time readable and may still turn it off. Fails open while
	// usage is unknown.
	const teamWorkspaceId = team ? (team.workspace_id ?? workspace.id) : null;
	const teamWorkspace =
		teamWorkspaceId === workspace.id
			? workspace
			: (workspaces.find((item) => item.id === teamWorkspaceId) ?? null);
	const planWorkspace: TeamTimeWorkspace | null = teamWorkspaceId
		? {
				id: teamWorkspaceId,
				name: teamWorkspace?.name,
				slug: teamWorkspace?.slug,
				my_role: teamWorkspace?.my_role ?? null,
			}
		: null;
	const entitlements = useEntitlements(teamWorkspaceId);
	const timeTrackingLimit = featureLimitInfo(entitlements, "time_tracking");
	const enableBlocked = timeTrackingLimit !== null && !enabled;

	const toggleMutation = useMutation({
		mutationFn: (next: boolean) =>
			updateTeam(teamId, { time_tracking_enabled: next }),
		onSuccess: (updated) => {
			toast.success(
				updated.time_tracking_enabled ? COPY.enabled : COPY.disabled,
			);
			qc.invalidateQueries({ queryKey: ["teams", "detail", teamId] });
			qc.invalidateQueries({ queryKey: ["team", teamId] });
			// The sidebar reads listMyTeams; refetch so the team's Time link
			// appears (or disappears) at once.
			qc.invalidateQueries({ queryKey: ["teams", "mine"] });
			// The team's For option comes and goes with the switch.
			void invalidateTime(qc, "policy");
		},
		onError: (error: Error) => {
			// The plan prompt is raised globally (api/axios notifyPlanLimit).
			if (isPlanLimitError(error)) return;
			toast.error(error.message);
		},
	});

	const workspaceName = planWorkspace?.name ?? null;

	return (
		<TeamSettingsLayout teamId={teamId} teamName={team?.name}>
			<SettingsPageHeader
				title={
					<span className="inline-flex items-center gap-2">
						<Clock
							className="h-5 w-5 text-muted-foreground"
							aria-hidden="true"
						/>
						{team?.name ? `${COPY.title} · ${team.name}` : COPY.title}
					</span>
				}
			/>

			{teamQuery.isPending ? (
				<div className="flex justify-center p-12">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			) : teamQuery.isError || !team ? (
				<TimeReasonCard
					className="mt-6"
					variant="inline"
					role="alert"
					tone={isAccessDeniedError(teamQuery.error) ? "not-found" : "danger"}
					title={
						isAccessDeniedError(teamQuery.error)
							? COPY.notFound
							: COPY.loadFailed
					}
				/>
			) : (
				<>
					<SettingsSection
						id="team-time-tracking"
						title={COPY.tracking}
						description={COPY.trackingDescription}
					>
						<div className="space-y-4">
							{timeTrackingLimit ? (
								<PlanLimitNotice
									info={timeTrackingLimit}
									workspace={teamWorkspace}
									isComplimentary={entitlements.isComplimentary}
									message={
										enabled
											? timePlanDowngradeCopy({ workspaceName })
											: timePlanCopy("time_tracking", {
													workspaceName,
													native,
												})
									}
								/>
							) : null}

							<div className="flex items-center justify-between gap-4">
								<span className="text-sm font-medium text-foreground">
									{enabled ? COPY.on : COPY.off}
								</span>
								<SettingSwitch
									checked={enabled}
									disabled={
										!isManager || toggleMutation.isPending || enableBlocked
									}
									onChange={(next) => toggleMutation.mutate(next)}
									label={COPY.tracking}
								/>
							</div>

							{enabled ? (
								<div className="flex flex-wrap gap-2">
									{isManager ? (
										<Link
											to="/w/$workspaceSlug/teams/$teamId/time"
											params={{ workspaceSlug, teamId }}
											className={settingsButton.secondary}
										>
											{COPY.openTeamTime}
										</Link>
									) : (
										<Link
											to="/time"
											search={{
												for: timeForParam({ kind: "team", id: teamId }),
											}}
											className={settingsButton.secondary}
										>
											{COPY.openTime}
										</Link>
									)}
								</div>
							) : (
								<div className="border-t border-border pb-2 pt-8 text-center">
									<GhostClock className="mx-auto mb-5 h-28 w-28" />
									<p className="mx-auto max-w-sm text-sm text-muted-foreground">
										{COPY.timeOff}
									</p>
									{isManager ? (
										<button
											type="button"
											onClick={() => toggleMutation.mutate(true)}
											disabled={toggleMutation.isPending || enableBlocked}
											className={`${settingsButton.primary} mt-5`}
										>
											{toggleMutation.isPending ? (
												<Loader2 className="h-4 w-4 animate-spin" />
											) : (
												<Clock className="h-4 w-4" />
											)}
											{COPY.enable}
										</button>
									) : null}
								</div>
							)}

							{!isManager ? (
								<p className="text-xs text-muted-foreground">
									{COPY.managersOnly}
								</p>
							) : null}
						</div>
					</SettingsSection>

					{enabled && isManager ? (
						<TeamRulesSection
							teamId={teamId}
							workspace={planWorkspace}
							memberRatesEnabled={team.member_rates_enabled === true}
						/>
					) : null}

					{enabled && isManager && !native ? (
						<TeamMoneySection
							team={team}
							isOwner={isOwner}
							workspace={planWorkspace}
							workspaceSlug={workspaceSlug}
						/>
					) : null}
				</>
			)}
		</TeamSettingsLayout>
	);
}
