import {
	BarChart3,
	Clock,
	FileUp,
	HandCoins,
	ReceiptText,
	TrendingDown,
	Users,
	Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { AppTabs } from "@/components/common/AppTabs";
import {
	FinanceNoAccess,
	FinanceQueryError,
} from "@/components/finance/access/FinanceAccessStates";
import { FINANCE_ROLE_LABELS } from "@/components/finance/FinanceShareDialog";
import { InitialsTile } from "@/components/finance/InitialsTile";
import { FinanceTrail } from "@/components/finance/nav/FinanceTrail";
import { FinanceFiltersBar } from "@/components/finance/portfolio/FinanceFiltersBar";
import { FinanceLoading } from "@/components/finance/portfolio/FinancePrimitives";
import type {
	FinanceSearchState,
	FinanceSection,
} from "@/components/finance/portfolio/financeSearch";
import type { TeamFinanceTab } from "@/components/finance/team/teamFinanceAccess";
import { useTeamFinanceAccess } from "@/components/finance/team/useTeamFinanceAccess";
import type { FinanceHubTeam } from "@/services/financeBooks.service";

export type { TeamFinanceTab } from "@/components/finance/team/teamFinanceAccess";
export { visibleTeamTabs } from "@/components/finance/team/teamFinanceAccess";

const TEAM_FINANCE_TABS: Array<{
	id: TeamFinanceTab;
	label: string;
	icon: typeof BarChart3;
}> = [
	{ id: "overview", label: "Overview", icon: BarChart3 },
	{ id: "invoices", label: "Invoices", icon: ReceiptText },
	{ id: "time-logs", label: "Time logs", icon: Clock },
	{ id: "rates", label: "Rates", icon: HandCoins },
	{ id: "payouts", label: "Payouts", icon: Wallet },
	{ id: "expenses", label: "Expenses", icon: TrendingDown },
	{ id: "imports", label: "Imports", icon: FileUp },
	{ id: "members", label: "Members", icon: Users },
];

/**
 * What a refused direct URL says, per tab. Imports and invoices are refused
 * by the PROJECT-level finance gate, so they point at the project owner; the
 * rest are team-level and point at the team owner.
 */
const DENIED_COPY: Partial<
	Record<TeamFinanceTab, { title: string; description: string }>
> = {
	imports: {
		title: "You don't have finance access to any of this team's projects.",
		description:
			"Imports record billing against one project's ledger. Ask the project owner for access.",
	},
	invoices: {
		title: "You don't have finance access to any of this team's projects.",
		description: "Ask the project owner for access.",
	},
	expenses: {
		title: "You don't have access to this team's expenses.",
		description:
			"Money out is visible to the team owner and the finance owner, manager, or accountant. Ask the team owner for access.",
	},
	"time-logs": {
		title: "You don't have access to this team's time and pay.",
		description: "Team owners and admins review logs, rates, and payouts.",
	},
	rates: {
		title: "You don't have access to this team's time and pay.",
		description: "Team owners and admins review logs, rates, and payouts.",
	},
	payouts: {
		title: "You don't have access to this team's time and pay.",
		description: "Team owners and admins review logs, rates, and payouts.",
	},
};

/**
 * The viewer's standing on a team, for the badge beside its name: the team
 * role for owners and admins, otherwise their finance-book role ("Accountant").
 */
export function teamRoleLabel(
	team: FinanceHubTeam | undefined,
): string | undefined {
	if (!team) return undefined;
	if (team.my_team_role === "owner") return "Owner";
	if (team.my_team_role === "admin") return "Admin";
	return FINANCE_ROLE_LABELS[team.book_role ?? ""] ?? undefined;
}

/**
 * Whether the viewer may read the team's money in and contracts: a team
 * owner/admin, or an owner/manager/accountant on the team's finance book
 * (mirrors `TeamFinanceAccessService.listTeamProjects`).
 */
export function canSeeTeamMoneyIn(team: FinanceHubTeam | undefined): boolean {
	if (!team) return false;
	return (
		team.my_team_role === "owner" ||
		team.my_team_role === "admin" ||
		team.book_role === "owner" ||
		team.book_role === "manager" ||
		team.book_role === "accountant"
	);
}

/**
 * Header, tab bar, and (for list tabs) the filter toolbar for one team's
 * finance. Every tab is a real route under `/engagements/finance/team/$teamId`,
 * so the Engagements sidebar and breadcrumb stay put whichever tab is open —
 * nothing jumps out to the workspace shell.
 */
export function TeamFinanceChrome({
	teamId,
	section,
	search,
	projects = [],
	onChange,
	roleLabel,
	actions,
	showFilters = false,
	subtitle,
	children,
}: {
	teamId: string;
	section: TeamFinanceTab;
	search?: FinanceSearchState;
	projects?: Array<{ id: string; title: string }>;
	onChange?: (patch: Partial<FinanceSearchState>) => void;
	/**
	 * The viewer's standing on this team ("Owner"), shown beside its name.
	 * Defaults to `teamRoleLabel`, so every tab carries it.
	 */
	roleLabel?: string;
	/** Header actions — who is on the book, Share, the page's primary action. */
	actions?: ReactNode;
	/** Only list tabs (invoices) filter; summaries and ledgers do not. */
	showFilters?: boolean;
	subtitle?: string;
	children: ReactNode;
}) {
	const access = useTeamFinanceAccess(teamId);
	const { team } = access;
	const teamName = team?.team_name ?? "Team";
	const badge = roleLabel ?? teamRoleLabel(team);
	const tabs = TEAM_FINANCE_TABS.filter((tab) => access.tabs.includes(tab.id));
	const currentTab = TEAM_FINANCE_TABS.find((tab) => tab.id === section);
	// Only tabs that depend on the project list wait for it.
	const sectionAccess = access.hubQuery.isPending
		? "pending"
		: access.tabAccess(section);

	const sharedSearch = search
		? {
				q: search.q,
				projectId: search.projectId,
				projectStatus: search.projectStatus,
				currency: search.currency,
				from: search.from,
				to: search.to,
			}
		: {};

	return (
		<div className="app-shell-bg min-h-full px-5 py-4 md:px-8 md:py-5">
			<div className="mx-auto w-full max-w-7xl">
				<header>
					<FinanceTrail
						team={{ id: teamId, name: teamName }}
						shared={team?.my_team_role === "guest"}
						current={section === "overview" ? undefined : currentTab?.label}
					/>

					<div className="mt-3 flex flex-wrap items-center justify-between gap-4">
						<div className="flex min-w-0 items-center gap-3.5">
							{team?.avatar_url ? (
								<img
									src={team.avatar_url}
									alt=""
									className="h-12 w-12 shrink-0 rounded-xl object-cover"
								/>
							) : (
								<InitialsTile name={teamName} size="lg" />
							)}
							<div className="min-w-0">
								<div className="flex min-w-0 items-center gap-2.5">
									<h1 className="truncate text-2xl font-bold tracking-tight text-foreground">
										{teamName}
									</h1>
									{badge ? (
										<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
											{badge}
										</span>
									) : null}
								</div>
								<p className="mt-0.5 truncate text-sm text-muted-foreground">
									{subtitle ??
										"Team finance — money in, money out, time, and the people who run it."}
								</p>
							</div>
						</div>
						{actions ? (
							<div className="flex shrink-0 items-center gap-2">{actions}</div>
						) : null}
					</div>

					<AppTabs
						variant="underline"
						size="sm"
						className="mt-3"
						items={tabs.map((tab) => ({
							key: tab.id,
							label: (
								<>
									<tab.icon className="h-4 w-4" />
									{tab.label}
								</>
							),
						}))}
						active={section}
						linkFor={(id) => {
							const params = { teamId };
							switch (id) {
								case "invoices":
									return {
										to: "/engagements/finance/team/$teamId/invoices",
										params,
										search: sharedSearch,
									};
								case "time-logs":
									return {
										to: "/engagements/finance/team/$teamId/time-logs",
										params,
										search: {},
									};
								case "rates":
									return {
										to: "/engagements/finance/team/$teamId/rates",
										params,
									};
								case "payouts":
									return {
										to: "/engagements/finance/team/$teamId/payouts",
										params,
									};
								case "expenses":
									return {
										to: "/engagements/finance/team/$teamId/expenses",
										params,
									};
								case "imports":
									return {
										to: "/engagements/finance/team/$teamId/imports",
										params,
										search: {},
									};
								case "members":
									return {
										to: "/engagements/finance/team/$teamId/members",
										params,
									};
								default:
									return {
										to: "/engagements/finance/team/$teamId",
										params,
										search: sharedSearch,
									};
							}
						}}
					/>
				</header>

				{sectionAccess === "allowed" && showFilters && search && onChange ? (
					<FinanceFiltersBar
						search={search}
						section={section as FinanceSection}
						projects={projects}
						onChange={onChange}
					/>
				) : (
					<div className="mt-5" />
				)}

				{/*
				 * The page body mounts only once access is known and granted, so a
				 * refused tab never fires its own (refused) requests, never shows a
				 * spinner for seconds, and never falls through to an empty list.
				 */}
				{access.hubQuery.isError ? (
					<FinanceQueryError
						error={access.hubQuery.error}
						scope="team"
						onRetry={() => void access.hubQuery.refetch()}
					/>
				) : sectionAccess === "pending" ? (
					access.projectsError ? (
						<FinanceQueryError
							error={access.projectsError}
							onRetry={access.refetchProjects}
						/>
					) : (
						<FinanceLoading />
					)
				) : sectionAccess === "denied" ? (
					!team ? (
						<FinanceNoAccess scope="team" />
					) : (
						<FinanceNoAccess
							scope="project"
							title={DENIED_COPY[section]?.title}
							description={DENIED_COPY[section]?.description}
						/>
					)
				) : (
					children
				)}
			</div>
		</div>
	);
}
