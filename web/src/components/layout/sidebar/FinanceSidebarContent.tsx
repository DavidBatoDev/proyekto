import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, Users } from "lucide-react";
import { isActiveConsultant } from "@/lib/auth-utils";
import { teamFinanceService } from "@/services/teamFinance.service";
import { useProfile } from "@/stores/authStore";
import { FINANCE_NAV_ITEMS, isFinanceNavItemActive } from "./financeNavigation";
import { SidebarNavLink, SidebarSectionHeader } from "./SidebarPrimitives";

/**
 * The finance shell's navigation.
 *
 * The personal sections (Overview / Contracts / Invoices) are the consultant's
 * own book of business and stay behind the consultant capability. The Teams
 * group is deliberately NOT consultant-gated: it lists every team the caller
 * owns or administers, and a project admin runs team finance without ever
 * being a marketplace consultant — the reason finance left the marketplace
 * shell.
 */
export function FinanceSidebarContent() {
	const profile = useProfile();
	const consultant = isActiveConsultant(profile);
	const currentPath = useRouterState({
		select: (state) => state.location.pathname,
	});

	const items = FINANCE_NAV_ITEMS.filter(
		(item) => item.requires !== "consultant" || consultant,
	);

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

	return (
		<div className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-4">
			<nav className="space-y-1">
				<SidebarSectionHeader>Finance</SidebarSectionHeader>
				{items.map((item) => (
					<SidebarNavLink
						key={item.key}
						to={item.to}
						icon={item.icon}
						label={item.label}
						active={isFinanceNavItemActive(item, currentPath)}
					/>
				))}
			</nav>

			{teams.length > 0 && (
				<nav className="space-y-1">
					<SidebarSectionHeader>Teams</SidebarSectionHeader>
					{teams.map((team) => (
						<SidebarNavLink
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
