import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { Archive, BookOpen, Folder, Share2 } from "lucide-react";
import { useState } from "react";
import { AppEmptyState } from "@/components/common/AppPrimitives";
import {
	PROJECT_BOOK_TABS,
	type ProjectBookTab,
	ProjectBookWorkspace,
} from "@/components/finance/book/ProjectBookWorkspace";
import {
	FINANCE_ROLE_LABELS,
	FinanceShareDialog,
} from "@/components/finance/FinanceShareDialog";
import { FinanceTrail } from "@/components/finance/nav/FinanceTrail";
import { useHubTeam } from "@/components/finance/nav/useManagedTeams";
import { FinanceLoading } from "@/components/finance/portfolio/FinancePrimitives";
import { financeBooksService } from "@/services/financeBooks.service";

interface ProjectFinanceSearch {
	tab?: ProjectBookTab;
}

/**
 * One project's finance, nested under the team that owns it — so the
 * breadcrumb, the sidebar, and the URL all say "this team › this project",
 * and "up" is always the team page.
 *
 * What renders is driven by the caller's resolved book permissions; a slice
 * their role may not see is never fetched into the page.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/team/$teamId/project/$bookId",
)({
	validateSearch: (search: Record<string, unknown>): ProjectFinanceSearch => ({
		tab: PROJECT_BOOK_TABS.includes(search.tab as ProjectBookTab)
			? (search.tab as ProjectBookTab)
			: undefined,
	}),
	component: ProjectFinancePage,
});

function ProjectFinancePage() {
	const { teamId, bookId } = Route.useParams();
	const { tab = "overview" } = Route.useSearch();
	const navigate = useNavigate();
	const [shareOpen, setShareOpen] = useState(false);
	const { team } = useHubTeam(teamId);

	const overviewQuery = useQuery({
		queryKey: ["finance-books", bookId, "overview"],
		queryFn: () => financeBooksService.overview(bookId),
	});

	if (overviewQuery.isPending) return <FinanceLoading />;
	const overview = overviewQuery.data;

	// A project book always lives under its own team; a stale or hand-edited
	// URL is corrected rather than rendered under the wrong team.
	if (overview?.book.owner_team_id && overview.book.owner_team_id !== teamId) {
		return (
			<Navigate
				to="/engagements/finance/team/$teamId/project/$bookId"
				params={{ teamId: overview.book.owner_team_id, bookId }}
				search={{ tab }}
				replace
			/>
		);
	}

	// Only project books live here; a team book IS its team page.
	if (overview && overview.book.kind !== "project") {
		return (
			<Navigate
				to="/engagements/finance/team/$teamId"
				params={{ teamId }}
				replace
			/>
		);
	}

	const teamName = team?.team_name ?? overview?.team_name ?? "Team";
	const title = overview?.project_title ?? "Project";

	return (
		<div className="app-shell-bg min-h-full px-5 py-4 md:px-8 md:py-5">
			<div className="mx-auto w-full max-w-7xl pb-10">
				<FinanceTrail
					team={{ id: teamId, name: teamName }}
					project={{ bookId, title }}
					shared={team?.my_team_role === "guest"}
				/>

				{overviewQuery.isError || !overview ? (
					<div className="mt-8">
						<AppEmptyState
							icon={BookOpen}
							title="Project finance not found"
							description={
								overviewQuery.error?.message ??
								"This project's finance could not be loaded."
							}
						/>
					</div>
				) : (
					<>
						<div className="mt-3 flex flex-wrap items-center justify-between gap-4">
							<div className="flex min-w-0 items-center gap-3.5">
								<span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
									<Folder className="h-5 w-5" />
								</span>
								<div className="min-w-0">
									<p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
										Project finance · {teamName}
									</p>
									<div className="flex min-w-0 items-center gap-2.5">
										<h1 className="truncate text-2xl font-bold tracking-tight text-foreground">
											{title}
										</h1>
										<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
											{FINANCE_ROLE_LABELS[overview.role] ?? overview.role}
											{overview.inherited ? " · via team" : ""}
										</span>
									</div>
									<p className="mt-0.5 text-sm text-muted-foreground">
										Display currency {overview.book.currency}
									</p>
								</div>
							</div>
							<button
								type="button"
								onClick={() => setShareOpen(true)}
								className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
							>
								<Share2 className="h-4 w-4" />
								Share
							</button>
						</div>

						{overview.book.status === "archived" ? (
							<div className="mt-4 flex items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-5 py-3.5">
								<Archive className="h-4 w-4 shrink-0 text-warning-foreground" />
								<p className="text-sm text-warning-foreground">
									This project&apos;s finance is archived — its client contract
									ended. History stays readable and exportable, but nothing new
									is recorded.
								</p>
							</div>
						) : null}

						<ProjectBookWorkspace
							bookId={bookId}
							teamId={teamId}
							overview={overview}
							tab={tab}
							onTabChange={(next) =>
								void navigate({
									to: "/engagements/finance/team/$teamId/project/$bookId",
									params: { teamId, bookId },
									search: { tab: next === "overview" ? undefined : next },
									replace: true,
								})
							}
							onOpenImport={(documentId) =>
								void navigate({
									to: "/engagements/finance/imports/$documentId",
									params: { documentId },
								})
							}
						/>

						<FinanceShareDialog
							bookId={bookId}
							bookTitle={`${title} · Project finance`}
							canManage={Boolean(overview.permissions.manage_members)}
							open={shareOpen}
							onClose={() => setShareOpen(false)}
						/>
					</>
				)}
			</div>
		</div>
	);
}
