import { format } from "date-fns";
import { Loader2, Mail, UserPlus, Users, X } from "lucide-react";
import { useState } from "react";
import { AppConfirmDialog } from "@/components/common/AppConfirmDialog";
import { workspaceMemberName } from "@/components/workspace/settings/memberName";
import { WorkspaceSettingsGate } from "@/components/workspace/settings/WorkspaceSettingsGate";
import { WorkspaceInviteDialog } from "@/components/workspace/WorkspaceInviteDialog";
import { useToast } from "@/hooks/useToast";
import {
	useCancelWorkspaceInviteMutation,
	useWorkspaceInvitesQuery,
	useWorkspaceMemberMutations,
	useWorkspaceMembersQuery,
} from "@/hooks/useWorkspaceQueries";
import type {
	Workspace,
	WorkspaceMember,
	WorkspaceRole,
} from "@/services/workspaces.service";
import { useUser } from "@/stores/authStore";

const ROLE_LABEL: Record<WorkspaceRole, string> = {
	owner: "Owner",
	admin: "Admin",
	member: "Member",
};

export function WorkspaceMembersPanel() {
	return (
		<WorkspaceSettingsGate>
			{(workspace) => <MembersContent workspace={workspace} />}
		</WorkspaceSettingsGate>
	);
}

