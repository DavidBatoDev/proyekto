import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Folder, Plus, Share2, Wallet } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
	AppEmptyState,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import {
	ExportSection,
	ProjectBooksSection,
} from "@/components/finance/book/ProjectBookWorkspace";
import {
	FINANCE_ROLE_LABELS,
	FinanceShareDialog,
} from "@/components/finance/FinanceShareDialog";
import { InitialsStack } from "@/components/finance/InitialsTile";
import {
	findProjectHome,
	useHubTeam,
} from "@/components/finance/nav/useManagedTeams";
import { FinanceStatusBadge } from "@/components/finance/portfolio/FinancePrimitives";
import {
	type FinanceSharedSearch,
	validateFinanceSharedSearch,
} from "@/components/finance/portfolio/financeSearch";
import { PortfolioOverview } from "@/components/finance/portfolio/PortfolioOverview";
import {
	TeamFinanceChrome,
	visibleTeamTabs,
} from "@/components/finance/team/TeamFinanceChrome";
import { useTeamFinanceProjectOptions } from "@/components/finance/team/useTeamFinanceProjectOptions";
import { formatCurrency } from "@/lib/currency";
import {
	type FinanceBookMember,
	type FinanceHubTeam,
	financeBooksService,
} from "@/services/financeBooks.service";
import { financeExpensesService } from "@/services/financeExpenses.service";
import { teamFinanceService } from "@/services/teamFinance.service";

