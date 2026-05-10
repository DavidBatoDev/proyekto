import { Clock, Settings, Users } from "lucide-react";
import type { Team } from "@/services/teams.service";
import {
	CollapsibleNavGroup,
	SidebarSubLink,
} from "./SidebarPrimitives";

export function TeamSidebarGroup({
	team,
	isExpanded,
	onToggle,
	currentPath,
}: {
	team: Team;
	isExpanded: boolean;
	onToggle: () => void;
	currentPath: string;
}) {
	const teamActive =
		currentPath.startsWith(`/teams/${team.id}`) ||
		currentPath.startsWith(`/team-onboarding/${team.id}`);

	const subItems = [
		{
			label: "Members",
			icon: Users,
			to: `/teams/${team.id}`,
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
						to: `/teams/${team.id}/time`,
						active: currentPath.startsWith(`/teams/${team.id}/time`),
					},
				]
			: []),
		{
			label: "Settings",
			icon: Settings,
			to: `/teams/${team.id}/settings`,
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
					className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-2 text-left text-sm font-medium text-slate-700 hover:text-slate-900"
				>
					<TeamAvatar team={team} />
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

function TeamAvatar({ team }: { team: Team }) {
	if (team.avatar_url) {
		return (
			<img
				src={team.avatar_url}
				alt={team.name}
				className="h-5 w-5 shrink-0 rounded-md object-cover"
			/>
		);
	}
	const initial = (team.name?.trim()[0] || "T").toUpperCase();
	return (
		<div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-slate-200 text-[10px] font-semibold text-slate-700">
			{initial}
		</div>
	);
}
