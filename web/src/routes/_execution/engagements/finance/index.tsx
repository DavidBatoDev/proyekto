import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	BarChart3,
	BookOpen,
	ChevronRight,
	CircleDollarSign,
	FolderKanban,
	Plus,
	Users,
	Wallet,
} from "lucide-react";
import {
	AppEmptyState,
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
import { isActiveConsultant } from "@/lib/auth-utils";
import { financeService } from "@/services/finance.service";
import {
	type FinanceHub,
	type FinanceHubTeam,
	financeBooksService,
} from "@/services/financeBooks.service";
import { useProfile } from "@/stores/authStore";

/**
 * Finance home — the launcher, and every role's front door.
 *
 * Three levels, Google-Drive style: Personal (your own book), Teams (each
 * with its project books nested inside), and Shared with me. This page names
 * the places; the numbers live inside them. The one exception is the
 * consultant portfolio card at the bottom — the cross-project rollup is a
 * destination of its own at `/engagements/finance/portfolio`, and the card is
 * its door.
 *
 * Deliberately no tabs and no filter bar: this route sits OUTSIDE the
 * `_portfolio` layout that carries them. Legacy links arriving with the old
 * portfolio search params are accepted and ignored.
 */
export const Route = createFileRoute("/_execution/engagements/finance/")({
	validateSearch: () => ({}),
	component: FinanceHomePage,
});

const BOOK_ROLE_LABELS: Record<string, string> = {
	owner: "Owner",
	manager: "Manager",
	accountant: "Accountant",
	viewer_client: "Client viewer",
	viewer: "Viewer",
};

function FinanceHomePage() {
	const profile = useProfile();
	const isConsultant = isActiveConsultant(profile);

	const hubQuery = useQuery({
		queryKey: ["finance-books", "hub"],
		queryFn: financeBooksService.hub,
	});

	return (
		<div className="app-shell-bg min-h-full px-5 py-4 md:px-8 md:py-5">
			<div className="mx-auto w-full max-w-6xl pb-10">
				<FinanceBreadcrumbs
					items={[
						<Link
							key="engagements"
							to="/engagements"
							className={FINANCE_CRUMB_LINK_CLASS}
						>
							Engagements
						</Link>,
						<FinanceCurrentCrumb key="finance">Finance</FinanceCurrentCrumb>,
					]}
				/>

				<div className="mt-2">
					<h1 className="text-2xl font-bold tracking-tight text-foreground">
						Finance
					</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						Your money in one place — your personal book, the teams you run, and
						the books others shared with you.
					</p>
				</div>

				{hubQuery.isPending ? (
					<FinanceLoading />
				) : hubQuery.isError ? (
					<AppEmptyState
						icon={CircleDollarSign}
						title="Could not load your finance"
						description={hubQuery.error.message}
						className="mt-8"
						action={
							<button
								type="button"
								onClick={() => void hubQuery.refetch()}
								className="app-cta inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white"
							>
								Try again
							</button>
						}
					/>
				) : (
					<HomeBody hub={hubQuery.data} isConsultant={isConsultant} />
				)}
			</div>
		</div>
	);
}

function HomeBody({
	hub,
	isConsultant,
}: {
	hub: FinanceHub;
	isConsultant: boolean;
}) {
	return (
		<>
			{/* ─── Personal ────────────────────────────────────────────────── */}
			<h2 className="mt-8 text-base font-semibold text-foreground">Personal</h2>
			{hub.personal ? (
				<Link to="/engagements/finance/me" className="mt-3 block">
					<PersonalCard currency={hub.personal.currency} />
				</Link>
			) : (
				<AppSurfaceCard className="mt-3 flex flex-wrap items-center justify-between gap-4 px-5 py-4">
					<div className="flex min-w-0 items-center gap-3">
						<span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
							<Wallet className="h-5 w-5" />
						</span>
						<div className="min-w-0">
							<p className="text-sm font-semibold text-foreground">
								My finance
							</p>
							<p className="text-xs text-muted-foreground">
								Anyone can create one — a signed contract is what unlocks the
								timer and payout data.
							</p>
						</div>
					</div>
					<Link
						to="/engagements/finance/setup/personal"
						className="app-cta inline-flex shrink-0 items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white"
					>
						Set up my finance
					</Link>
				</AppSurfaceCard>
			)}

			{/* ─── Teams ───────────────────────────────────────────────────── */}
			{hub.teams.length > 0 && (
				<>
					<div className="mt-8">
						<h2 className="text-base font-semibold text-foreground">Teams</h2>
						<p className="mt-0.5 text-sm text-muted-foreground">
							Teams you own or administer. Each project gets its own finance
							once a client contract is signed.
						</p>
					</div>
					<div className="mt-3 grid gap-4 lg:grid-cols-2">
						{hub.teams.map((team) => (
							<HomeTeamCard key={team.team_id} team={team} />
						))}
					</div>
				</>
			)}

			{/* ─── Shared with me ──────────────────────────────────────────── */}
			{hub.shared.length > 0 && (
				<>
					<div className="mt-8">
						<h2 className="text-base font-semibold text-foreground">
							Shared with me
						</h2>
						<p className="mt-0.5 text-sm text-muted-foreground">
							Books other owners granted you. Your role decides what you see.
						</p>
					</div>
					<AppSurfaceCard className="mt-3 divide-y divide-border overflow-hidden">
						{hub.shared.map((entry) => (
							<Link
								key={entry.book.id}
								to="/engagements/finance/book/$bookId"
								params={{ bookId: entry.book.id }}
								className="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-muted/40 md:px-5"
							>
								<span className="flex min-w-0 items-center gap-3">
									<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success/10 text-success-foreground">
										<BookOpen className="h-5 w-5" />
									</span>
									<span className="min-w-0">
										<span className="block truncate text-sm font-semibold text-foreground">
											{entry.project_title ?? entry.team_name ?? "Finance book"}
										</span>
										<span className="block truncate text-xs text-muted-foreground">
											{entry.team_name && entry.project_title
												? `${entry.team_name} · `
												: ""}
											{entry.book.kind === "project"
												? "Project finance"
												: entry.book.kind === "team"
													? "Team finance"
													: "Personal finance"}{" "}
											· {entry.book.currency}
										</span>
									</span>
								</span>
								<span className="flex shrink-0 items-center gap-3">
									<span className="rounded-lg bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">
										{BOOK_ROLE_LABELS[entry.role] ?? entry.role}
									</span>
									<ChevronRight className="h-4 w-4 text-muted-foreground" />
								</span>
							</Link>
						))}
					</AppSurfaceCard>
				</>
			)}

			{/* ─── Consultant portfolio door ───────────────────────────────── */}
			{isConsultant && <PortfolioDoor />}
		</>
	);
}

/** The personal card, with live stats once the book exists. */
function PersonalCard({ currency }: { currency: string }) {
	const dashboardQuery = useQuery({
		queryKey: ["finance-books", "personal-dashboard"],
		queryFn: financeBooksService.personalDashboard,
	});
	const dashboard = dashboardQuery.data;
	const monthHours = dashboard
		? `${(dashboard.hours.month_seconds / 3600).toFixed(1)}h`
		: "—";
	const moneyIn = dashboard
		? (dashboard.payouts_in.find((entry) => entry.currency === currency) ??
			dashboard.payouts_in[0])
		: undefined;
	const contracts = dashboard ? dashboard.engaged_projects.length : undefined;

	return (
		<AppSurfaceCard className="flex flex-wrap items-center gap-5 px-5 py-4 transition-colors hover:border-primary/40">
			<span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
				<Wallet className="h-5 w-5" />
			</span>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-semibold text-foreground">My finance</p>
				<p className="text-xs text-muted-foreground">
					Your hours, payouts, rates, and every contract you hold — in any seat.
				</p>
			</div>
			<div className="hidden items-center gap-7 md:flex">
				<HomeStat label="This month" value={monthHours} />
				<HomeStat
					label="Money in"
					value={
						moneyIn
							? `${moneyIn.total.toLocaleString()} ${moneyIn.currency}`
							: "—"
					}
				/>
				<HomeStat
					label="Contracts"
					value={contracts !== undefined ? `${contracts} engaged` : "—"}
				/>
			</div>
			<span className="app-cta inline-flex shrink-0 items-center rounded-lg px-4 py-2 text-sm font-semibold text-white">
				Open
			</span>
		</AppSurfaceCard>
	);
}

function HomeStat({ label, value }: { label: string; value: string }) {
	return (
		<span className="block text-right">
			<span className="block text-[11px] font-bold tracking-wider text-muted-foreground/70 uppercase">
				{label}
			</span>
			<span className="mt-0.5 block font-['Sora',sans-serif] text-base font-bold text-foreground">
				{value}
			</span>
		</span>
	);
}

function HomeTeamCard({ team }: { team: FinanceHubTeam }) {
	return (
		<AppSurfaceCard className="self-start overflow-hidden">
			<div className="flex items-center gap-3 border-b border-border/60 px-5 py-4">
				{team.avatar_url ? (
					<img
						src={team.avatar_url}
						alt=""
						className="h-10 w-10 shrink-0 rounded-xl object-cover"
					/>
				) : (
					<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-info/10 text-info-foreground">
						<Users className="h-5 w-5" />
					</span>
				)}
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<Link
							to="/engagements/finance/team/$teamId"
							params={{ teamId: team.team_id }}
							className="truncate text-sm font-semibold text-foreground hover:text-primary"
						>
							{team.team_name}
						</Link>
						<span className="rounded-lg bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground capitalize">
							{team.my_team_role.replace(/_/g, " ")}
						</span>
					</div>
					<p className="text-xs text-muted-foreground">
						{team.project_books.length === 0
							? "No project finance yet"
							: `${team.project_books.length} project ${
									team.project_books.length === 1 ? "book" : "books"
								}`}
					</p>
				</div>
				{team.book ? (
					<Link
						to="/engagements/finance/book/$bookId"
						params={{ bookId: team.book.id }}
						className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
					>
						Team book
					</Link>
				) : team.can_create ? (
					<Link
						to="/engagements/finance/setup/team"
						className="app-cta inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
					>
						<Plus className="h-3.5 w-3.5" />
						Create
					</Link>
				) : null}
			</div>

			{team.project_books.map((entry) => (
				<Link
					key={entry.book.id}
					to="/engagements/finance/book/$bookId"
					params={{ bookId: entry.book.id }}
					className="flex items-center justify-between gap-3 border-b border-border/40 px-5 py-3 transition-colors last:border-b-0 hover:bg-muted/40"
				>
					<span className="flex min-w-0 items-center gap-3">
						<FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
						<span className="truncate text-sm font-medium text-foreground">
							{entry.project_title}
						</span>
					</span>
					<span className="flex shrink-0 items-center gap-2">
						<FinanceStatusBadge status={entry.contract_status} />
						<ChevronRight className="h-4 w-4 text-muted-foreground" />
					</span>
				</Link>
			))}
		</AppSurfaceCard>
	);
}

/** The consultant's cross-project rollup lives one level down. */
function PortfolioDoor() {
	const portfolioQuery = useQuery({
		queryKey: ["finance", "portfolio", {}],
		queryFn: () => financeService.portfolio({}),
	});
	const lead = portfolioQuery.data?.totals_by_currency[0];

	return (
		<>
			<h2 className="mt-8 text-base font-semibold text-foreground">
				Consultant portfolio
			</h2>
			<Link to="/engagements/finance/portfolio" className="mt-3 block">
				<AppSurfaceCard className="flex flex-wrap items-center gap-5 px-5 py-4 transition-colors hover:border-primary/40">
					<span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-info/10 text-info-foreground">
						<BarChart3 className="h-5 w-5" />
					</span>
					<div className="min-w-0 flex-1">
						<p className="text-sm font-semibold text-foreground">
							Your book of business
						</p>
						<p className="text-xs text-muted-foreground">
							Revenue, receivables, and margin across every project you lead.
						</p>
					</div>
					{lead && (
						<div className="hidden items-center gap-7 md:flex">
							<HomeStat
								label="Billed"
								value={`${lead.revenue.toLocaleString()} ${lead.currency}`}
							/>
							<HomeStat
								label="Outstanding"
								value={`${lead.outstanding.toLocaleString()} ${lead.currency}`}
							/>
						</div>
					)}
					<ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
				</AppSurfaceCard>
			</Link>
		</>
	);
}