/**
 * One team's finance at a glance — the only team page (a team's "book" is
 * storage behind it, never a second place): hours by approval state, money
 * in (billed, collected, open), money out (payouts + expenses), the projects
 * whose finance lives here, and the revenue rollup.
 *
 * Contracts are deliberately absent — they live in Engagements → Contracts.
 * People (team members, pending invites, finance access) have their own tab.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/team/$teamId/",
)({
	validateSearch: (search: Record<string, unknown>): FinanceSharedSearch =>
		validateFinanceSharedSearch(search),
	component: TeamFinanceOverviewPage,
});

function capitalize(value: string): string {
	return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function memberName(member: FinanceBookMember): string {
	return (
		member.user?.display_name ??
		member.user?.email ??
		member.invited_email ??
		"Member"
	);
}

function formatHours(seconds: number): string {
	return `${(seconds / 3600).toFixed(1)}h`;
}

function TeamFinanceOverviewPage() {
	const { teamId } = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate();
	const [shareOpen, setShareOpen] = useState(false);
	const { team, hubQuery } = useHubTeam(teamId);
	const tabs = visibleTeamTabs(team).map((tab) => tab.id);
	const isAdmin =
		team?.my_team_role === "owner" || team?.my_team_role === "admin";

	const filters = {
		q: search.q,
		project_id: search.projectId,
		project_status: search.projectStatus,
		currency: search.currency,
		from: search.from,
		to: search.to,
	};
	// Team-finance endpoints are team-admin gated; a finance-role holder who
	// is not a team admin sees the book-backed parts of this page instead.
	const portfolioQuery = useQuery({
		queryKey: ["team-finance", "portfolio", teamId, filters],
		queryFn: () => teamFinanceService.portfolio(teamId, filters),
		enabled: isAdmin,
	});
	const projectOptionsQuery = useTeamFinanceProjectOptions(teamId, search);

	const bookId = team?.book?.id;
	const membersQuery = useQuery({
		queryKey: ["finance-books", "members", bookId],
		queryFn: () => financeBooksService.listMembers(bookId as string),
		enabled: Boolean(bookId),
	});

	const updateSearch = (patch: Partial<FinanceSharedSearch>) =>
		void navigate({
			to: "/engagements/finance/team/$teamId",
			params: { teamId },
			search: { ...search, ...patch },
			replace: true,
		});

	const hasRollup = (portfolioQuery.data?.projects.length ?? 0) > 0;
	const canManage =
		team?.book_role === "owner" || team?.book_role === "manager";

	return (
		<TeamFinanceChrome
			teamId={teamId}
			section="overview"
			search={search}
			projects={projectOptionsQuery.data?.projects ?? []}
			onChange={updateSearch}
			showFilters={false}
			roleLabel={
				team
					? team.my_team_role === "owner" || team.my_team_role === "admin"
						? capitalize(team.my_team_role)
						: (FINANCE_ROLE_LABELS[team.book_role ?? ""] ?? undefined)
					: undefined
			}
			actions={
				team ? (
					<>
						<InitialsStack names={(membersQuery.data ?? []).map(memberName)} />
						{team.book ? (
							<button
								type="button"
								onClick={() => setShareOpen(true)}
								className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
							>
								<Share2 className="h-4 w-4" />
								Share
							</button>
						) : null}
					</>
				) : null
			}
		>
			{hubQuery.isPending ? null : !team ? (
				<AppEmptyState
					icon={Wallet}
					title="Team finance not available"
					description="You don't have finance access to this team. Ask its owner to share it with you."
				/>
			) : (
				<div className="space-y-8 pb-8">
					{!team.book ? <SetUpTeamFinance team={team} /> : null}

					<TeamKpis
						teamId={teamId}
						team={team}
						canSeeMoneyOut={tabs.includes("expenses")}
						portfolioTotals={portfolioQuery.data?.totals_by_currency}
					/>

					<section>
						<SectionHeading
							title="Projects"
							hint="Each project with a signed client contract has its own finance here. Archived when the contract ends."
						/>
						{team.book ? (
							<>
								<ProjectList team={team} />
								<ProjectBooksSection
									bookId={team.book.id}
									teamId={teamId}
									canManageBook={Boolean(canManage)}
									existingProjectIds={team.project_books
										.map((entry) => entry.book.project_id)
										.filter((id): id is string => Boolean(id))}
								/>
							</>
						) : (
							<ProjectList team={team} />
						)}
					</section>

					{hasRollup ? (
						<PortfolioOverview
							loading={portfolioQuery.isPending}
							portfolio={portfolioQuery.data}
							onOpen={(projectId) => {
								const home = findProjectHome(hubQuery.data, projectId);
								if (home?.teamId === teamId) {
									void navigate({
										to: "/engagements/finance/team/$teamId/project/$bookId",
										params: home,
										search: { tab: "invoices" },
									});
									return;
								}
								void navigate({
									to: "/engagements/finance/team/$teamId/invoices",
									params: { teamId },
									search: { ...search, projectId },
								});
							}}
						/>
					) : null}

					{team.book ? (
						<ExportSection
							bookId={team.book.id}
							canViewTime={
								tabs.includes("time-logs") || Boolean(team.book_role)
							}
						/>
					) : null}
				</div>
			)}

			{team?.book ? (
				<FinanceShareDialog
					bookId={team.book.id}
					bookTitle={`${team.team_name} · Team finance`}
					canManage={canManage}
					open={shareOpen}
					onClose={() => setShareOpen(false)}
				/>
			) : null}
		</TeamFinanceChrome>
	);
}

function SetUpTeamFinance({ team }: { team: FinanceHubTeam }) {
	return (
		<AppSurfaceCard className="flex flex-wrap items-center justify-between gap-4 border-primary/30 px-5 py-4">
			<div className="min-w-0">
				<p className="text-sm font-semibold text-foreground">
					Set up {team.team_name}&apos;s finance
				</p>
				<p className="mt-0.5 text-xs text-muted-foreground">
					Turns on project finance, exports, and sharing with an accountant or
					manager. Time logs, rates, and payouts already work without it.
				</p>
			</div>
			{team.can_create ? (
				<Link
					to="/engagements/finance/setup/team"
					className="app-cta inline-flex shrink-0 items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white"
				>
					<Plus className="h-4 w-4" />
					Set up
				</Link>
			) : (
				<span className="text-xs text-muted-foreground">
					Only the team owner can set this up.
				</span>
			)}
		</AppSurfaceCard>
	);
}

/**
 * Hours by approval state, money in, money out. Money in comes from the
 * team's invoices (billed / collected / open), money out from payouts and
 * recorded expenses — all time, one line per currency.
 */
