import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, Folder, Share2, Users } from "lucide-react";
import { financeBooksService } from "@/services/financeBooks.service";
import {
	ENGAGEMENTS_NAV_ITEMS,
	FINANCE_NAV_ITEMS,
	isEngagementsNavItemActive,
} from "./engagementsNavigation";
import {
	SidebarNavLink,
	SidebarSectionHeader,
	SidebarSubLink,
} from "./SidebarPrimitives";

/**
 * The engagements shell's navigation — places, Google-Drive style.
 *
 * All engagements, then FINANCE: Home (the launcher), Personal (your own
 * book), one entry per team with its project books nested under it, and a
 * Shared-with-me entry when anyone has granted the caller a book.
 *
 * The tree comes from the finance hub payload, which exists for every
 * authenticated user — there is deliberately no consultant gate here. What a
 * caller cannot reach simply is not in their hub.
 */
export function EngagementsSidebarContent() {
	const currentPath = useRouterState({
		select: (state) => state.location.pathname,
	});

	const hubQuery = useQuery({
		queryKey: ["finance-books", "hub"],
		queryFn: financeBooksService.hub,
		staleTime: 60_000,
	});
	const teams = hubQuery.data?.teams ?? [];
	const sharedCount = hubQuery.data?.shared.length ?? 0;

	return (
		<div className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-4">
			<nav className="space-y-1">
				{ENGAGEMENTS_NAV_ITEMS.map((item) => (
					<SidebarNavLink
						key={item.key}
						to={item.to}
						icon={item.icon}
						label={item.label}
						active={isEngagementsNavItemActive(item, currentPath)}
						tone="tint"
					/>
				))}
			</nav>

			<nav className="space-y-1">
				<SidebarSectionHeader>Finance</SidebarSectionHeader>
				{FINANCE_NAV_ITEMS.map((item) => (
					<SidebarNavLink
						key={item.key}
						to={item.to}
						icon={item.icon}
						label={item.label}
						active={isEngagementsNavItemActive(item, currentPath)}
						tone="tint"
					/>
				))}

				{/*
				 * A team is a place of the same rank as Home and Personal, so it is
				 * drawn at the same size; only its project books step down a level.
				 */}
				{teams.map((team) => (
					<div key={team.team_id} className="space-y-0.5">
						<SidebarNavLink
							to="/engagements/finance/team/$teamId"
							params={{ teamId: team.team_id }}
							icon={Users}
							label={team.team_name}
							active={currentPath.startsWith(
								`/engagements/finance/team/${team.team_id}`,
							)}
							tone="tint"
						/>
						{team.project_books.length > 0 && (
							<div className="ml-7 space-y-0.5">
								{team.project_books.map((entry) => (
									<SidebarSubLink
										key={entry.book.id}
										to="/engagements/finance/book/$bookId"
										params={{ bookId: entry.book.id }}
										icon={Folder}
										label={entry.project_title}
										active={currentPath.startsWith(
											`/engagements/finance/book/${entry.book.id}`,
										)}
										tone="tint"
									/>
								))}
							</div>
						)}
					</div>
				))}

				{sharedCount > 0 && (
					<SidebarNavLink
						to="/engagements/finance"
						icon={Share2}
						label="Shared with me"
						active={false}
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
