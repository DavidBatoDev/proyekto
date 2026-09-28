import { format } from "date-fns";
import {
	AlertTriangle,
	ChevronDown,
	Clock3,
	Loader2,
	Mail,
	UserPlus,
	X,
} from "lucide-react";
import { useState } from "react";
import {
	countLimitInfo,
	PlanLimitNotice,
} from "@/components/billing/PlanLimitNotice";
import { SeatChangeNotice } from "@/components/billing/SeatChangeNotice";
import { AppConfirmDialog } from "@/components/common/AppConfirmDialog";
import { workspaceMemberName } from "@/components/workspace/settings/memberName";
import {
	SettingsAvatar,
	SettingsPageHeader,
	SettingsRow,
	SettingsRows,
	SettingsSection,
	settingsButton,
} from "@/components/workspace/settings/SettingsPrimitives";
import { WorkspaceSettingsGate } from "@/components/workspace/settings/WorkspaceSettingsGate";
import { WorkspaceInviteDialog } from "@/components/workspace/WorkspaceInviteDialog";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useToast } from "@/hooks/useToast";
import {
	useCancelWorkspaceInviteMutation,
	useWorkspaceInvitesQuery,
	useWorkspaceMemberMutations,
	useWorkspaceMembersQuery,
} from "@/hooks/useWorkspaceQueries";
import type {
	Workspace,
	WorkspaceInvite,
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
	// Pending invites hold member spots, so a full workspace can't invite
	// anyone new. Fails open while usage is loading or unavailable.
	const entitlements = useEntitlements(workspace.id);
	const memberCap = canManage ? countLimitInfo(entitlements, "members") : null;

	const [inviteOpen, setInviteOpen] = useState(false);
	const [pendingRemoval, setPendingRemoval] = useState<WorkspaceMember | null>(
		null,
	);

	const members = membersQuery.data ?? [];
	const pendingInvites = (invitesQuery.data ?? []).filter(
		(invite) => invite.status === "pending",
	);
	// Re-sending a pending invite adds nobody, so the server allows it even
	// at the cap and the dialog lets it through. Only a full workspace with
	// no pending invite to re-send has nothing to offer; while the list is
	// loading or unavailable, stay open.
	const inviteBlocked =
		memberCap !== null && invitesQuery.isSuccess && pendingInvites.length === 0;

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

	// Who sent an invite: the member list first (it has the full name
	// fallback chain), then the profile the invite may carry; unknown when
	// neither resolves, so the row just omits it.
	const inviterName = (invite: WorkspaceInvite): string | null => {
		if (!invite.invited_by) return null;
		if (invite.invited_by === user?.id) return "you";
		const inviter = members.find((item) => item.user_id === invite.invited_by);
		if (inviter) return workspaceMemberName(inviter);
		return (
			invite.invited_by_profile?.display_name ||
			invite.invited_by_profile?.email ||
			null
		);
	};

	const memberCountLine = membersQuery.isLoading
		? null
		: members.length > 0
			? `${members.length} ${members.length === 1 ? "member" : "members"}.`
			: null;

	return (
		<div className="app-fade-in">
			<SettingsPageHeader
				title="Members"
				description="Everyone in this workspace."
				actions={
					canManage ? (
						<button
							type="button"
							onClick={() => setInviteOpen(true)}
							disabled={inviteBlocked}
							className={settingsButton.primary}
						>
							<UserPlus className="h-4 w-4" aria-hidden="true" />
							Invite people
						</button>
					) : null
				}
			/>

			{memberCap ? (
				<PlanLimitNotice
					info={memberCap}
					workspace={workspace}
					isComplimentary={entitlements.isComplimentary}
					className="mt-8"
				/>
			) : null}

			<SettingsSection
				id="workspace-members"
				title="Current members"
				description={
					<>
						{memberCountLine ? (
							<span className="font-medium tabular-nums text-foreground">
								{memberCountLine}{" "}
							</span>
						) : null}
						Membership here is the billable seat pool.
					</>
				}
			>
				{membersQuery.isLoading ? (
					<div className="flex items-center gap-2 text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
						<span className="text-sm">Loading members…</span>
					</div>
				) : members.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						The member list could not be loaded right now.
					</p>
				) : (
					<SettingsRows as="ul">
						{members.map((member) => {
							const displayName = workspaceMemberName(member);
							const isSelf = member.user_id === user?.id;
							return (
								// `wrap`: the rail and the section-title column leave
								// this row far less room than the screen width
								// suggests, so the controls drop under the name
								// rather than squeezing it to nothing.
								<SettingsRow
									key={member.id}
									as="li"
									wrap
									leading={
										<SettingsAvatar
											name={displayName}
											src={member.user?.avatar_url ?? null}
										/>
									}
									label={
										<span className="flex min-w-0 items-baseline gap-1.5">
											<span className="truncate">{displayName}</span>
											{isSelf ? (
												<span className="shrink-0 text-xs font-normal text-muted-foreground">
													(you)
												</span>
											) : null}
										</span>
									}
									description={
										<span className="block truncate">
											{member.user?.email ?? "—"}
										</span>
									}
								>
									<>
										{/* Shown only where there is room to spare for it;
										    narrower, it stays for screen readers alone. */}
										<span className="sr-only text-xs tabular-nums text-muted-foreground xl:not-sr-only">
											<span className="sr-only">Joined </span>
											{format(new Date(member.joined_at), "MMM d, yyyy")}
										</span>
										{canManage ? (
											<>
												<span className="relative inline-flex">
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
														className="h-8 w-[6.75rem] cursor-pointer appearance-none rounded-md border border-input bg-background pl-2.5 pr-8 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
													>
														<option value="member">Member</option>
														<option value="admin">Admin</option>
														<option value="owner">Owner</option>
													</select>
													<ChevronDown
														aria-hidden="true"
														className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
													/>
												</span>
												{/* The negative margin sets the word, not its hover
												    pad, on the content edge the other rows end on. */}
												<button
													type="button"
													onClick={() => setPendingRemoval(member)}
													disabled={removeMember.isPending}
													className="-mr-2 h-8 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30 disabled:cursor-not-allowed disabled:opacity-50"
												>
													Remove
												</button>
											</>
										) : (
											<span className="text-sm font-medium text-foreground">
												{ROLE_LABEL[member.role]}
											</span>
										)}
									</>
								</SettingsRow>
							);
						})}
					</SettingsRows>
				)}
			</SettingsSection>

			{canManage ? (
				<SettingsSection
					id="workspace-invites"
					title="Pending invitations"
					description="Not billed until accepted."
				>
					{invitesQuery.isLoading ? (
						<div className="flex items-center gap-2 text-muted-foreground">
							<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
							<span className="text-sm">Loading invitations…</span>
						</div>
					) : pendingInvites.length === 0 ? (
						<p className="flex items-center gap-2 text-sm text-muted-foreground">
							<Mail className="h-4 w-4" aria-hidden="true" />
							No pending invitations.
						</p>
					) : (
						<SettingsRows as="ul">
							{pendingInvites.map((invite) => {
								const invitedBy = inviterName(invite);
								return (
									<SettingsRow
										key={invite.id}
										as="li"
										wrap
										leading={
											<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
												<Mail className="h-4 w-4" aria-hidden="true" />
											</span>
										}
										label={
											<span className="block truncate">
												{invite.invitee_email ?? "Unknown email"}
											</span>
										}
										description={
											<>
												<span>
													{ROLE_LABEL[invite.role]} · invited{" "}
													{format(new Date(invite.created_at), "MMM d, yyyy")}
													{invitedBy ? ` by ${invitedBy}` : null}
												</span>
												{invite.email_delivery?.sent === false ? (
													<span className="mt-0.5 flex items-start gap-1.5 text-warning-foreground">
														<AlertTriangle
															className="mt-0.5 h-3 w-3 shrink-0"
															aria-hidden="true"
														/>
														Invite email could not be sent — they can still
														accept it in the app.
													</span>
												) : null}
											</>
										}
									>
										<div className="flex items-center gap-3">
											<span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
												<Clock3 className="h-3 w-3" aria-hidden="true" />
												Pending
											</span>
											<button
												type="button"
												onClick={() => handleCancelInvite(invite.id)}
												disabled={cancelInvite.isPending}
												aria-label={`Cancel invitation for ${invite.invitee_email ?? "this person"}`}
												className="-mr-1.5 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30 disabled:cursor-not-allowed disabled:opacity-50"
											>
												<X className="h-4 w-4" aria-hidden="true" />
											</button>
										</div>
									</SettingsRow>
								);
							})}
						</SettingsRows>
					)}
				</SettingsSection>
			) : null}

			<AppConfirmDialog
				open={pendingRemoval !== null}
				title="Remove member"
				message={
					pendingRemoval ? (
						<>
							<span>
								{workspaceMemberName(pendingRemoval)} will lose access to this
								workspace. Their project access is granted per project and is
								not touched by this. You can invite them again at any time.
							</span>
							<SeatChangeNotice workspace={workspace} reason="remove" />
						</>
					) : undefined
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
