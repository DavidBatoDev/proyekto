import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, Users } from "lucide-react";
import { isActiveConsultant } from "@/lib/auth-utils";
import { teamFinanceService } from "@/services/teamFinance.service";
import { useProfile } from "@/stores/authStore";
import {
	ENGAGEMENTS_NAV_ITEMS,
	isEngagementsNavItemActive,
} from "./engagementsNavigation";
import {
	SidebarNavLink,
	SidebarSectionHeader,
	SidebarSubLink,
} from "./SidebarPrimitives";

/**
 * The engagements shell's navigation.
 *
 * Sections only: Finance is one entry whose three surfaces are tabs on the
 * page, and the engagement list's seat tabs and status filter live on that
 * page too. What remains here is the small set of places to go.
 *
 * The teams are nested under Finance because a team's book is a finance
 * destination — the same three surfaces scoped to that team — rather than a
 * section of its own beside it.
 *
 * Finance stays behind the consultant capability, but the teams under it do
 * NOT: a project admin runs team finance without ever being a marketplace
 * consultant — the reason finance left the marketplace shell. For that caller
 * the group keeps its heading and loses only the personal book above it.
 */
export function EngagementsSidebarContent() {
	const profile = useProfile();
	const consultant = isActiveConsultant(profile);
	const currentPath = useRouterState({
		select: (state) => state.location.pathname,
	});

	const teamsQuery = useQuery({
		queryKey: ["team-finance", "teams"],
		queryFn: () => teamFinanceService.teams(),
		staleTime: 60_000,
	});
	// A team with zero finance-visible projects would open onto an empty page;
	// listing it would advertise a place with nothing in it.
	const teams = (teamsQuery.data ?? []).filter(
		(team) => team.project_count > 0,
	);

	const items = ENGAGEMENTS_NAV_ITEMS.filter(
		(item) => item.requires !== "consultant" || consultant,
	);
	const financeItem = items.find((item) => item.key === "finance");
	const sectionItems = items.filter((item) => item.key !== "finance");

	return (
		<div className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-4">
			<nav className="space-y-1">
				{sectionItems.map((item) => (
					<SidebarNavLink
						key={item.key}
						to={item.to}
						icon={item.icon}
						label={item.label}
						active={isEngagementsNavItemActive(item, currentPath)}
					/>
				))}
			</nav>

			{(financeItem || teams.length > 0) && (
				<nav className="space-y-1">
					{financeItem ? (
						<SidebarNavLink
							to={financeItem.to}
							icon={financeItem.icon}
							label={financeItem.label}
							active={isEngagementsNavItemActive(financeItem, currentPath)}
						/>
					) : (
						<SidebarSectionHeader>Finance</SidebarSectionHeader>
					)}

					{teams.length > 0 && (
						<div
							className={`space-y-0.5 ${
								financeItem
									? "ml-6 border-l border-sidebar-border pl-2"
									: undefined
							}`}
						>
							{teams.map((team) => (
								<SidebarSubLink
									key={team.id}
									to="/engagements/finance/team/$teamId"
									params={{ teamId: team.id }}
									icon={Users}
									label={team.name}
									active={currentPath.startsWith(
										`/engagements/finance/team/${team.id}`,
									)}
								/>
							))}
						</div>
					)}
				</nav>
			)}

			<div className="mt-auto border-t border-sidebar-border pt-3">
				<Link
					to="/dashboard"
					className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/85 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
				>
					<ArrowLeft className="h-5 w-5 shrink-0" />
					<span className="truncate">Back to workspace</span>
				</Link>
			</div>
		</div>
	);
}
