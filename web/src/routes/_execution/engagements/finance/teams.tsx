import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { ChevronRight, Plus, Users } from "lucide-react";
import {
	AppEmptyState,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { FINANCE_ROLE_LABELS } from "@/components/finance/FinanceShareDialog";
import { InitialsTile } from "@/components/finance/InitialsTile";
import { FinanceTrail } from "@/components/finance/nav/FinanceTrail";
import {
	useFinanceHub,
	useManagedTeams,
} from "@/components/finance/nav/useManagedTeams";
import {
	countLabel,
	FinanceLoading,
} from "@/components/finance/portfolio/FinancePrimitives";

/**
 * My teams — the teams whose money the caller runs (owner, admin, or a finance
 * role on the team book). With exactly one there is nothing to choose, so the
 * page goes straight to it.
 */
export const Route = createFileRoute("/_execution/engagements/finance/teams")({
	component: MyTeamsPage,
});

function MyTeamsPage() {
	const hubQuery = useFinanceHub();
	const teams = useManagedTeams(hubQuery.data);

	if (hubQuery.isPending) return <FinanceLoading />;
	if (teams.length === 1) {
		return (
			<Navigate
				to="/engagements/finance/team/$teamId"
				params={{ teamId: teams[0].team_id }}
				replace
			/>
		);
	}

	return (
		<div className="app-shell-bg min-h-full px-5 py-4 md:px-8 md:py-5">
			<div className="mx-auto w-full max-w-5xl pb-10">
				<FinanceTrail current="My teams" />
				<div className="mt-2">
					<h1 className="text-2xl font-bold tracking-tight text-foreground">
						My teams
					</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						The teams whose money you run. Open one for its money in, money out,
						time, rates, payouts, and people.
					</p>
				</div>

				{teams.length === 0 ? (
					<AppEmptyState
						icon={Users}
						title="You don't run a team's finance yet"
						description="Create a team from your workspace, or ask a team owner to give you a finance role. Your share of the teams you belong to is in My finance."
						className="mt-8"
						action={
							<Link
								to="/engagements/finance"
								className="app-cta inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white"
							>
								Go to My finance
							</Link>
						}
					/>
				) : (
					<AppSurfaceCard className="mt-6 divide-y divide-border/60 overflow-hidden">
						{teams.map((team) => (
							<Link
								key={team.team_id}
								to="/engagements/finance/team/$teamId"
								params={{ teamId: team.team_id }}
								className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-muted/40"
							>
								<span className="flex min-w-0 items-center gap-3.5">
									{team.avatar_url ? (
										<img
											src={team.avatar_url}
											alt=""
											className="h-10 w-10 shrink-0 rounded-xl object-cover"
										/>
									) : (
										<InitialsTile name={team.team_name} />
									)}
									<span className="min-w-0">
										<span className="block truncate text-sm font-semibold text-foreground">
											{team.team_name}
										</span>
										<span className="block truncate text-xs text-muted-foreground">
											{team.project_books.length === 0
												? "No project finance yet"
												: countLabel(team.project_books.length, "project")}
										</span>
									</span>
								</span>
								<span className="flex shrink-0 items-center gap-3">
									<span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground capitalize">
										{team.my_team_role === "member" && team.book_role
											? (FINANCE_ROLE_LABELS[team.book_role] ?? team.book_role)
											: team.my_team_role}
									</span>
									{!team.book && team.can_create ? (
										<span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
											<Plus className="h-3.5 w-3.5" /> Set up finance
										</span>
									) : null}
									<ChevronRight className="h-4 w-4 text-muted-foreground" />
								</span>
							</Link>
						))}
					</AppSurfaceCard>
				)}
			</div>
		</div>
	);
}
