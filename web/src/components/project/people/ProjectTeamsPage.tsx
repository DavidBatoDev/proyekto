import { HelpCircle, Loader2, Mail, Users } from "lucide-react";
import { useState } from "react";
import {
	AppEmptyState,
	AppSectionHeader,
} from "@/components/common/AppPrimitives";
import { featureFlags } from "@/config/featureFlags";
import { useUser } from "@/stores/authStore";
import { AddTeamMemberDialog } from "./AddTeamMemberDialog";
import { AttachTeamDialog } from "./AttachTeamDialog";
import { InviteTeamDialog } from "./InviteTeamDialog";
import { PersonRow } from "./PersonRow";
import { ProjectTeamInvitesPanel } from "./ProjectTeamInvitesPanel";
import { TeamGroupCard } from "./TeamGroupCard";
import { type PersonAccess, useProjectPeople } from "./useProjectPeople";

/**
 * A ghost of the real TeamGroupCard: the tinted header strip carrying a team
 * logo and name, with a couple of member rows beneath it. Three are fanned
 * behind the empty-state copy so the blank page shows the shape of what
 * attaching a team produces.
 */
function GhostTeamCard({ className }: { className?: string }) {
	return (
		<div
			aria-hidden
			className={`w-44 overflow-hidden rounded-xl border border-border bg-card shadow-sm ${className ?? ""}`}
		>
			<div className="flex items-center gap-2 border-b border-border bg-muted/40 px-2.5 py-2">
				<span className="h-5 w-5 shrink-0 rounded-md bg-muted-foreground/25" />
				<span className="h-2 w-1/2 rounded-full bg-muted-foreground/25" />
			</div>
			<div className="space-y-2 p-2.5">
				{[0, 1].map((row) => (
					<div key={row} className="flex items-center gap-2">
						<span className="h-4 w-4 shrink-0 rounded-full bg-muted-foreground/20" />
						<span
							className={`h-1.5 rounded-full bg-muted-foreground/15 ${
								row === 0 ? "w-2/3" : "w-1/2"
							}`}
						/>
						<span className="ml-auto h-3 w-6 shrink-0 rounded-full bg-primary/20" />
					</div>
				))}
			</div>
		</div>
	);
}

