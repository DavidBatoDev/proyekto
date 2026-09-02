import { Clock, House, Settings } from "lucide-react";
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
	const teamActive =
		currentPath.startsWith(`/teams/${team.id}`) ||
		currentPath.startsWith(`/team-onboarding/${team.id}`);

	const subItems = [
		{
			label: "Home",
			icon: House,
			to: toWorkspacePath(`/teams/${team.id}`, workspaceSlug),
			active: currentPath === `/teams/${team.id}`,
		},
		// Time + rates only show once the team owner has enabled time
		// tracking under settings (consultant-verified gate). Settings
		// stays visible so the owner can flip the flag in the first place.
		...(team.time_tracking_enabled
			? [
					{
						label: "Time",
						icon: Clock,
						to: toWorkspacePath(`/teams/${team.id}/time`, workspaceSlug),
						active: currentPath.startsWith(`/teams/${team.id}/time`),
					},
				]
			: []),
		{
			label: "Settings",
			icon: Settings,
			to: toWorkspacePath(`/teams/${team.id}/settings`, workspaceSlug),
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
				/>
			))}
		</CollapsibleNavGroup>
	);
}
