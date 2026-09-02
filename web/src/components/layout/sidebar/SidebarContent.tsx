import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { Plus, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceInviteDialog } from "@/components/workspace/WorkspaceInviteDialog";
import { WorkspaceSwitcher } from "@/components/workspace/WorkspaceSwitcher";
import { useDashboardProjectsQuery } from "@/hooks/useDashboardProjectsQuery";
import { useCurrentWorkspace } from "@/hooks/useWorkspaceQueries";
import { stripWorkspacePrefix, toWorkspacePath } from "@/lib/workspacePaths";
import { groupByWorkspace } from "@/lib/workspaceScope";
import type { Project } from "@/services/project.service";
import {
	listMyTeams,
	type Team,
	updateWorkspaceDefaults,
} from "@/services/teams.service";
import { useProfile, useUser } from "@/stores/authStore";
import {
	EXECUTION_PRIMARY_NAV_ITEMS,
	isExecutionNavItemActive,
} from "./executionNavigation";
import { ProjectSidebarLink } from "./ProjectSidebarLink";
import { SidebarEmptyState, StackedPapersIcon } from "./SidebarEmptyState";
import { SidebarNavLink, SidebarSectionHeader } from "./SidebarPrimitives";
import { TeamSidebarGroup } from "./TeamSidebarGroup";

const TEAMS_OPEN_KEY = "dashboard_sidebar_open_team";
/** Sentinel for "the user deliberately collapsed every team this session". */
const TEAMS_OPEN_NONE = "__none__";

/**
 * Returns `null` when the session has no recorded choice yet (so the caller
 * may fall back to a default team), or `{ teamId }` for an explicit one -
 * where `teamId: null` means "collapsed on purpose".
 */
function loadOpenTeam(): { teamId: string | null } | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = sessionStorage.getItem(TEAMS_OPEN_KEY);
		if (raw === null) return null;
		return { teamId: raw === TEAMS_OPEN_NONE ? null : raw };
	} catch {
		return null;
	}
}