/** The fanned trio, sized to sit above the empty-state copy. */
function AttachedTeamsIllustration() {
	return (
		<div className="relative flex h-28 w-64 items-end justify-center">
			<GhostTeamCard className="absolute bottom-2 left-0 -rotate-6 opacity-45" />
			<GhostTeamCard className="absolute bottom-2 right-0 rotate-6 opacity-45" />
			<GhostTeamCard className="relative z-10 shadow-md" />
		</div>
	);
}

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
	const [inviteOpen, setInviteOpen] = useState(false);
	const [helpOpen, setHelpOpen] = useState(false);
	const canInviteTeams =
		featureFlags.teamProjectInvites && people.canManageTeams;
	const hasTeams = people.groups.length > 0;
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
						<div className="flex items-center gap-2">
							{/* Actions live in EITHER the header or the empty state, never
							    both — the empty state is the natural call to action when
							    there is nothing to act on, and the header takes over once
							    there is. The help toggle shows in both, because the two
							    actions are easiest to confuse before you've used either. */}
							{hasTeams && (
								<>
									{canInviteTeams && (
										<button
											type="button"
											onClick={() => setInviteOpen(true)}
											className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted"
										>
											<Mail className="h-3.5 w-3.5" />
											Invite a team
										</button>
									)}
									<button
										type="button"
										onClick={() => setAttachOpen(true)}
										className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
									>
										<Users className="h-3.5 w-3.5" />
										Attach team
									</button>
								</>
							)}
							{canInviteTeams && (
								<button
									type="button"
									onClick={() => setHelpOpen((v) => !v)}
									aria-expanded={helpOpen}
									aria-label="What's the difference between attaching and inviting a team?"
									className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition ${
										helpOpen
											? "border-primary bg-primary/5 text-primary"
											: "border-input text-muted-foreground hover:bg-muted"
									}`}
								>
									<HelpCircle className="h-4 w-4" />
								</button>
							)}
						</div>
					)
				}
			/>

			{helpOpen && canInviteTeams && <AttachVsInviteHelp />}

			{featureFlags.teamProjectInvites && (
				<ProjectTeamInvitesPanel
					projectId={projectId}
					canManageTeams={people.canManageTeams}
				/>
			)}

			{people.groups.length === 0 ? (
				<AppEmptyState
					illustration={<AttachedTeamsIllustration />}
					title="No teams attached"
					description="Attach a team to bring its members onto this project."
					action={
						people.canManageTeams && (
							<>
								<button
									type="button"
									onClick={() => setAttachOpen(true)}
									className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
								>
									<Users className="h-3.5 w-3.5" />
									Attach team
								</button>
								{canInviteTeams && (
									<button
										type="button"
										onClick={() => setInviteOpen(true)}
										className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted"
									>
										<Mail className="h-3.5 w-3.5" />
										Invite a team
									</button>
								)}
							</>
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
							allPeople={people.people}
							curatedTeamIdsByUserId={people.curatedTeamIdsByUserId}
							teamNameById={people.teamNameById}
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

			{/* Everyone who reaches this project without a team — the owner, direct
			    invites, and (since "Invite a team") the admin who invited a team they
			    are not themselves on. `useProjectPeople` has always computed this list
			    for exactly this purpose, and nothing rendered it: a team-grouped page
			    silently dropped them, so a project owner who had brought in someone
			    else's team could not find themselves anywhere on the page they were
			    standing on. */}
			{people.direct.length > 0 && (
				<section className="space-y-2">
					<div>
						<h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Not on a team
						</h3>
						<p className="mt-0.5 text-[11px] text-muted-foreground">
							They reach this project directly, not through any team attached
							here.
						</p>
					</div>
					<div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
						{people.direct.map((person) => (
							<PersonRow
								key={person.key}
								person={person}
								onOpen={onOpenPerson}
							/>
						))}
					</div>
				</section>
			)}

			{attachOpen && (
				<AttachTeamDialog
					projectId={projectId}
					currentUserId={user?.id ?? null}
					onClose={() => setAttachOpen(false)}
				/>
			)}

			{inviteOpen && (
				<InviteTeamDialog
					projectId={projectId}
					onClose={() => setInviteOpen(false)}
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

/**
 * What the two actions actually differ on.
 *
 * They sit side by side and both end with a team on the project, so the useful
 * distinction is not what they do but *whose decision it is* — and whether
 * anything happens right now or only once someone else agrees. Written as that
 * contrast rather than as two feature descriptions.
 */
function AttachVsInviteHelp() {
	return (
		<div className="rounded-xl border border-border bg-muted/30 p-4">
			<dl className="grid gap-4 sm:grid-cols-2">
				<div>
					<dt className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
						<Users className="h-3.5 w-3.5 text-muted-foreground" />
						Attach team
					</dt>
					<dd className="mt-1 text-xs leading-relaxed text-muted-foreground">
						For a team <span className="font-medium">you're already on</span>.
						You pick who joins and their access, and it takes effect immediately
						— nobody has to approve it.
					</dd>
				</div>
				<div>
					<dt className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
						<Mail className="h-3.5 w-3.5 text-muted-foreground" />
						Invite a team
					</dt>
					<dd className="mt-1 text-xs leading-relaxed text-muted-foreground">
						For a team <span className="font-medium">you're not on</span> — you
						can't see it, so you invite the person who runs it. They choose
						which team and who comes along; you still set the access those
						people get. Nothing changes until they accept.
					</dd>
				</div>
			</dl>
		</div>
	);
}
