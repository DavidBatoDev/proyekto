import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import {
	CalendarDays,
	Inbox,
	LayoutDashboard,
	ListChecks,
	Plus,
	UserPlus,
	Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Project, projectService } from "@/services/project.service";
import {
	listMyTeams,
	type Team,
	updateWorkspaceDefaults,
} from "@/services/teams.service";
import { useProfile, useUser } from "@/stores/authStore";
import { ProjectSidebarLink } from "./ProjectSidebarLink";
import { SidebarEmptyState, StackedPapersIcon } from "./SidebarEmptyState";
import { SidebarNavLink, SidebarSectionHeader } from "./SidebarPrimitives";
import { TeamSidebarGroup } from "./TeamSidebarGroup";

const TEAMS_OPEN_KEY = "dashboard_sidebar_open_team";

function loadOpenTeam(): string | null {
	if (typeof window === "undefined") return null;
	try {
		return sessionStorage.getItem(TEAMS_OPEN_KEY);
	} catch {
		return null;
	}
}

function saveOpenTeam(id: string | null) {
	if (typeof window === "undefined") return;
	try {
		if (id) sessionStorage.setItem(TEAMS_OPEN_KEY, id);
		else sessionStorage.removeItem(TEAMS_OPEN_KEY);
	} catch {
		/* non-fatal */
	}
}

/**
 * The scrollable nav body shared by the desktop sidebar (`DashboardSidebar`)
 * and the mobile slide-in drawer (`MobileNavDrawer`). Owns all the data
 * fetching and the team expand/collapse state so both surfaces stay in sync
 * with one source of truth. Expects a flex-column parent (so `flex-1` on the
 * nav fills available height).
 */
export function SidebarContent() {
	const user = useUser();
	const profile = useProfile();
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
	const workspaceDefaults = (() => {
		const settings = profile?.settings;
		if (!settings || typeof settings !== "object") return null;
		const raw = (settings as Record<string, unknown>).workspace_defaults;
		if (!raw || typeof raw !== "object") return null;
		return raw as {
			default_team_id?: string | null;
			default_project_id?: string | null;
			last_team_id?: string | null;
		};
	})();
	const preferredTeamId =
		workspaceDefaults?.default_team_id ??
		workspaceDefaults?.last_team_id ??
		null;
	const preferredProjectId = workspaceDefaults?.default_project_id ?? null;

	const orderedProjects = useMemo(() => {
		if (!preferredProjectId) return projects;
		const preferred = projects.find(
			(project) => project.id === preferredProjectId,
		);
		if (!preferred) return projects;
		return [
			preferred,
			...projects.filter((project) => project.id !== preferred.id),
		];
	}, [projects, preferredProjectId]);

	const activeTeamId = (() => {
		const match =
			currentPath.match(/^\/teams\/([^/]+)/) ||
			currentPath.match(/^\/team-onboarding\/([^/]+)/);
		return match?.[1] ?? null;
	})();

	const [openTeamId, setOpenTeamId] = useState<string | null>(
		() => loadOpenTeam() ?? activeTeamId,
	);
	const persistDefaultsMutation = useMutation({
		mutationFn: (lastTeamId: string | null) =>
			updateWorkspaceDefaults({ last_team_id: lastTeamId }),
	});
	const lastPersistedTeamIdRef = useRef<string | null>(null);

	const lastSyncedActiveTeamId = useRef<string | null>(null);
	useEffect(() => {
		if (activeTeamId && activeTeamId !== lastSyncedActiveTeamId.current) {
			lastSyncedActiveTeamId.current = activeTeamId;
			setOpenTeamId(activeTeamId);
			saveOpenTeam(activeTeamId);
			if (lastPersistedTeamIdRef.current !== activeTeamId) {
				lastPersistedTeamIdRef.current = activeTeamId;
				persistDefaultsMutation.mutate(activeTeamId);
			}
		}
	}, [activeTeamId, persistDefaultsMutation]);

	useEffect(() => {
		if (activeTeamId || openTeamId || teams.length === 0) return;
		const preferred =
			(preferredTeamId &&
				teams.find((team) => team.id === preferredTeamId)?.id) ??
			teams[0]?.id ??
			null;
		if (!preferred) return;
		setOpenTeamId(preferred);
		saveOpenTeam(preferred);
	}, [activeTeamId, openTeamId, preferredTeamId, teams]);

	const toggleTeamExpanded = useCallback(
		(teamId: string, currentlyExpanded: boolean) => {
			const next = currentlyExpanded ? null : teamId;
			setOpenTeamId(next);
			saveOpenTeam(next);
			if (next && lastPersistedTeamIdRef.current !== next) {
				lastPersistedTeamIdRef.current = next;
				persistDefaultsMutation.mutate(next);
			}
		},
		[persistDefaultsMutation],
	);

	return (
		<>
			<nav className="hide-scrollbar flex-1 overflow-y-auto px-3 py-4">
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
					<SidebarNavLink
						to="/meetings"
						icon={CalendarDays}
						label="Meetings"
						active={currentPath.startsWith("/meetings")}
					/>
				</div>

				<div className="mt-6">
					<div className="mb-1 flex items-center justify-between pr-1">
						<SidebarSectionHeader>Teams</SidebarSectionHeader>
						<Link
							to="/teams"
							className={
								currentPath === "/teams"
									? "rounded bg-sidebar-primary p-1 text-sidebar-primary-foreground"
									: "rounded p-1 text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
							}
							title="All teams"
							aria-current={currentPath === "/teams" ? "page" : undefined}
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
							{teams.map((t) => {
								const expanded = t.id === openTeamId;
								return (
									<TeamSidebarGroup
										key={t.id}
										team={t}
										isExpanded={expanded}
										onToggle={() => toggleTeamExpanded(t.id, expanded)}
										currentPath={currentPath}
									/>
								);
							})}
						</div>
					)}
				</div>

				<div className="mt-6">
					<div className="mb-1 flex items-center justify-between pr-1">
						<SidebarSectionHeader>Projects</SidebarSectionHeader>
						<Link
							to="/project-posting"
							search={{ roadmapId: undefined }}
							className={
								currentPath === "/project-posting"
									? "rounded bg-sidebar-primary p-1 text-sidebar-primary-foreground"
									: "rounded p-1 text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
							}
							title="New project"
							aria-label="New project"
							aria-current={
								currentPath === "/project-posting" ? "page" : undefined
							}
						>
							<Plus className="h-3.5 w-3.5" />
						</Link>
					</div>

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
							{orderedProjects.map((p) => (
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

			<div className="border-t border-sidebar-border p-3">
				<button
					type="button"
					disabled
					title="Invite flow coming soon"
					className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:cursor-not-allowed disabled:opacity-60"
				>
					<UserPlus className="h-5 w-5" />
					Invite people
				</button>
			</div>
		</>
	);
}

function NavSkeleton() {
	return (
		<div className="space-y-1 px-3 py-1">
			{[0, 1, 2].map((i) => (
				<div
					key={i}
					className="h-6 w-full animate-pulse rounded bg-sidebar-accent"
				/>
			))}
		</div>
	);
}
