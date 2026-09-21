import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	BarChart3,
	Clock,
	FileSignature,
	HandCoins,
	ReceiptText,
	Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { AppTabs } from "@/components/common/AppTabs";
import { InitialsTile } from "@/components/finance/InitialsTile";
import {
	FINANCE_CRUMB_LINK_CLASS,
	FinanceBreadcrumbs,
	FinanceCurrentCrumb,
} from "@/components/finance/portfolio/FinanceBreadcrumbs";
import { FinanceFiltersBar } from "@/components/finance/portfolio/FinanceFiltersBar";
import type {
	FinanceSearchState,
	FinanceSection,
} from "@/components/finance/portfolio/financeSearch";
import { teamFinanceService } from "@/services/teamFinance.service";

type TeamFinanceTab = FinanceSection | "rates" | "time-logs" | "payouts";

/**
 * The three in-section tabs plus three link-outs into Teams -> Time, so the
 * team's whole money surface reads as one place even while rates, time logs,
 * and payouts still live in the execution shell. A link-out tab is never
 * "active" here; its pages render their own chrome.
 */
const TEAM_FINANCE_TABS: Array<{
	id: TeamFinanceTab;
	label: string;
	icon: typeof BarChart3;
}> = [
	{ id: "overview", label: "Overview", icon: BarChart3 },
	{ id: "contracts", label: "Contracts", icon: FileSignature },
	{ id: "invoices", label: "Invoices", icon: ReceiptText },
	{ id: "rates", label: "Rates", icon: HandCoins },
	{ id: "time-logs", label: "Time logs", icon: Clock },
	{ id: "payouts", label: "Payouts", icon: Wallet },
];

/**
 * Header, tab bar, and filter toolbar for one team's finance pages.
 *
 * A component the three team routes render rather than a pathless layout: the
 * team pages already share `$teamId` as a real path segment, so there is no
 * URL-shape reason for layout nesting, and the chrome needs the team name
 * anyway (from the same query the sidebar uses, so it is warm).
 */
export function TeamFinanceChrome({
	teamId,
	section,
	search,
	projects,
	onChange,
	roleLabel,
	actions,
	showFilters = true,
	children,
}: {
	teamId: string;
	section: FinanceSection;
	search: FinanceSearchState;
	projects: Array<{ id: string; title: string }>;
	onChange: (patch: Partial<FinanceSearchState>) => void;
	/** The viewer's standing on this team ("Owner"), shown beside its name. */
	roleLabel?: string;
	/** Header actions — who is on the book, Share, the page's primary action. */
	actions?: ReactNode;
	/**
	 * The filter toolbar narrows lists. The overview is a summary of places, not
	 * a list, so it hides the bar until there is a rollup beneath it to filter.
	 */
	showFilters?: boolean;
	children: ReactNode;
}) {
	const teamsQuery = useQuery({
		queryKey: ["team-finance", "teams"],
		queryFn: () => teamFinanceService.teams(),
		staleTime: 60_000,
	});
	const team = teamsQuery.data?.find((entry) => entry.id === teamId);
	const teamName = team?.name ?? "Team";

	const sharedSearch = {
		q: search.q,
		projectId: search.projectId,
		projectStatus: search.projectStatus,
		currency: search.currency,
		from: search.from,
		to: search.to,
	};

	const currentTab = TEAM_FINANCE_TABS.find((tab) => tab.id === section);

	return (
		<div className="app-shell-bg min-h-full px-5 py-4 md:px-8 md:py-5">
			<div className="mx-auto w-full max-w-7xl">
				<header>
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
								key="finance"
								to="/engagements/finance"
								className={FINANCE_CRUMB_LINK_CLASS}
							>
								Finance
							</Link>,
							section === "overview" ? (
								<FinanceCurrentCrumb key="team">{teamName}</FinanceCurrentCrumb>
							) : (
								<Link
									key="team"
									to="/engagements/finance/team/$teamId"
									params={{ teamId }}
									search={sharedSearch}
									className={FINANCE_CRUMB_LINK_CLASS}
								>
									{teamName}
								</Link>
							),
							...(section === "overview"
								? []
								: [
										<FinanceCurrentCrumb key="section">
											{currentTab?.label ?? "Finance"}
										</FinanceCurrentCrumb>,
									]),
						]}
					/>

					<div className="mt-3 flex flex-wrap items-center justify-between gap-4">
						<div className="flex min-w-0 items-center gap-3.5">
							<InitialsTile name={teamName} size="lg" />
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
									Team finance — rates, time, payouts, and the contracts behind
									them.
								</p>
							</div>
						</div>
						{actions ? (
							<div className="flex shrink-0 items-center gap-2">{actions}</div>
						) : null}
					</div>

					{/*
					 * The same strip the portfolio and the engagement list carry —
					 * one component, so the three tab bars in this section cannot
					 * drift apart.
					 */}
					<AppTabs
						variant="underline"
						size="sm"
						className="mt-3"
						items={TEAM_FINANCE_TABS.map((tab) => ({
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
							switch (id) {
								case "contracts":
									return {
										to: "/engagements/finance/team/$teamId/contracts",
										params: { teamId },
										search: sharedSearch,
									};
								case "invoices":
									return {
										to: "/engagements/finance/team/$teamId/invoices",
										params: { teamId },
										search: sharedSearch,
									};
								case "rates":
									return {
										to: "/teams/$teamId/time/manage-rates",
										params: { teamId },
									};
								case "time-logs":
									return {
										to: "/teams/$teamId/time/team-logs",
										params: { teamId },
									};
								case "payouts":
									return {
										to: "/teams/$teamId/time/payouts",
										params: { teamId },
									};
								default:
									return {
										to: "/engagements/finance/team/$teamId",
										params: { teamId },
										search: sharedSearch,
									};
							}
						}}
					/>
				</header>

				{showFilters ? (
					<FinanceFiltersBar
						search={search}
						section={section}
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
