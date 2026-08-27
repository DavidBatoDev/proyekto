import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	CircleDollarSign,
	Clock,
	FolderKanban,
	HandCoins,
	Hourglass,
	Users,
	Wallet,
} from "lucide-react";
import {
	AppEmptyState,
	AppSectionHeader,
	AppStatCard,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import {
	FINANCE_CRUMB_LINK_CLASS,
	FinanceBreadcrumbs,
	FinanceCurrentCrumb,
} from "@/components/finance/portfolio/FinanceBreadcrumbs";
import {
	FinanceLoading,
	FinanceStatusBadge,
} from "@/components/finance/portfolio/FinancePrimitives";
import {
	type FinanceHubTeam,
	financeBooksService,
} from "@/services/financeBooks.service";

/**
 * The personal finance (F1) dashboard: hours worked, payouts received, and
 * the caller's teams with their finance books. Available to every execution
 * user once they create their book; a zero-contract book renders empty
 * states — contracts unlock data, never creation.
 */
export const Route = createFileRoute("/_execution/engagements/finance/me/")({
	component: PersonalFinancePage,
});

function formatHours(seconds: number): string {
	return `${(seconds / 3600).toFixed(1)}h`;
}

function PersonalFinancePage() {
	const booksQuery = useQuery({
		queryKey: ["finance-books", "mine"],
		queryFn: financeBooksService.listMine,
	});
	const personalBook = booksQuery.data?.find(
		(book) => book.kind === "personal",
	);

	const dashboardQuery = useQuery({
		queryKey: ["finance-books", "personal-dashboard"],
		queryFn: financeBooksService.personalDashboard,
		enabled: Boolean(personalBook),
	});

	if (booksQuery.isPending) return <FinanceLoading />;

	return (
		<div className="app-shell-bg min-h-full px-5 py-4 md:px-8 md:py-5">
			<div className="mx-auto w-full max-w-6xl">
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
						<FinanceCurrentCrumb key="me">My finance</FinanceCurrentCrumb>,
					]}
				/>

				{/*
				 * A failed listMine must read as an outage, not as "you have no
				 * book" — showing the create CTA on error walked users into a 409.
				 */}
				{booksQuery.isError ? (
					<div className="mt-8">
						<AppEmptyState
							icon={CircleDollarSign}
							title="Could not load your finance"
							description={booksQuery.error.message}
							action={
								<button
									type="button"
									onClick={() => void booksQuery.refetch()}
									className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
								>
									Try again
								</button>
							}
						/>
					</div>
				) : !personalBook ? (
					<div className="mt-8">
						<AppEmptyState
							icon={CircleDollarSign}
							title="Create your personal finance"
							description="Your private view of hours worked, payouts, and rates across your engaged projects. Anyone can create one — a signed contract is what unlocks the timer and payout data."
							action={
								<Link
									to="/engagements/finance/setup/personal"
									className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
								>
									Set up my finance
								</Link>
							}
						/>
					</div>
				) : dashboardQuery.isPending ? (
					<FinanceLoading />
				) : dashboardQuery.isError ? (
					<div className="mt-8">
						<AppEmptyState
							icon={CircleDollarSign}
							title="Could not load your finance"
							description={dashboardQuery.error.message}
						/>
					</div>
				) : (
					<PersonalDashboardBody
						dashboard={dashboardQuery.data}
						currency={personalBook.currency}
					/>
				)}
			</div>
		</div>
	);
}