function MembersContent({ workspace }: { workspace: Workspace }) {
	const user = useUser();
	const canManage =
		workspace.my_role === "owner" || workspace.my_role === "admin";

	const membersQuery = useWorkspaceMembersQuery(workspace.id);
	// Plain members cannot list invites, so don't fire a doomed request.
	const invitesQuery = useWorkspaceInvitesQuery(
		canManage ? workspace.id : null,
	);
	const { updateRole, removeMember } = useWorkspaceMemberMutations(
		workspace.id,
	);
	const cancelInvite = useCancelWorkspaceInviteMutation(workspace.id);
	const { success, error: toastError } = useToast();

	const [inviteOpen, setInviteOpen] = useState(false);
	const [pendingRemoval, setPendingRemoval] = useState<WorkspaceMember | null>(
		null,
	);

	const members = membersQuery.data ?? [];
	const pendingInvites = (invitesQuery.data ?? []).filter(
		(invite) => invite.status === "pending",
	);

	const handleRoleChange = (member: WorkspaceMember, role: WorkspaceRole) => {
		if (role === member.role) return;
		updateRole.mutate(
			{ userId: member.user_id, role },
			{
				onSuccess: () => success("Role updated."),
				// Who may grant or revoke ownership is the backend's rule — surface
				// its message rather than re-implementing it here.
				onError: (err) =>
					toastError(
						err instanceof Error ? err.message : "Failed to update member",
					),
			},
		);
	};

	const confirmRemoval = () => {
		if (!pendingRemoval || removeMember.isPending) return;
		removeMember.mutate(pendingRemoval.user_id, {
			onSuccess: () => {
				success("Member removed.");
				setPendingRemoval(null);
			},
			onError: (err) => {
				toastError(
					err instanceof Error ? err.message : "Failed to remove member",
				);
				setPendingRemoval(null);
			},
		});
	};

	const handleCancelInvite = (inviteId: string) => {
		cancelInvite.mutate(inviteId, {
			onSuccess: () => success("Invitation cancelled."),
			onError: (err) =>
				toastError(
					err instanceof Error ? err.message : "Failed to cancel invitation",
				),
		});
	};

	return (
		<div className="app-fade-in">
			<header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex items-start gap-4">
					<div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary sm:flex">
						<Users className="h-6 w-6" />
					</div>
					<div>
						<h1 className="text-3xl font-semibold tracking-tight text-foreground">
							Members
						</h1>
						<p className="mt-2 max-w-2xl text-sm text-muted-foreground">
							Everyone in this workspace. Membership here is the billable seat
							pool.
						</p>
					</div>
				</div>
				{canManage ? (
					<button
						type="button"
						onClick={() => setInviteOpen(true)}
						className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
					>
						<UserPlus className="h-4 w-4" />
						Invite people
					</button>
				) : null}
			</header>

			<section className="rounded-2xl border border-border bg-card text-card-foreground shadow-(--app-shadow-sm)">
				{membersQuery.isLoading ? (
					<div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						<span className="text-sm">Loading members…</span>
					</div>
				) : members.length === 0 ? (
					<p className="px-5 py-12 text-center text-sm text-muted-foreground">
						The member list could not be loaded right now.
					</p>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-left text-sm">
							<thead>
								<tr className="border-b border-border text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
									<th className="px-5 py-3 font-semibold">Member</th>
									<th className="px-5 py-3 font-semibold">Email</th>
									<th className="px-5 py-3 font-semibold">Role</th>
									<th className="px-5 py-3 font-semibold">Joined</th>
									{canManage ? (
										<th className="px-5 py-3">
											<span className="sr-only">Actions</span>
										</th>
									) : null}
								</tr>
							</thead>
							<tbody className="divide-y divide-border">
								{members.map((member) => {
									const displayName = workspaceMemberName(member);
									const isSelf = member.user_id === user?.id;
									return (
										<tr key={member.id}>
											<td className="px-5 py-3">
												<span className="flex items-center gap-3">
													{member.user?.avatar_url ? (
														<img
															src={member.user.avatar_url}
															alt={displayName}
															className="h-8 w-8 rounded-full border border-border object-cover"
														/>
													) : (
														<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-xs font-semibold text-foreground">
															{displayName.charAt(0).toUpperCase()}
														</span>
													)}
													<span className="font-medium text-foreground">
														{displayName}
														{isSelf ? (
															<span className="ml-1.5 text-xs font-normal text-muted-foreground">
																(you)
															</span>
														) : null}
													</span>
												</span>
											</td>
											<td className="px-5 py-3 text-muted-foreground">
												{member.user?.email ?? "—"}
											</td>
											<td className="px-5 py-3">
												{canManage ? (
													<select
														value={member.role}
														aria-label={`Change role for ${displayName}`}
														onChange={(event) =>
															handleRoleChange(
																member,
																event.target.value as WorkspaceRole,
															)
														}
														disabled={updateRole.isPending}
														className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
													>
														<option value="member">Member</option>
														<option value="admin">Admin</option>
														<option value="owner">Owner</option>
													</select>
												) : (
													<span className="text-foreground">
														{ROLE_LABEL[member.role]}
													</span>
												)}
											</td>
											<td className="px-5 py-3 text-muted-foreground">
												{format(new Date(member.joined_at), "MMM d, yyyy")}
											</td>
											{canManage ? (
												<td className="px-5 py-3 text-right">
													<button
														type="button"
														onClick={() => setPendingRemoval(member)}
														disabled={removeMember.isPending}
														className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
													>
														Remove
													</button>
												</td>
											) : null}
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</section>

			{canManage ? (
				<section className="mt-6 rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-(--app-shadow-sm) sm:p-6">
					<div className="flex items-center gap-2">
						<Mail className="h-4 w-4 text-muted-foreground" />
						<h2 className="text-sm font-semibold text-foreground">
							Pending invitations
						</h2>
					</div>
					{invitesQuery.isLoading ? (
						<div className="flex items-center gap-2 py-6 text-muted-foreground">
							<Loader2 className="h-4 w-4 animate-spin" />
							<span className="text-sm">Loading invitations…</span>
						</div>
					) : pendingInvites.length === 0 ? (
						<p className="mt-3 text-sm text-muted-foreground">
							No pending invitations.
						</p>
					) : (
						<ul className="mt-4 divide-y divide-border">
							{pendingInvites.map((invite) => (
								<li
									key={invite.id}
									className="flex items-center justify-between gap-4 py-3"
								>
									<div className="min-w-0">
										<p className="truncate text-sm font-medium text-foreground">
											{invite.invitee_email ?? "Unknown email"}
										</p>
										<p className="mt-0.5 text-xs text-muted-foreground">
											{ROLE_LABEL[invite.role]} · invited{" "}
											{format(new Date(invite.created_at), "MMM d, yyyy")}
										</p>
										{invite.email_delivery?.sent === false ? (
											<p className="mt-0.5 text-xs text-warning">
												Invite email could not be sent — they can still accept
												it in the app.
											</p>
										) : null}
									</div>
									<button
										type="button"
										onClick={() => handleCancelInvite(invite.id)}
										disabled={cancelInvite.isPending}
										aria-label={`Cancel invitation for ${invite.invitee_email ?? "this person"}`}
										className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
									>
										<X className="h-4 w-4" />
									</button>
								</li>
							))}
						</ul>
					)}
				</section>
			) : null}

			<AppConfirmDialog
				open={pendingRemoval !== null}
				title="Remove member"
				message={
					pendingRemoval
						? `${workspaceMemberName(pendingRemoval)} will lose access to this workspace. Their project access is granted per project and is not touched by this. You can invite them again at any time.`
						: undefined
				}
				confirmLabel="Remove member"
				tone="danger"
				busy={removeMember.isPending}
				onConfirm={confirmRemoval}
				onClose={() => setPendingRemoval(null)}
			/>

			<WorkspaceInviteDialog
				workspaceId={workspace.id}
				open={inviteOpen}
				onClose={() => setInviteOpen(false)}
			/>
		</div>
	);
}
