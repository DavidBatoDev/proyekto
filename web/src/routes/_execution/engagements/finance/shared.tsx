import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, ChevronRight, Share2 } from "lucide-react";
import {
	AppEmptyState,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { FINANCE_ROLE_LABELS } from "@/components/finance/FinanceShareDialog";
import { FinanceTrail } from "@/components/finance/nav/FinanceTrail";
import { useFinanceHub } from "@/components/finance/nav/useManagedTeams";
import { FinanceLoading } from "@/components/finance/portfolio/FinancePrimitives";

/**
 * Shared with me — finance other teams granted the caller (an outside
 * accountant, a client viewer). Each row opens the team or project page the
 * grant covers; the caller's role decides what those pages show.
 */
export const Route = createFileRoute("/_execution/engagements/finance/shared")({
	component: SharedWithMePage,
});

function SharedWithMePage() {
	const hubQuery = useFinanceHub();
	const shared = (hubQuery.data?.shared ?? []).filter(
		(entry) => entry.book.owner_team_id,
	);

	return (
		<div className="app-shell-bg min-h-full px-5 py-4 md:px-8 md:py-5">
			<div className="mx-auto w-full max-w-5xl pb-10">
				<FinanceTrail shared />
				<div className="mt-2">
					<h1 className="text-2xl font-bold tracking-tight text-foreground">
						Shared with me
					</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						Finance other teams gave you access to. Your role decides what you
						see.
					</p>
				</div>

				{hubQuery.isPending ? (
					<FinanceLoading />
				) : shared.length === 0 ? (
					<AppEmptyState
						icon={Share2}
						title="Nothing shared with you"
						description="When a team invites you as an accountant, manager, or client viewer, it appears here."
						className="mt-8"
					/>
				) : (
					<AppSurfaceCard className="mt-6 divide-y divide-border overflow-hidden">
						{shared.map((entry) => {
							const teamId = entry.book.owner_team_id as string;
							const row = (
								<>
									<span className="flex min-w-0 items-center gap-3">
										<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success/10 text-success-foreground">
											<BookOpen className="h-5 w-5" />
										</span>
										<span className="min-w-0">
											<span className="block truncate text-sm font-semibold text-foreground">
												{entry.project_title ?? entry.team_name ?? "Finance"}
											</span>
											<span className="block truncate text-xs text-muted-foreground">
												{entry.team_name && entry.project_title
													? `${entry.team_name} · `
													: ""}
												{entry.book.kind === "project"
													? "Project finance"
													: "Team finance"}{" "}
												· {entry.book.currency}
											</span>
										</span>
									</span>
									<span className="flex shrink-0 items-center gap-3">
										<span className="rounded-lg bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">
											{FINANCE_ROLE_LABELS[entry.role] ?? entry.role}
										</span>
										<ChevronRight className="h-4 w-4 text-muted-foreground" />
									</span>
								</>
							);
							const className =
								"flex items-center justify-between gap-4 p-4 transition-colors hover:bg-muted/40 md:px-5";
							return entry.book.kind === "project" ? (
								<Link
									key={entry.book.id}
									to="/engagements/finance/team/$teamId/project/$bookId"
									params={{ teamId, bookId: entry.book.id }}
									className={className}
								>
									{row}
								</Link>
							) : (
								<Link
									key={entry.book.id}
									to="/engagements/finance/team/$teamId"
									params={{ teamId }}
									className={className}
								>
									{row}
								</Link>
							);
						})}
					</AppSurfaceCard>
				)}
			</div>
		</div>
	);
}
