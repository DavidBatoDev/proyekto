import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	BookOpen,
	CircleDollarSign,
	FolderKanban,
	Plus,
	UserRound,
	Users,
} from "lucide-react";
import {
	AppEmptyState,
	AppSectionHeader,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { ProjectFinancials } from "@/components/finance/ProjectFinancials";
import {
	FinanceLoading,
	FinanceStatusBadge,
} from "@/components/finance/portfolio/FinancePrimitives";
import {
	type FinanceSharedSearch,
	validateFinanceSharedSearch,
} from "@/components/finance/portfolio/financeSearch";
import { PortfolioOverview } from "@/components/finance/portfolio/PortfolioOverview";
import { useFinanceProjectOptions } from "@/components/finance/portfolio/useFinanceProjectOptions";
import { isActiveConsultant } from "@/lib/auth-utils";
import { financeService } from "@/services/finance.service";
import {
	type FinanceHub,
	type FinanceHubTeam,
	financeBooksService,
} from "@/services/financeBooks.service";
import { useProfile } from "@/stores/authStore";

/**
 * The finance hub — every role's front door.
 *
 * Renders the book-based finance world (personal F1, team F2 with nested F3
 * project books, books shared into the caller) for everyone, and then, for
 * verified consultants only, the legacy portfolio overview below it. The
 * legacy `?tab=` URLs land on the redirect stubs left behind at the old
 * paths, which translate the tab before bouncing here — so this route no
 * longer declares `tab` at all.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/_portfolio/",
)({
	validateSearch: (search: Record<string, unknown>): FinanceSharedSearch =>
		validateFinanceSharedSearch(search),
	component: FinanceOverviewPage,
});

const BOOK_ROLE_LABELS: Record<string, string> = {
	owner: "Owner",
	manager: "Manager",
	accountant: "Accountant",
	viewer_client: "Client viewer",
	viewer: "Viewer",
};

function FinanceOverviewPage() {
	const search = Route.useSearch();
	const navigate = useNavigate();
	const profile = useProfile();
	const isConsultant = isActiveConsultant(profile);

	const hubQuery = useQuery({
		queryKey: ["finance-books", "hub"],
		queryFn: financeBooksService.hub,
	});

	const portfolioQuery = useQuery({
		queryKey: [
			"finance",
			"portfolio",
			{
				q: search.q,
				project_id: search.projectId,
				project_status: search.projectStatus,
				currency: search.currency,
				from: search.from,
				to: search.to,
			},
		],
		queryFn: () =>
			financeService.portfolio({
				q: search.q,
				project_id: search.projectId,
				project_status: search.projectStatus,
				currency: search.currency,
				from: search.from,
				to: search.to,
			}),
		enabled: isConsultant,
	});
	// Keeps the layout's project facet warm on a direct hit to this URL.
	useFinanceProjectOptions(search, isConsultant);

	// The filters bar is consultant-only chrome; a picked project drills the
	// consultant into that project's financials in place of the hub.
	if (isConsultant && search.projectId) {
		return <ProjectFinancials projectId={search.projectId} />;
	}

	return (
		<div className="space-y-8 pb-8">
			{hubQuery.isPending ? (
				<FinanceLoading />
			) : hubQuery.isError ? (
				<AppEmptyState
					icon={CircleDollarSign}
					title="Could not load your finance hub"
					description={hubQuery.error.message}
					className="mt-4"
					action={
						<button
							type="button"
							onClick={() => void hubQuery.refetch()}
							className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
						>
							Try again
						</button>
					}
				/>
			) : (
				<FinanceHubBody hub={hubQuery.data} />
			)}

			{isConsultant ? (
				<section>
					<AppSectionHeader
						title="Consultant portfolio"
						subtitle="Your book of business — revenue, invoices, and delivery costs across the projects you lead."
						className="mt-2"
					/>
					<div className="mt-4">
						<PortfolioOverview
							loading={portfolioQuery.isPending}
							portfolio={portfolioQuery.data}
							onOpen={(projectId) =>
								void navigate({
									to: "/engagements/finance",
									search: { ...search, projectId },
									replace: true,
								})
							}
						/>
					</div>
				</section>
			) : null}
		</div>
	);
}

function FinanceHubBody({ hub }: { hub: FinanceHub }) {
	return (
		<>
			{/* ─── My finance (F1) ─────────────────────────────────────────── */}
			<section>
				<AppSectionHeader
					title="My finance"
					subtitle="Your private book — hours worked, payouts, and rates across your engaged projects."
					className="mt-2"
				/>
				{hub.personal ? (
					<Link to="/engagements/finance/me" className="mt-3 block">
						<AppSurfaceCard className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:border-slate-400">
							<div className="flex min-w-0 items-center gap-3">
								<span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
									<UserRound className="h-4 w-4" />
								</span>
								<div className="min-w-0">
									<p className="truncate text-sm font-semibold text-slate-900">
										Personal finance
									</p>
									<p className="text-xs text-slate-500">
										Display currency {hub.personal.currency}
										{hub.personal.status === "archived" ? " · archived" : ""}
									</p>
								</div>
							</div>
							<span className="shrink-0 text-xs font-semibold text-slate-500">
								Open →
							</span>
						</AppSurfaceCard>
					</Link>
				) : (
					<AppEmptyState
						icon={CircleDollarSign}
						title="Create your personal finance"
						description="Anyone can create one — a signed contract is what unlocks the timer and payout data."
						className="mt-3"
						action={
							<Link
								to="/engagements/finance/setup/personal"
								className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
							>
								Set up my finance
							</Link>
						}
					/>
				)}
			</section>

			{/* ─── My teams (F2 + nested F3) ───────────────────────────────── */}
			{hub.teams.length > 0 ? (
				<section>
					<AppSectionHeader
						title="My teams"
						subtitle="Each team keeps one finance book, with a child book per contracted project."
						className="mt-2"
					/>
					<div className="mt-3 space-y-3">
						{hub.teams.map((team) => (
							<HubTeamCard key={team.team_id} team={team} />
						))}
					</div>
				</section>
			) : null}

			{/* ─── Shared with me ──────────────────────────────────────────── */}
			{hub.shared.length > 0 ? (
				<section>
					<AppSectionHeader
						title="Shared with me"
						subtitle="Books other teams granted you access to — as an accountant, client viewer, or viewer."
						className="mt-2"
					/>
					<div className="mt-3 space-y-2">
						{hub.shared.map((entry) => (
							<Link
								key={entry.book.id}
								to="/engagements/finance/book/$bookId"
								params={{ bookId: entry.book.id }}
								className="block"
							>
								<AppSurfaceCard className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:border-slate-400">
									<div className="flex min-w-0 items-center gap-3">
										<span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
											<BookOpen className="h-4 w-4" />
										</span>
										<div className="min-w-0">
											<p className="truncate text-sm font-semibold text-slate-900">
												{entry.project_title ??
													entry.team_name ??
													"Finance book"}
											</p>
											<p className="truncate text-xs text-slate-500">
												{entry.team_name && entry.project_title
													? `${entry.team_name} · `
													: ""}
												{entry.book.kind === "project"
													? "Project book"
													: entry.book.kind === "team"
														? "Team book"
														: "Personal book"}{" "}
												· {entry.book.currency}
											</p>
										</div>
									</div>
									<span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
										{BOOK_ROLE_LABELS[entry.role] ?? entry.role}
									</span>
								</AppSurfaceCard>
							</Link>
						))}
					</div>
				</section>
			) : null}
		</>
	);
}

function HubTeamCard({ team }: { team: FinanceHubTeam }) {
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
				{team.book ? (
					<Link
						to="/engagements/finance/book/$bookId"
						params={{ bookId: team.book.id }}
						className="shrink-0 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-900 hover:text-slate-900"
					>
						Team finance
					</Link>
				) : team.can_create ? (
					<Link
						to="/engagements/finance/setup/team"
						className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-700"
					>
						<Plus className="h-3.5 w-3.5" />
						Create team finance
					</Link>
				) : (
					<span className="shrink-0 text-xs text-slate-400">
						No finance book yet
					</span>
				)}
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
			) : null}

			{team.book && team.book_role === "owner" ? (
				<p className="mt-3 text-xs text-slate-500">
					{team.project_books.length === 0
						? "No project books yet — add contracted projects from the "
						: "Add more contracted projects from the "}
					<Link
						to="/engagements/finance/book/$bookId"
						params={{ bookId: team.book.id }}
						className="font-semibold text-slate-700 underline-offset-2 hover:underline"
					>
						team finance book
					</Link>
					.
				</p>
			) : null}
		</AppSurfaceCard>
	);
}