function PersonalDashboardBody({
	dashboard,
	currency,
}: {
	dashboard: NonNullable<
		Awaited<ReturnType<typeof financeBooksService.personalDashboard>>
	>;
	currency: string;
}) {
	const { hours, payouts_in, engaged_projects } = dashboard;
	const hasContracts = engaged_projects.length > 0;

	const hubQuery = useQuery({
		queryKey: ["finance-books", "hub"],
		queryFn: financeBooksService.hub,
	});
	const teams = hubQuery.data?.teams ?? [];

	return (
		<>
			<AppSectionHeader
				title="My finance"
				subtitle={`Your private book — hours, payouts, and engaged projects. Display currency ${currency}.`}
				className="mt-4"
			/>

			<div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				<AppStatCard
					label="Hours worked"
					value={formatHours(hours.total_seconds)}
					icon={Clock}
				/>
				<AppStatCard
					label="This month"
					value={formatHours(hours.month_seconds)}
					icon={Hourglass}
				/>
				<AppStatCard
					label="Awaiting approval"
					value={formatHours(hours.pending_seconds)}
					icon={Hourglass}
				/>
			</div>

			<AppSectionHeader
				title="Money in"
				subtitle="Recorded payouts, grouped by currency."
				className="mt-8"
			/>
			{payouts_in.length === 0 ? (
				<AppEmptyState
					icon={Wallet}
					title="No payouts yet"
					description={
						hasContracts
							? "Payouts recorded by your teams will appear here."
							: "Payouts arrive through engaged projects. Once a contract with a team is signed, your payouts will land here."
					}
					className="mt-3"
				/>
			) : (
				<div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{payouts_in.map((entry) => (
						<AppStatCard
							key={entry.currency}
							label={`${entry.currency} · ${entry.count} payout${entry.count === 1 ? "" : "s"}`}
							value={`${entry.total.toLocaleString()} ${entry.currency}`}
							icon={HandCoins}
						/>
					))}
				</div>
			)}

			<AppSectionHeader
				title="My teams"
				subtitle="Your teams and the finance books behind them — signed contracts unlock the timer and payouts per project."
				className="mt-8"
			/>
			{hubQuery.isPending ? (
				<p className="mt-3 text-sm text-slate-500">Loading your teams…</p>
			) : teams.length === 0 ? (
				<AppEmptyState
					icon={Users}
					title="No teams yet"
					description="When you join or create a team, its projects and finance books appear here. Signed contracts unlock the execution timer and payouts."
					className="mt-3"
				/>
			) : (
				<div className="mt-3 space-y-3">
					{teams.map((team) => (
						<MyTeamBlock
							key={team.team_id}
							team={team}
							engagedProjects={engaged_projects}
						/>
					))}
				</div>
			)}
		</>
	);
}

function MyTeamBlock({
	team,
	engagedProjects,
}: {
	team: FinanceHubTeam;
	engagedProjects: NonNullable<
		Awaited<ReturnType<typeof financeBooksService.personalDashboard>>
	>["engaged_projects"];
}) {
	const isOwner = team.my_team_role === "owner";

	return (
		<AppSurfaceCard className="p-5">
			<div className="flex items-center justify-between gap-4">
				<div className="flex min-w-0 items-center gap-3">
					{team.avatar_url ? (
						<img
							src={team.avatar_url}
							alt=""
							className="h-9 w-9 shrink-0 rounded-lg object-cover"
						/>
					) : (
						<span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
							<Users className="h-4 w-4" />
						</span>
					)}
					<div className="min-w-0">
						<p className="truncate text-sm font-semibold text-slate-900">
							{team.team_name}
						</p>
						<p className="text-xs text-slate-500 capitalize">
							{team.my_team_role.replace(/_/g, " ")}
						</p>
					</div>
				</div>
				{isOwner ? (
					<div className="flex shrink-0 items-center gap-2">
						{team.book ? (
							<Link
								to="/engagements/finance/book/$bookId"
								params={{ bookId: team.book.id }}
								className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-900 hover:text-slate-900"
							>
								Team finance
							</Link>
						) : null}
						<Link
							to="/engagements/finance/team/$teamId/addons"
							params={{ teamId: team.team_id }}
							className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-900 hover:text-slate-900"
						>
							Add-ons
						</Link>
					</div>
				) : null}
			</div>

			{team.project_books.length > 0 ? (
				<div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
					{team.project_books.map((entry) => (
						<Link
							key={entry.book.id}
							to="/engagements/finance/book/$bookId"
							params={{ bookId: entry.book.id }}
							className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-slate-50"
						>
							<span className="flex min-w-0 items-center gap-2">
								<FolderKanban className="h-4 w-4 shrink-0 text-slate-400" />
								<span className="truncate text-sm font-medium text-slate-800">
									{entry.project_title}
								</span>
							</span>
							<FinanceStatusBadge status={entry.contract_status} />
						</Link>
					))}
				</div>
			) : engagedProjects.length > 0 ? (
				// No project books yet — fall back to the caller's engaged
				// contracts so the block still shows where their time can go.
				<div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
					{engagedProjects.map((project) => (
						<div
							key={project.contract_id}
							className="flex items-center justify-between gap-3 px-2 py-2"
						>
							<span className="truncate text-sm font-medium text-slate-800">
								{project.project_title}
							</span>
							<FinanceStatusBadge status={project.contract_status} />
						</div>
					))}
				</div>
			) : null}
		</AppSurfaceCard>
	);
}
