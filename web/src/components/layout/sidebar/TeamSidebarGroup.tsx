import { useRouterState } from "@tanstack/react-router";
import { Clock, FolderKanban, House, Settings, Users } from "lucide-react";
import { TeamAvatar } from "@/components/team/TeamAvatar";
import { toWorkspacePath } from "@/lib/workspacePaths";
import type { Team } from "@/services/teams.service";
import { CollapsibleNavGroup, SidebarSubLink } from "./SidebarPrimitives";

export function TeamSidebarGroup({
	team,
	isExpanded,
	onToggle,
	currentPath,
	workspaceSlug,
}: {
	team: Team;
	isExpanded: boolean;
	onToggle: () => void;
	/** Already stripped of any /w/<slug> prefix by the caller. */
	currentPath: string;
	/** Null only while the workspace list loads; links then stay bare and ride the redirect stubs. */
	workspaceSlug: string | null;
}) {
	const selectedTab = useRouterState({
		select: (state) => {
			const tab = (state.location.search as Record<string, unknown>).tab;
			return typeof tab === "string" ? tab : undefined;
		},
	});
	const teamActive =
		currentPath.startsWith(`/teams/${team.id}`) ||
		currentPath.startsWith(`/team-onboarding/${team.id}`);

	const subItems = [
		{
			label: "Home",
			icon: House,
			to: toWorkspacePath(`/teams/${team.id}`, workspaceSlug),
			search: undefined,
			active:
				currentPath === `/teams/${team.id}` &&
				(selectedTab === undefined || selectedTab === "overview"),
		},
		{
			label: "Projects",
			icon: FolderKanban,
			to: toWorkspacePath(`/teams/${team.id}`, workspaceSlug),
			search: { tab: "projects" },
			active: currentPath === `/teams/${team.id}` && selectedTab === "projects",
		},
		{
			label: "Members",
			icon: Users,
			to: toWorkspacePath(`/teams/${team.id}`, workspaceSlug),
			search: { tab: "members" },
			active: currentPath === `/teams/${team.id}` && selectedTab === "members",
		},
		// Time + rates only show once an owner or admin has enabled time
		// tracking under settings. Settings stays visible so they can flip
		// the flag in the first place.
		...(team.time_tracking_enabled
			? [
					{
						label: "Time",
						icon: Clock,
						to: toWorkspacePath(`/teams/${team.id}/time`, workspaceSlug),
						search: undefined,
						active: currentPath.startsWith(`/teams/${team.id}/time`),
					},
				]
			: []),
		{
			label: "Settings",
			icon: Settings,
			to: toWorkspacePath(`/teams/${team.id}/settings`, workspaceSlug),
			search: undefined,
			active: currentPath.startsWith(`/teams/${team.id}/settings`),
		},
	];

	return (
		<CollapsibleNavGroup
			isExpanded={isExpanded}
			onToggle={onToggle}
			headerActive={teamActive}
			header={
				<button
					type="button"
					onClick={onToggle}
					className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-2 text-left text-sm font-medium text-sidebar-foreground/85 hover:text-sidebar-foreground"
				>
					<TeamAvatar team={team} size="sm" />
					<span className="truncate">{team.name || "Untitled team"}</span>
				</button>
			}
		>
			{subItems.map((item) => (
				<SidebarSubLink
					key={item.label}
					to={item.to}
					icon={item.icon}
					label={item.label}
					active={item.active}
					search={item.search}
				/>
			))}
		</CollapsibleNavGroup>
	);
}
