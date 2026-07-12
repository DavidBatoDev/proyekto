import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Outlet,
	redirect,
	useLocation,
} from "@tanstack/react-router";
import { Clock, Coins, Loader2, Wallet } from "lucide-react";
import {
	AppSectionHeader,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { DashboardShell } from "@/components/layout/DashboardShell";
import {
	getTeam,
	hasAnyActiveRate,
	listTeamMembers,
} from "@/services/teams.service";
import { useAuthStore, useUser } from "@/stores/authStore";

export const Route = createFileRoute("/teams/$teamId/time")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) throw redirect({ to: "/auth/login" });
	},
	component: TeamTimeLayout,
});

type TabId = "my-logs" | "team-logs" | "manage-rates" | "payouts";

interface TabSpec {
	id: TabId;
	label: string;
	to:
		| "/teams/$teamId/time/my-logs"
		| "/teams/$teamId/time/team-logs"
		| "/teams/$teamId/time/manage-rates"
		| "/teams/$teamId/time/payouts";
	icon: typeof Clock;
}

function TeamTimeLayout() {
	const { teamId } = Route.useParams();
	const user = useUser();
	const location = useLocation();

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

	if (
		teamQuery.isPending ||
		membersQuery.isPending ||
		(user?.id && myActiveRateQuery.isPending)
	) {
		return (
			<DashboardShell>
				<div className="flex justify-center p-12">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			</DashboardShell>
		);
	}

	const team = teamQuery.data;
	const myMembership = membersQuery.data?.find((m) => m.user_id === user?.id);
	const isApprover =
		team?.owner_id === user?.id ||
		myMembership?.role === "admin" ||
		myMembership?.role === "owner";
	const isTeamMember = Boolean(myMembership);

	if (!team?.time_tracking_enabled) {
		return (
			<DashboardShell>
				<div className="space-y-6 p-6">
					<AppSectionHeader
						title={`${team?.name ?? "Team"} — Time`}
						subtitle="Time tracking is not enabled for this team."
						rightSlot={
							<Link
								to="/teams/$teamId"
								params={{ teamId }}
								className="text-sm text-sky-600 hover:underline"
							>
								Back to team
							</Link>
						}
					/>
					<AppSurfaceCard>
						<div className="space-y-3 p-6 text-sm text-muted-foreground">
							<p>
								Time tracking lets members log time on tasks across this team's
								projects, and lets owners and admins approve those logs and
								manage rates. The owner can enable it from team settings; it
								requires consultant verification.
							</p>
							<Link
								to="/teams/$teamId/settings/time"
								params={{ teamId }}
								className="inline-block rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
							>
								Open settings
							</Link>
						</div>
					</AppSurfaceCard>
				</div>
			</DashboardShell>
		);
	}

	const tabs: TabSpec[] = [];
	if (isTeamMember) {
		tabs.push({
			id: "my-logs",
			label: "My Logs",
			to: "/teams/$teamId/time/my-logs",
			icon: Clock,
		});
	}
	if (isApprover) {
		tabs.push({
			id: "team-logs",
			label: "Team Logs",
			to: "/teams/$teamId/time/team-logs",
			icon: Clock,
		});
	}
	if (isApprover) {
		tabs.push({
			id: "manage-rates",
			label: "Manage Rates",
			to: "/teams/$teamId/time/manage-rates",
			icon: Coins,
		});
	}
	if (isApprover) {
		tabs.push({
			id: "payouts",
			label: "Payouts",
			to: "/teams/$teamId/time/payouts",
			icon: Wallet,
		});
	}

	if (tabs.length === 0) {
		return (
			<DashboardShell>
				<div className="space-y-6 p-6">
					<AppSectionHeader
						title={`${team.name} — Time`}
						subtitle="You don't have access to time tracking on this team."
						rightSlot={
							<Link
								to="/teams/$teamId"
								params={{ teamId }}
								className="text-sm text-sky-600 hover:underline"
							>
								Back to team
							</Link>
						}
					/>
					<AppSurfaceCard>
						<div className="p-6 text-sm text-muted-foreground">
							Ask a team admin to set you a rate so you can log time, or get
							yourself promoted to admin to manage logs and rates.
						</div>
					</AppSurfaceCard>
				</div>
			</DashboardShell>
		);
	}

	const activeTabId: TabId | null = (() => {
		const path = location.pathname;
		if (path.includes("/time/my-logs")) return "my-logs";
		if (path.includes("/time/team-logs")) return "team-logs";
		if (path.includes("/time/manage-rates")) return "manage-rates";
		if (path.includes("/time/payouts")) return "payouts";
		// On a log detail page or the bare /time route, no tab highlights
		// (the redirector at index.tsx will route /time to a tab).
		return null;
	})();

	return (
		<DashboardShell>
			<div className="space-y-4 p-6">
				<AppSectionHeader
					title={`${team.name} — Time`}
					subtitle="Track time on tasks across this team's projects. Logs are reviewed by team owners and admins."
					rightSlot={
						<Link
							to="/teams/$teamId/settings/time"
							params={{ teamId }}
							className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-card-foreground hover:bg-muted"
							title="Open time tracking settings"
						>
							Time tracking: on
						</Link>
					}
				/>

				<div className="border-b border-border">
					<nav className="-mb-px flex gap-2" aria-label="Time tabs">
						{tabs.map((tab) => {
							const Icon = tab.icon;
							const isActive = activeTabId === tab.id;
							return (
								<Link
									key={tab.id}
									to={tab.to}
									params={{ teamId }}
									className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
										isActive
											? "border-primary text-primary"
											: "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
									}`}
								>
									<Icon className="h-4 w-4" />
									{tab.label}
								</Link>
							);
						})}
					</nav>
				</div>

				<Outlet />
			</div>
		</DashboardShell>
	);
}
