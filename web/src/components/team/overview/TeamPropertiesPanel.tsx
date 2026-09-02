import { Link } from "@tanstack/react-router";
import {
	CalendarDays,
	Clock,
	FolderKanban,
	type LucideIcon,
	Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import { Avatar, displayNameOf } from "@/components/common/Avatar";
import { normalizeTeamStatus } from "@/components/team/teamStatus";
import type { Team, TeamMember } from "@/services/teams.service";
import { TeamStatusSelector } from "./TeamStatusSelector";

/**
 * One row of the properties list. Local rather than `AppStatCard`, which is a
 * big-number card and hardcodes light-mode slate.
 */
function PropertyRow({
	icon: Icon,
	label,
	children,
}: {
	icon: LucideIcon;
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-3 py-1.5">
			<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
				<Icon className="h-3.5 w-3.5 shrink-0" />
				{label}
			</span>
			<div className="min-w-0 text-sm text-foreground">{children}</div>
		</div>
	);
}

/**
 * The Overview's right rail: what this team is, at a glance.
 *
 * Everything here comes from data the page already loads, so the panel adds no
 * requests of its own.
 */
export function TeamPropertiesPanel({
	team,
	members,
	projectCount,
	canEdit,
}: {
	team: Team;
	members: TeamMember[];
	projectCount: number;
	canEdit: boolean;
}) {
	const owner = members.find((member) => member.user_id === team.owner_id);
	const visibleMembers = members.slice(0, 5);
	const overflow = Math.max(0, members.length - visibleMembers.length);

	return (
		<aside className="sticky top-6 self-start">
			<AppSurfaceCard className="p-4">
				<p className="app-section-kicker mb-2">Properties</p>

				<PropertyRow icon={CalendarDays} label="Status">
					<TeamStatusSelector
						teamId={team.id}
						status={normalizeTeamStatus(team.status)}
						canEdit={canEdit}
					/>
				</PropertyRow>

				<PropertyRow icon={Users} label="Lead">
					{owner?.user ? (
						<span className="flex min-w-0 items-center gap-2">
							<Avatar user={owner.user} size="xs" />
							<span className="truncate">{displayNameOf(owner.user)}</span>
						</span>
					) : (
						<span className="text-muted-foreground">—</span>
					)}
				</PropertyRow>

				<PropertyRow icon={Users} label="Members">
					<Link
						to="/teams/$teamId"
						params={{ teamId: team.id }}
						search={{ tab: "members" }}
						className="flex min-w-0 items-center gap-2 hover:underline"
					>
						<span className="flex items-center">
							{visibleMembers.map((member, index) => (
								<span
									key={member.user_id}
									className="rounded-full border-2 border-card"
									style={{ marginLeft: index === 0 ? 0 : -8 }}
								>
									<Avatar user={member.user} size="xs" />
								</span>
							))}
						</span>
						<span className="text-muted-foreground">
							{members.length}
							{overflow > 0 ? ` (+${overflow})` : ""}
						</span>
					</Link>
				</PropertyRow>

				<PropertyRow icon={FolderKanban} label="Projects">
					<Link
						to="/teams/$teamId"
						params={{ teamId: team.id }}
						search={{ tab: "projects" }}
						className="hover:underline"
					>
						{projectCount}
					</Link>
				</PropertyRow>

				<PropertyRow icon={Clock} label="Time">
					{team.time_tracking_enabled ? (
						<Link
							to="/teams/$teamId/time"
							params={{ teamId: team.id }}
							className="hover:underline"
						>
							Tracking on
						</Link>
					) : (
						<span className="text-muted-foreground">Off</span>
					)}
				</PropertyRow>

				<PropertyRow icon={CalendarDays} label="Created">
					<span className="text-muted-foreground">
						{new Date(team.created_at).toLocaleDateString(undefined, {
							month: "short",
							day: "numeric",
							year: "numeric",
						})}
					</span>
				</PropertyRow>
			</AppSurfaceCard>
		</aside>
	);
}
