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
import { InitialsTile } from "@/components/finance/InitialsTile";
import { FinanceTrail } from "@/components/finance/nav/FinanceTrail";
import { useHubTeam } from "@/components/finance/nav/useManagedTeams";
import { FinanceFiltersBar } from "@/components/finance/portfolio/FinanceFiltersBar";
import type {
	FinanceSearchState,
	FinanceSection,
} from "@/components/finance/portfolio/financeSearch";
import type { FinanceHubTeam } from "@/services/financeBooks.service";

export type TeamFinanceTab =
	| "overview"
	| "invoices"
	| "time-logs"
	| "rates"
	| "payouts"
	| "expenses"
	| "imports"
	| "members";

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
 * Which team tabs the caller can use. Time logs, rates, and payouts are the
 * team's HR layer (team owner or admin, the same rule as Teams → Time); the
 * money-in and money-out ledgers follow the finance role on the team book.
 * A tab the caller cannot use is not drawn — never drawn-then-refused.
 */
export function visibleTeamTabs(team: FinanceHubTeam | undefined) {
	const isAdmin =
		team?.my_team_role === "owner" || team?.my_team_role === "admin";
	const financeRole =
		team?.my_team_role === "owner" ? "owner" : team?.book_role;
	const canMoney =
		isAdmin ||
		financeRole === "owner" ||
		financeRole === "manager" ||
		financeRole === "accountant";
	return TEAM_FINANCE_TABS.filter((tab) => {
		switch (tab.id) {
			case "time-logs":
			case "rates":
			case "payouts":
				return isAdmin;
			case "invoices":
			case "imports":
				return isAdmin || financeRole === "owner" || financeRole === "manager";
			case "expenses":
				return canMoney;
			default:
				return true;
		}
	});
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
	/** The viewer's standing on this team ("Owner"), shown beside its name. */
	roleLabel?: string;
	/** Header actions — who is on the book, Share, the page's primary action. */
	actions?: ReactNode;
	/** Only list tabs (invoices) filter; summaries and ledgers do not. */
	showFilters?: boolean;
	subtitle?: string;
	children: ReactNode;
}) {
	const { team } = useHubTeam(teamId);
	const teamName = team?.team_name ?? "Team";
	const tabs = visibleTeamTabs(team);
	const currentTab = TEAM_FINANCE_TABS.find((tab) => tab.id === section);

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
									{roleLabel ? (
										<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
											{roleLabel}
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

				{showFilters && search && onChange ? (
					<FinanceFiltersBar
						search={search}
						section={section as FinanceSection}
						projects={projects}
						onChange={onChange}
					/>
				) : (
					<div className="mt-5" />
				)}

				{children}
			</div>
		</div>
	);
}