function TeamKpis({
	teamId,
	team,
	canSeeMoneyOut,
	portfolioTotals,
}: {
	teamId: string;
	team: FinanceHubTeam;
	canSeeMoneyOut: boolean;
	portfolioTotals:
		| Array<{
				currency: string;
				revenue: number;
				collected: number;
				outstanding: number;
		  }>
		| undefined;
}) {
	const bookId = team.book?.id;
	const overviewQuery = useQuery({
		queryKey: ["finance-books", bookId, "overview"],
		queryFn: () => financeBooksService.overview(bookId as string),
		enabled: Boolean(bookId),
	});
	const expensesQuery = useQuery({
		queryKey: ["finance-expenses", teamId, undefined, "all"],
		queryFn: () => financeExpensesService.list(teamId),
		enabled: canSeeMoneyOut,
	});

	const time = overviewQuery.data?.time;
	const moneyOut = expensesQuery.data?.summary ?? [];
	const moneyIn = portfolioTotals ?? [];

	return (
		<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
			<StatTile
				label="Team hours"
				value={time ? formatHours(time.total_seconds) : "—"}
				hint={
					time?.by_member.length
						? `${time.by_member.length} ${time.by_member.length === 1 ? "person" : "people"} logged time`
						: bookId
							? "no time logged yet"
							: "set up team finance to see hours"
				}
			/>
			<StatTile
				label="Awaiting approval"
				value={time ? formatHours(time.pending_seconds) : "—"}
				hint={
					time
						? `${formatHours(time.approved_seconds)} approved, ready for payout`
						: "submitted, not yet decided"
				}
				tone={time && time.pending_seconds > 0 ? "attention" : undefined}
			/>
			<StatTile
				label="Money in"
				value={
					moneyIn.length
						? moneyIn
								.map((row) => formatCurrency(row.collected, row.currency))
								.join("\n")
						: "—"
				}
				hint={
					moneyIn.length
						? moneyIn
								.map(
									(row) =>
										`${formatCurrency(row.revenue, row.currency)} billed · ${formatCurrency(row.outstanding, row.currency)} open`,
								)
								.join(" · ")
						: "collected from client invoices"
				}
				compact={moneyIn.length > 1}
			/>
			<StatTile
				label="Money out"
				value={
					!canSeeMoneyOut || expensesQuery.isError
						? "—"
						: moneyOut.length
							? moneyOut
									.map((row) => formatCurrency(row.total, row.currency))
									.join("\n")
							: "Nothing yet"
				}
				hint={
					expensesQuery.isError
						? "could not load money out"
						: canSeeMoneyOut
							? "payouts + expenses, all time"
							: "visible to owners, managers, and accountants"
				}
				compact={moneyOut.length > 1}
			/>
		</div>
	);
}

/** Before the team book exists: the projects the hub already knows about. */
function ProjectList({ team }: { team: FinanceHubTeam }) {
	return (
		<AppSurfaceCard className="overflow-hidden">
			{team.project_books.length === 0 ? (
				<p className="px-5 py-4 text-sm text-muted-foreground">
					No project finance yet — it opens when a project&apos;s client
					contract is signed.
				</p>
			) : (
				team.project_books.map((entry) => (
					<Link
						key={entry.book.id}
						to="/engagements/finance/team/$teamId/project/$bookId"
						params={{ teamId: team.team_id, bookId: entry.book.id }}
						className="flex items-center justify-between gap-4 border-b border-border/50 px-5 py-4 transition-colors last:border-b-0 hover:bg-muted/40"
					>
						<span className="flex min-w-0 items-center gap-3.5">
							<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
								<Folder className="h-[18px] w-[18px]" />
							</span>
							<span className="block truncate text-sm font-semibold text-foreground">
								{entry.project_title}
							</span>
						</span>
						<span className="flex shrink-0 items-center gap-3">
							{entry.contract_status ? (
								<FinanceStatusBadge status={entry.contract_status} />
							) : null}
							<ChevronRight className="h-4 w-4 text-muted-foreground" />
						</span>
					</Link>
				))
			)}
		</AppSurfaceCard>
	);
}

function SectionHeading({ title, hint }: { title: string; hint: string }) {
	return (
		<div className="mb-3">
			<h2 className="text-base font-semibold text-foreground">{title}</h2>
			<p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
		</div>
	);
}

function StatTile({
	label,
	value,
	hint,
	tone,
	compact,
}: {
	label: string;
	value: ReactNode;
	hint: string;
	tone?: "attention";
	compact?: boolean;
}) {
	return (
		<div className="rounded-2xl border border-border bg-card px-5 py-4">
			<p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
				{label}
			</p>
			<p
				className={`mt-1.5 whitespace-pre-line font-bold tracking-tight ${compact ? "text-base" : "text-2xl"} ${
					tone === "attention" ? "text-warning-foreground" : "text-foreground"
				}`}
			>
				{value}
			</p>
			<p className="mt-1 text-xs text-muted-foreground">{hint}</p>
		</div>
	);
}
