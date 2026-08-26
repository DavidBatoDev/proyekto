import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	ArrowUpRight,
	BarChart3,
	FileSignature,
	ReceiptText,
	Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { AppTabs } from "@/components/common/AppTabs";
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

const TEAM_FINANCE_TABS: Array<{
	id: FinanceSection;
	label: string;
	icon: typeof BarChart3;
}> = [
	{ id: "overview", label: "Overview", icon: BarChart3 },
	{ id: "contracts", label: "Contracts", icon: FileSignature },
	{ id: "invoices", label: "Invoices", icon: ReceiptText },
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
	children,
}: {
	teamId: string;
	section: FinanceSection;
	search: FinanceSearchState;
	projects: Array<{ id: string; title: string }>;
	onChange: (patch: Partial<FinanceSearchState>) => void;
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

					<div className="mt-2 flex items-center justify-between gap-4">
						<div className="flex min-w-0 items-center gap-2.5">
							<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/10 text-foreground">
								<Users className="h-4 w-4" />
							</span>
							<div className="min-w-0 leading-tight">
								<h1 className="truncate text-sm font-semibold text-foreground">
									{teamName} finance
								</h1>
								<p className="truncate text-[11px] text-muted-foreground">
									Invoices, contracts, and billing across this team's projects
								</p>
							</div>
						</div>
						<Link
							to="/teams/$teamId/time"
							params={{ teamId }}
							className="hidden shrink-0 items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
						>
							Time logs &amp; rates
							<ArrowUpRight className="h-3.5 w-3.5" />
						</Link>
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
						linkFor={(id) =>
							id === "contracts"
								? {
										to: "/engagements/finance/team/$teamId/contracts",
										params: { teamId },
										search: sharedSearch,
									}
								: id === "invoices"
									? {
											to: "/engagements/finance/team/$teamId/invoices",
											params: { teamId },
											search: sharedSearch,
										}
									: {
											to: "/engagements/finance/team/$teamId",
											params: { teamId },
											search: sharedSearch,
										}
						}
					/>
				</header>

				<FinanceFiltersBar
					search={search}
					section={section}
					projects={projects}
					onChange={onChange}
				/>

				{children}
			</div>
		</div>
	);
}
