import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { MemberDisplay } from "@/components/common/MemberDisplay";
import { TeamAvatar } from "@/components/team/TeamAvatar";
import { useToast } from "@/hooks/useToast";
import {
	listMyTeams,
	listTeamMembers,
	type ProjectTeamInvite,
	respondProjectTeamInvite,
} from "@/services/teams.service";

/**
 * Accepting an "invite a team" invitation: choose which of your teams you are
 * bringing, and who from it joins.
 *
 * This is the half of the handshake the inviter cannot do. They addressed a
 * person, not a team, because nothing exposes your teams to someone outside
 * them — so the team identity is decided here, by you, at accept time.
 *
 * What is deliberately NOT here: the project role. That was fixed by the
 * invitation and is shown read-only, because roles on someone else's project
 * are theirs to set, not yours to negotiate on the way in.
 */
export function AcceptProjectTeamInviteDialog({
	invite,
	currentUserId,
	onClose,
}: {
	invite: ProjectTeamInvite;
	currentUserId: string | null;
	onClose: () => void;
}) {
	const qc = useQueryClient();
	const toast = useToast();

	const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
	const [picked, setPicked] = useState<Set<string>>(new Set());

	const myTeamsQuery = useQuery({
		queryKey: ["teams", "mine", currentUserId],
		queryFn: listMyTeams,
	});

	// You can only commit a team you actually run. A plain member volunteering
	// their org's roster onto an outside project is exactly what the backend
	// rejects, so do not offer it here either.
	const eligibleTeams = useMemo(
		() =>
			(myTeamsQuery.data ?? []).filter(
				(t) =>
					t.owner_id === currentUserId ||
					t.viewer_role === "owner" ||
					t.viewer_role === "admin",
			),
		[myTeamsQuery.data, currentUserId],
	);

	const membersQuery = useQuery({
		queryKey: ["teams", "members", selectedTeamId],
		queryFn: () =>
			selectedTeamId ? listTeamMembers(selectedTeamId) : Promise.resolve([]),
		enabled: Boolean(selectedTeamId),
	});

	const teamMembers = useMemo(
		() =>
			(membersQuery.data ?? []).filter(
				(m): m is typeof m & { user: NonNullable<typeof m.user> } =>
					Boolean(m.user?.id),
			),
		[membersQuery.data],
	);

	const acceptMutation = useMutation({
		mutationFn: () => {
			if (!selectedTeamId) throw new Error("Pick a team first");
			return respondProjectTeamInvite(invite.id, {
				status: "accepted",
				team_id: selectedTeamId,
				member_user_ids: [...picked],
			});
		},
		onSuccess: () => {
			void qc.invalidateQueries({
				queryKey: ["teams", "my-project-invites"],
			});
			void qc.invalidateQueries({ queryKey: ["teams", "mine"] });
			toast.success("Invitation accepted");
			onClose();
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const projectName = invite.project?.title ?? "the project";

	return (
		<AppDialog
			open
			onClose={onClose}
			size="lg"
			busy={acceptMutation.isPending}
			title={`Bring a team to ${projectName}`}
			description="Choose which of your teams joins this project, and who from it comes along."
			footer={
				<>
					<button
						type="button"
						onClick={onClose}
						disabled={acceptMutation.isPending}
						className="rounded-lg border border-input px-4 py-2 text-sm text-foreground transition hover:bg-muted disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={() => acceptMutation.mutate()}
						disabled={!selectedTeamId || acceptMutation.isPending}
						className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
					>
						{acceptMutation.isPending && (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						)}
						Accept and join
					</button>
				</>
			}
		>
			<div className="space-y-5">
				{invite.team_name_hint && (
					<p className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
						They asked for{" "}
						<span className="font-semibold text-foreground">
							{invite.team_name_hint}
						</span>
						. Pick the matching team below.
					</p>
				)}

				<div>
					<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Team you're bringing
					</p>
					{myTeamsQuery.isPending ? (
						<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
					) : eligibleTeams.length === 0 ? (
						<p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
							You don't own or administer any team yet. Create one first, then
							come back to this invitation.
						</p>
					) : (
						<div className="space-y-1.5">
							{eligibleTeams.map((team) => (
								<button
									key={team.id}
									type="button"
									onClick={() => {
										setSelectedTeamId(team.id);
										setPicked(new Set());
									}}
									className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
										selectedTeamId === team.id
											? "border-primary bg-primary/5"
											: "border-border hover:bg-muted"
									}`}
								>
									<TeamAvatar team={team} size="sm" />
									<span className="truncate text-sm font-medium text-foreground">
										{team.name}
									</span>
								</button>
							))}
						</div>
					)}
				</div>

				{selectedTeamId && (
					<div>
						<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Who joins the project
						</p>
						{membersQuery.isPending ? (
							<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
						) : teamMembers.length === 0 ? (
							<p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
								This team has no members yet — you'll join on your own.
							</p>
						) : (
							<div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
								{teamMembers.map((m) => {
									const userId = m.user.id;
									// You always come along: you are the one person we know
									// consented, and a team on a project with nobody on it is
									// not a state worth creating. Shown locked rather than
									// hidden, so the roster still reads as complete.
									const isSelf = userId === currentUserId;
									return (
										<div
											key={userId}
											className={`flex items-center gap-3 px-3 py-2.5 ${
												isSelf ? "opacity-60" : ""
											}`}
										>
											<input
												type="checkbox"
												checked={isSelf ? true : picked.has(userId)}
												disabled={isSelf || acceptMutation.isPending}
												onChange={() => {
													const next = new Set(picked);
													if (next.has(userId)) next.delete(userId);
													else next.add(userId);
													setPicked(next);
												}}
												className="h-3.5 w-3.5 shrink-0 accent-primary"
											/>
											<div className="min-w-0 flex-1">
												<MemberDisplay
													user={m.user}
													fallbackId={userId}
													size="sm"
												/>
											</div>
											{isSelf && (
												<span className="shrink-0 text-[11px] text-muted-foreground">
													That's you
												</span>
											)}
										</div>
									);
								})}
							</div>
						)}
						<p className="mt-1.5 text-[11px] text-muted-foreground">
							Everyone you pick joins {projectName} as{" "}
							<span className="font-semibold text-foreground">
								{invite.member_role}
							</span>
							, set by whoever invited you. Anyone already on the project keeps
							the access they have.
						</p>
					</div>
				)}

				{invite.make_primary && (
					<p className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground">
						This team is being asked to become the project's primary team, which
						means its billing identity fills in contracts and its pay periods
						drive invoicing.
					</p>
				)}
			</div>
		</AppDialog>
	);
}
