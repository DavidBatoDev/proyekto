import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, FolderKanban, Share2, Users } from "lucide-react";
import { useState } from "react";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import { FinanceShareDialog } from "@/components/finance/FinanceShareDialog";
import { FinanceStatusBadge } from "@/components/finance/portfolio/FinancePrimitives";
import {
	type FinanceSharedSearch,
	validateFinanceSharedSearch,
} from "@/components/finance/portfolio/financeSearch";
import { PortfolioOverview } from "@/components/finance/portfolio/PortfolioOverview";
import { TeamFinanceChrome } from "@/components/finance/team/TeamFinanceChrome";
import { useTeamFinanceProjectOptions } from "@/components/finance/team/useTeamFinanceProjectOptions";
import { financeBooksService } from "@/services/financeBooks.service";
import { teamFinanceService } from "@/services/teamFinance.service";

/**
 * One team's finance overview — the team administrator's ("HR") revenue-side
 * portfolio. `cost`/`margin` come back null and the overview renders billed
 * revenue instead; a project row drills into the team Invoices tab, NOT the
 * consultant's per-project financials (which stay owner-gated).
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/team/$teamId/",
)({
	validateSearch: (search: Record<string, unknown>): FinanceSharedSearch =>
		validateFinanceSharedSearch(search),
	component: TeamFinanceOverviewPage,
});

function TeamFinanceOverviewPage() {
	const { teamId } = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate();

	const filters = {
		q: search.q,
		project_id: search.projectId,
		project_status: search.projectStatus,
		currency: search.currency,
		from: search.from,
		to: search.to,
	};
	const portfolioQuery = useQuery({
		queryKey: ["team-finance", "portfolio", teamId, filters],
		queryFn: () => teamFinanceService.portfolio(teamId, filters),
	});
	const projectOptionsQuery = useTeamFinanceProjectOptions(teamId, search);

	const updateSearch = (patch: Partial<FinanceSharedSearch>) =>
		void navigate({
			to: "/engagements/finance/team/$teamId",
			params: { teamId },
			search: { ...search, ...patch },
			replace: true,
		});

	return (
		<TeamFinanceChrome
			teamId={teamId}
			section="overview"
			search={search}
			projects={projectOptionsQuery.data?.projects ?? []}
			onChange={updateSearch}
		>
			<TeamBooksPanel teamId={teamId} />
			<PortfolioOverview
				loading={portfolioQuery.isPending}
				portfolio={portfolioQuery.data}
				onOpen={(projectId) =>
					void navigate({
						to: "/engagements/finance/team/$teamId/invoices",
						params: { teamId },
						search: { ...search, projectId },
					})
				}
			/>
		</TeamFinanceChrome>
	);
}

/**
 * The team's finance places — its project books and the door to members and
 * sharing — above the revenue rollup. One book per project with a signed
 * client contract; members are managed on the team book, which is also where
 * an accountant or HR manager is invited.
 */
function TeamBooksPanel({ teamId }: { teamId: string }) {
	const [shareOpen, setShareOpen] = useState(false);
	const hubQuery = useQuery({
		queryKey: ["finance-books", "hub"],
		queryFn: financeBooksService.hub,
		staleTime: 60_000,
	});
	const team = hubQuery.data?.teams.find((entry) => entry.team_id === teamId);
	if (!team) return null;

	return (
		<div className="mb-6 grid gap-4 lg:grid-cols-2">
			<AppSurfaceCard className="self-start overflow-hidden">
				<div className="border-b border-border/60 px-5 py-3.5">
					<p className="text-sm font-semibold text-foreground">
						Project finance
					</p>
					<p className="text-xs text-muted-foreground">
						One book per project with a signed client contract.
					</p>
				</div>
				{team.project_books.length === 0 ? (
					<p className="px-5 py-4 text-sm text-muted-foreground">
						No project books yet — they open when a project&apos;s client
						contract is signed.
					</p>
				) : (
					team.project_books.map((entry) => (
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
					))
				)}
			</AppSurfaceCard>

			<AppSurfaceCard className="self-start px-5 py-4">
				<div className="flex items-start justify-between gap-4">
					<div className="min-w-0">
						<p className="flex items-center gap-2 text-sm font-semibold text-foreground">
							<Users className="h-4 w-4 text-muted-foreground" />
							Members &amp; sharing
						</p>
						<p className="mt-1 text-xs text-muted-foreground">
							Invite an accountant or HR manager to this team&apos;s finance.
							Finance access never grants access to the project workspace.
						</p>
					</div>
					{team.book ? (
						<button
							type="button"
							onClick={() => setShareOpen(true)}
							className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
						>
							<Share2 className="h-3.5 w-3.5" />
							Share
						</button>
					) : team.can_create ? (
						<Link
							to="/engagements/finance/setup/team"
							className="app-cta inline-flex shrink-0 items-center rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
						>
							Create team book
						</Link>
					) : null}
				</div>
			</AppSurfaceCard>

			{team.book ? (
				<FinanceShareDialog
					bookId={team.book.id}
					bookTitle={`${team.team_name} · Team finance`}
					canManage={team.book_role === "owner" || team.book_role === "manager"}
					open={shareOpen}
					onClose={() => setShareOpen(false)}
				/>
			) : null}
		</div>
	);
}
