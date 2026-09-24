import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, Folder } from "lucide-react";
import { useManagedTeams } from "@/components/finance/nav/useManagedTeams";
import { financeBooksService } from "@/services/financeBooks.service";
import {
	ENGAGEMENTS_NAV_ITEMS,
	FINANCE_NAV_ITEMS,
	resolveEngagementsLocation,
	SHARED_NAV_ITEM,
} from "./engagementsNavigation";
import {
	SidebarNavLink,
	SidebarSectionHeader,
	SidebarSubLink,
} from "./SidebarPrimitives";

/**
 * The engagements shell's navigation — one tree, drawn from the same
 * `resolveEngagementsLocation` the breadcrumbs use, so the highlighted node is
 * always the page's parent chain:
 *
 *   ENGAGEMENTS  Overview · Contracts
 *   FINANCE      My finance · My teams (› team › project) · Shared with me
 *
 * "My teams" lists the teams the caller runs money for (owner, admin, or a
 * finance role on the team book). Teams where the caller is only a member
 * are not places here — their share rolls into My finance.
 */
export function EngagementsSidebarContent() {
	const currentPath = useRouterState({
		select: (state) => state.location.pathname,
	});
	const location = resolveEngagementsLocation(currentPath);

	const hubQuery = useQuery({
		queryKey: ["finance-books", "hub"],
		queryFn: financeBooksService.hub,
		staleTime: 60_000,
	});
	const teams = useManagedTeams(hubQuery.data);
	const sharedCount = hubQuery.data?.shared.length ?? 0;
	// A team page reached through a grant (not a team you run) belongs under
	// "Shared with me", not "My teams".
	const inSharedTeam = Boolean(
		location.teamId &&
			hubQuery.data &&
			!teams.some((team) => team.team_id === location.teamId),
	);

	return (
		<div className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-4">
			<nav className="space-y-1">
				<SidebarSectionHeader>Engagements</SidebarSectionHeader>
				{ENGAGEMENTS_NAV_ITEMS.map((item) => (
					<SidebarNavLink
						key={item.key}
						to={item.to}
						icon={item.icon}
						label={item.label}
						active={location.nav === item.key}
						tone="tint"
					/>
				))}
			</nav>

			<nav className="space-y-1">
				<SidebarSectionHeader>Finance</SidebarSectionHeader>
				{FINANCE_NAV_ITEMS.map((item) => (
					<div key={item.key} className="space-y-0.5">
						<SidebarNavLink
							to={item.to}
							icon={item.icon}
							label={item.label}
							// "My teams" lights only on its own list; inside a team the
							// team row carries the highlight instead, one node at a time.
							active={
								location.nav === item.key &&
								!(item.key === "my-teams" && location.teamId)
							}
							tone="tint"
						/>
						{item.key === "my-teams" && teams.length > 0 ? (
							<div className="ml-5 space-y-0.5 border-l border-sidebar-border pl-2">
								{teams.map((team) => {
									const inTeam = location.teamId === team.team_id;
									return (
										<div key={team.team_id} className="space-y-0.5">
											<SidebarSubLink
												to="/engagements/finance/team/$teamId"
												params={{ teamId: team.team_id }}
												icon={TeamGlyph}
												label={team.team_name}
												active={inTeam && !location.bookId}
												tone="tint"
											/>
											{/* A team's projects unfold while you are inside it. */}
											{inTeam && team.project_books.length > 0 ? (
												<div className="ml-4 space-y-0.5">
													{team.project_books.map((entry) => (
														<SidebarSubLink
															key={entry.book.id}
															to="/engagements/finance/team/$teamId/project/$bookId"
															params={{
																teamId: team.team_id,
																bookId: entry.book.id,
															}}
															icon={Folder}
															label={entry.project_title ?? "Project"}
															active={location.bookId === entry.book.id}
															tone="tint"
														/>
													))}
												</div>
											) : null}
										</div>
									);
								})}
							</div>
						) : null}
					</div>
				))}

				{sharedCount > 0 && (
					<SidebarNavLink
						to={SHARED_NAV_ITEM.to}
						icon={SHARED_NAV_ITEM.icon}
						label={SHARED_NAV_ITEM.label}
						active={location.nav === "shared" || inSharedTeam}
						tone="tint"
					/>
				)}
			</nav>

			<div className="mt-auto border-t border-sidebar-border pt-3">
				<Link
					to="/dashboard"
					className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/85 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
				>
					<ArrowLeft className="h-5 w-5 shrink-0" />
					<span className="truncate">Back to workspace</span>
				</Link>
			</div>
		</div>
	);
}

/** A small dot glyph so team rows read as children of "My teams". */
function TeamGlyph({ className }: { className?: string }) {
	return (
		<span className={`flex items-center justify-center ${className ?? ""}`}>
			<span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
		</span>
	);
}
