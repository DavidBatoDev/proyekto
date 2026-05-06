import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
	Inbox,
	LayoutDashboard,
	ListChecks,
	Users,
	UserPlus,
} from "lucide-react";
import { useCallback, useState } from "react";
import { type Project, projectService } from "@/services/project.service";
import { listMyTeams, type Team } from "@/services/teams.service";
import { useUser } from "@/stores/authStore";
import {
	SidebarNavLink,
	SidebarSectionHeader,
	useSidebarExpansion,
} from "./sidebar/SidebarPrimitives";
import { ProjectSidebarLink } from "./sidebar/ProjectSidebarLink";
import {
	SidebarEmptyState,
	StackedPapersIcon,
} from "./sidebar/SidebarEmptyState";
import { TeamSidebarGroup } from "./sidebar/TeamSidebarGroup";

const TEAMS_EXPANDED_KEY = "dashboard_sidebar_teams_expanded";

export function DashboardSidebar() {
	const user = useUser();
	const routerState = useRouterState();
	const currentPath = routerState.location.pathname;

	const projectsQuery = useQuery({
		queryKey: ["dashboard", "projects", user?.id ?? "anonymous"] as const,
		queryFn: () => projectService.listDashboardProjects(),
		enabled: Boolean(user?.id),
		staleTime: 30 * 1000,
	});
	const projects = (projectsQuery.data as Project[] | undefined) ?? [];

	const teamsQuery = useQuery({
		queryKey: ["teams", "mine", user?.id ?? "anonymous"] as const,
		queryFn: listMyTeams,
		enabled: Boolean(user?.id),
		staleTime: 30 * 1000,
	});
	const teams = (teamsQuery.data as Team[] | undefined) ?? [];

	const teamsExpansion = useSidebarExpansion(TEAMS_EXPANDED_KEY);
	const [teamsExpanded, setTeamsExpanded] = useState<Record<string, boolean>>(
		() => teamsExpansion.load(),
	);

	const toggleTeamExpanded = useCallback(
		(teamId: string) => {
			setTeamsExpanded((prev) => {
				const next = { ...prev, [teamId]: !prev[teamId] };
				teamsExpansion.save(next);
				return next;
			});
		},
		[teamsExpansion],
	);

	return (
		<aside className="hidden lg:flex sticky top-14 h-[calc(100vh-3.5rem)] w-[260px] shrink-0 flex-col border-r border-slate-200 bg-white/90 backdrop-blur">
			<nav className="flex-1 overflow-y-auto px-3 py-4">
				<div className="space-y-0.5">
					<SidebarNavLink
						to="/dashboard"
						icon={LayoutDashboard}
						label="Dashboard"
						active={currentPath === "/dashboard"}
					/>
					<SidebarNavLink
						to="/inbox"
						icon={Inbox}
						label="Inbox"
						active={currentPath.startsWith("/inbox")}
					/>
					<SidebarNavLink
						to="/work-items"
						icon={ListChecks}
						label="Work Items"
						active={currentPath === "/work-items"}
					/>
				</div>

				<div className="mt-6">
					<div className="mb-1 flex items-center justify-between pr-1">
						<SidebarSectionHeader>Teams</SidebarSectionHeader>
						<Link
							to="/teams"
							className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
							title="All teams"
						>
							<Users className="h-3.5 w-3.5" />
						</Link>
					</div>

					{teamsQuery.isPending ? (
						<NavSkeleton />
					) : teams.length === 0 ? (
						<SidebarEmptyState
							icon={<StackedPapersIcon />}
							label="No teams yet"
							ctaLabel="Add your first team"
							ctaTo="/teams"
						/>
					) : (
						<div className="space-y-0.5">
							{teams.map((t, i) => (
								<TeamSidebarGroup
									key={t.id}
									team={t}
									isExpanded={teamsExpanded[t.id] ?? i < 2}
									onToggle={() => toggleTeamExpanded(t.id)}
									currentPath={currentPath}
								/>
							))}
						</div>
					)}
				</div>

				<div className="mt-6">
					<SidebarSectionHeader>Projects</SidebarSectionHeader>

					{projectsQuery.isPending ? (
						<NavSkeleton />
					) : projects.length === 0 ? (
						<SidebarEmptyState
							icon={<StackedPapersIcon />}
							label="No projects yet"
							ctaLabel="Add your first project"
							ctaTo="/project-posting"
						/>
					) : (
						<div className="space-y-0.5">
							{projects.map((p) => (
								<ProjectSidebarLink
									key={p.id}
									project={p}
									currentPath={currentPath}
								/>
							))}
						</div>
					)}
				</div>
			</nav>

			<div className="border-t border-slate-200 p-3">
				<button
					type="button"
					disabled
					title="Invite flow coming soon"
					className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
				>
					<UserPlus className="h-5 w-5" />
					Invite people
				</button>
			</div>
		</aside>
	);
}

function NavSkeleton() {
	return (
		<div className="space-y-1 px-3 py-1">
			{[0, 1, 2].map((i) => (
				<div
					key={i}
					className="h-6 w-full animate-pulse rounded bg-slate-100"
				/>
			))}
		</div>
	);
}