function saveOpenTeam(id: string | null) {
	if (typeof window === "undefined") return;
	try {
		sessionStorage.setItem(TEAMS_OPEN_KEY, id ?? TEAMS_OPEN_NONE);
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
	const currentPath = stripWorkspacePrefix(routerState.location.pathname);

	const projectsQuery = useDashboardProjectsQuery();
	const projects = (projectsQuery.data as Project[] | undefined) ?? [];

	const teamsQuery = useQuery({
		queryKey: ["teams", "mine", user?.id ?? "anonymous"] as const,
		queryFn: listMyTeams,
		enabled: Boolean(user?.id),
		staleTime: 30 * 1000,
	});
	const allTeams = (teamsQuery.data as Team[] | undefined) ?? [];

	// Scope both lists to the workspace that is open. Work reached through
	// project access rather than membership — a consultant inside a client's
	// project — lands in "Shared with you" instead of disappearing.
	const { workspace: currentWorkspace, workspaces } = useCurrentWorkspace();
	const workspaceSlug = currentWorkspace?.slug ?? null;
	const myWorkspaceIds = useMemo(
		() => workspaces.map((item) => item.id),
		[workspaces],
	);
	const teamGroups = useMemo(
		() =>
			groupByWorkspace(allTeams, currentWorkspace?.id ?? null, myWorkspaceIds),
		[allTeams, currentWorkspace?.id, myWorkspaceIds],
	);
	const teams = teamGroups.current;

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

	const projectGroups = useMemo(
		() =>
			groupByWorkspace(projects, currentWorkspace?.id ?? null, myWorkspaceIds),
		[projects, currentWorkspace?.id, myWorkspaceIds],
	);

	const orderedProjects = useMemo(() => {
		const scoped = projectGroups.current;
		if (!preferredProjectId) return scoped;
		const preferred = scoped.find(
			(project) => project.id === preferredProjectId,
		);
		if (!preferred) return scoped;
		return [
			preferred,
			...scoped.filter((project) => project.id !== preferred.id),
		];
	}, [projectGroups, preferredProjectId]);

	const activeTeamId = (() => {
		const match =
			currentPath.match(/^\/teams\/([^/]+)/) ||
			currentPath.match(/^\/team-onboarding\/([^/]+)/);
		return match?.[1] ?? null;
	})();

	// Read once on mount: `null` here means "no choice recorded this session".
	const [storedOpenTeam] = useState(loadOpenTeam);
	const [openTeamId, setOpenTeamId] = useState<string | null>(() =>
		storedOpenTeam ? storedOpenTeam.teamId : activeTeamId,
	);
	const persistDefaultsMutation = useMutation({
		mutationFn: (lastTeamId: string | null) =>
			updateWorkspaceDefaults({ last_team_id: lastTeamId }),
	});
	const lastPersistedTeamIdRef = useRef<string | null>(null);

	// Seeded with the current route's team when the session already holds a
	// choice, so remounting on the same page never undoes a collapse; an
	// actual navigation to a team still opens that team's group.
	const lastSyncedActiveTeamId = useRef<string | null>(
		storedOpenTeam ? activeTeamId : null,
	);
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

	// Auto-open the preferred team once per mount, and only while the user has
	// made no choice of their own. Re-running it after a collapse (which sets
	// `openTeamId` to null) would instantly re-open the group, making it
	// impossible to close.
	const hasAppliedDefaultOpenRef = useRef(storedOpenTeam !== null);
	useEffect(() => {
		if (hasAppliedDefaultOpenRef.current || teams.length === 0) return;
		hasAppliedDefaultOpenRef.current = true;
		if (activeTeamId || openTeamId) return;
		const preferred =
			(preferredTeamId &&
				teams.find((team) => team.id === preferredTeamId)?.id) ??
			teams[0]?.id ??
			null;
		if (!preferred) return;
		setOpenTeamId(preferred);
		saveOpenTeam(preferred);
	}, [activeTeamId, openTeamId, preferredTeamId, teams]);

	const [inviteOpen, setInviteOpen] = useState(false);
	const canInviteToWorkspace =
		currentWorkspace?.my_role === "owner" ||
		currentWorkspace?.my_role === "admin";

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
			<WorkspaceSwitcher />

			<nav
				data-tour="sidebar-nav"
				className="hide-scrollbar flex-1 overflow-y-auto px-3 py-4"
			>
				<div className="space-y-0.5">
					{EXECUTION_PRIMARY_NAV_ITEMS.map((item) => (
						<SidebarNavLink
							key={item.key}
							to={toWorkspacePath(item.to, workspaceSlug)}
							icon={item.icon}
							label={item.label}
							active={isExecutionNavItemActive(item, currentPath)}
						/>
					))}
				</div>

				<div className="mt-6">
					<div className="mb-1 flex items-center justify-between pr-1">
						<SidebarSectionHeader>Teams</SidebarSectionHeader>
						<Link
							to={toWorkspacePath("/teams", workspaceSlug)}
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
							ctaTo={toWorkspacePath("/teams", workspaceSlug)}
						/>
					) : (
						<div className="space-y-0.5">
							{teams.map((t) => {
								const expanded = t.id === openTeamId;
								return (
									<TeamSidebarGroup
										workspaceSlug={workspaceSlug}
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

					{teamGroups.shared.length > 0 && (
						<div className="mt-4">
							<SidebarSectionHeader>Shared with you</SidebarSectionHeader>
							<div className="mt-1 space-y-0.5">
								{teamGroups.shared.map((t) => {
									const expanded = t.id === openTeamId;
									return (
										<TeamSidebarGroup
											workspaceSlug={workspaceSlug}
											key={t.id}
											team={t}
											isExpanded={expanded}
											onToggle={() => toggleTeamExpanded(t.id, expanded)}
											currentPath={currentPath}
										/>
									);
								})}
							</div>
						</div>
					)}
				</div>

				<div className="mt-6">
					<div className="mb-1 flex items-center justify-between pr-1">
						<SidebarSectionHeader>Projects</SidebarSectionHeader>
						<Link
							to="/project/new"
							search={{ roadmapId: undefined }}
							className={
								currentPath === "/project/new"
									? "rounded bg-sidebar-primary p-1 text-sidebar-primary-foreground"
									: "rounded p-1 text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
							}
							title="New project"
							aria-label="New project"
							aria-current={currentPath === "/project/new" ? "page" : undefined}
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
							ctaTo="/project/new"
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

					{projectGroups.shared.length > 0 && (
						<div className="mt-4">
							<SidebarSectionHeader>Shared with you</SidebarSectionHeader>
							<div className="mt-1 space-y-0.5">
								{projectGroups.shared.map((p) => (
									<ProjectSidebarLink
										key={p.id}
										project={p}
										currentPath={currentPath}
									/>
								))}
							</div>
						</div>
					)}
				</div>
			</nav>

			<div className="border-t border-sidebar-border p-3">
				<button
					type="button"
					disabled={!canInviteToWorkspace}
					title={
						canInviteToWorkspace
							? undefined
							: currentWorkspace
								? "Ask a workspace admin to invite people"
								: "Create a workspace first"
					}
					onClick={() => setInviteOpen(true)}
					className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:cursor-not-allowed disabled:opacity-60"
				>
					<UserPlus className="h-5 w-5" />
					Invite people
				</button>
			</div>

			{currentWorkspace && (
				<WorkspaceInviteDialog
					workspaceId={currentWorkspace.id}
					open={inviteOpen}
					onClose={() => setInviteOpen(false)}
				/>
			)}
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
