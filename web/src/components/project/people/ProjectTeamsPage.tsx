import { Loader2, Users } from "lucide-react";
import { useState } from "react";
import {
	AppEmptyState,
	AppSectionHeader,
} from "@/components/common/AppPrimitives";
import { useUser } from "@/stores/authStore";
import { AddTeamMemberDialog } from "./AddTeamMemberDialog";
import { AttachTeamDialog } from "./AttachTeamDialog";
import { TeamGroupCard } from "./TeamGroupCard";
import { type PersonAccess, useProjectPeople } from "./useProjectPeople";

/**
 * Manage which teams are attached to this project — attach, detach, make
 * primary, and see/curate each team's members here. The Members page shows
 * everyone flat; this is where team-level relationships are actually edited.
 */
export function ProjectTeamsPage({
	projectId,
	onOpenPerson,
}: {
	projectId: string;
	onOpenPerson: (person: PersonAccess) => void;
}) {
	const user = useUser();
	const people = useProjectPeople(projectId, user?.id ?? null);
	const [attachOpen, setAttachOpen] = useState(false);
	const [teamForNewMember, setTeamForNewMember] = useState<{
		id: string;
		name: string;
	} | null>(null);
	const directInvitedUserIds = new Set(
		people.people
			.filter((person) =>
				person.rows.some(
					(row) => row.origin === "invited" && row.has_direct_grant === true,
				),
			)
			.map((person) => person.userId)
			.filter((userId): userId is string => Boolean(userId)),
	);

	if (people.isPending) {
		return (
			<div className="flex justify-center py-16">
				<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="space-y-5">
			<AppSectionHeader
				kicker="Team"
				title="Attached teams"
				subtitle="Teams bring their members onto this project as a group."
				rightSlot={
					people.canManageTeams && (
						<button
							type="button"
							onClick={() => setAttachOpen(true)}
							className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
						>
							<Users className="h-3.5 w-3.5" />
							Attach team
						</button>
					)
				}
			/>

			{people.groups.length === 0 ? (
				<AppEmptyState
					icon={Users}
					title="No teams attached"
					description="Attach a team to bring its members onto this project."
					action={
						people.canManageTeams && (
							<button
								type="button"
								onClick={() => setAttachOpen(true)}
								className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
							>
								<Users className="h-3.5 w-3.5" />
								Attach team
							</button>
						)
					}
				/>
			) : (
				<div className="space-y-4">
					{people.groups.map((group) => (
						<TeamGroupCard
							key={group.attachment.team_id}
							projectId={projectId}
							group={group}
							canManageTeams={people.canManageTeams}
							canManageMembers={people.canManageMembers}
							defaultOpen={
								group.attachment.is_primary || group.people.length <= 5
							}
							onOpenPerson={onOpenPerson}
							onAddMember={(teamId) =>
								setTeamForNewMember({
									id: teamId,
									name: group.team?.name ?? "this team",
								})
							}
						/>
					))}
				</div>
			)}

			{attachOpen && (
				<AttachTeamDialog
					projectId={projectId}
					currentUserId={user?.id ?? null}
					onClose={() => setAttachOpen(false)}
				/>
			)}

			{teamForNewMember && (
				<AddTeamMemberDialog
					projectId={projectId}
					teamId={teamForNewMember.id}
					teamName={teamForNewMember.name}
					directInvitedUserIds={directInvitedUserIds}
					onClose={() => setTeamForNewMember(null)}
				/>
			)}
		</div>
	);
}
