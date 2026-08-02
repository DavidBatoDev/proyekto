import { formatDistanceToNow } from "date-fns";
import { Loader2, Mail, UserPlus, X } from "lucide-react";
import { useState } from "react";
import {
	AppEmptyState,
	AppSectionHeader,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { InviteToProjectModal } from "@/components/project/team/InviteToProjectModal";
import { useConfirm } from "@/hooks/useConfirm";
import {
	useProjectCancelInviteMutation,
	useProjectInvitesQuery,
	useProjectMyPermissionsQuery,
} from "@/hooks/useProjectQueries";
import { useToast } from "@/hooks/useToast";
import type { ProjectInvite } from "@/services/project.service";

/**
 * Pending and past direct-share invites for this project. Team invites (sent
 * to bring a whole team on) are managed on the Teams page instead — this is
 * only the per-email invites started from here or the Members page.
 */
export function ProjectInvitesPage({ projectId }: { projectId: string }) {
	const invitesQuery = useProjectInvitesQuery(projectId);
	const permissionsQuery = useProjectMyPermissionsQuery(projectId);
	const [inviteOpen, setInviteOpen] = useState(false);

	const canManageMembers = Boolean(permissionsQuery.data?.members.manage);
	const invites = invitesQuery.data ?? [];
	const pending = invites.filter((i) => i.status === "pending");
	const past = invites.filter((i) => i.status !== "pending");

	return (
		<div className="space-y-5">
			<AppSectionHeader
				kicker="Team"
				title="Invites"
				subtitle="Pending and past direct-share invitations for this project."
				rightSlot={
					canManageMembers && (
						<button
							type="button"
							onClick={() => setInviteOpen(true)}
							className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
						>
							<UserPlus className="h-3.5 w-3.5" />
							Invite
						</button>
					)
				}
			/>

			{invitesQuery.isPending ? (
				<div className="flex justify-center py-16">
					<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
				</div>
			) : invites.length === 0 ? (
				<AppEmptyState
					icon={Mail}
					title="No pending invites"
					description="Invite someone by email to give them direct access to this project."
					action={
						canManageMembers && (
							<button
								type="button"
								onClick={() => setInviteOpen(true)}
								className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
							>
								<UserPlus className="h-3.5 w-3.5" />
								Invite
							</button>
						)
					}
				/>
			) : (
				<div className="space-y-6">
					{pending.length > 0 && (
						<section>
							<h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">
								Pending ({pending.length})
							</h3>
							<div className="space-y-3">
								{pending.map((invite) => (
									<InviteRow
										key={invite.id}
										projectId={projectId}
										invite={invite}
										canManage={canManageMembers}
									/>
								))}
							</div>
						</section>
					)}
					{past.length > 0 && (
						<section>
							<h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">
								Past invites
							</h3>
							<div className="space-y-3">
								{past.map((invite) => (
									<InviteRow
										key={invite.id}
										projectId={projectId}
										invite={invite}
										canManage={false}
									/>
								))}
							</div>
						</section>
					)}
				</div>
			)}

			{inviteOpen && (
				<InviteToProjectModal
					projectId={projectId}
					onClose={() => setInviteOpen(false)}
				/>
			)}
		</div>
	);
}

function InviteRow({
	projectId,
	invite,
	canManage,
}: {
	projectId: string;
	invite: ProjectInvite;
	canManage: boolean;
}) {
	const toast = useToast();
	const confirm = useConfirm();
	const cancelMutation = useProjectCancelInviteMutation(projectId);

	const askCancel = async () => {
		const ok = await confirm({
			title: "Cancel this invite?",
			message: `${invite.invitee_email ?? "This person"} will no longer be able to accept it.`,
			confirmLabel: "Cancel invite",
			tone: "danger",
		});
		if (!ok) return;
		cancelMutation.mutate(invite.id, {
			onSuccess: () => toast.success("Invite cancelled"),
			onError: (err) => toast.error((err as Error).message),
		});
	};

	const sentLabel = formatDistanceToNow(new Date(invite.created_at), {
		addSuffix: true,
	});

	return (
		<AppSurfaceCard className="overflow-hidden p-0">
			<div className="flex items-start justify-between gap-4 px-6 py-4">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<p className="truncate text-sm font-semibold text-foreground">
							{invite.invitee_email ?? "Unknown email"}
						</p>
						<StatusBadge status={invite.status} />
					</div>
					<p className="mt-0.5 text-xs text-muted-foreground">
						{invite.invited_position ? `${invite.invited_position} · ` : ""}
						Sent {sentLabel}
						{invite.inviter?.display_name
							? ` by ${invite.inviter.display_name}`
							: ""}
					</p>
					{invite.message && (
						<p className="mt-2 text-xs italic text-muted-foreground">
							"{invite.message}"
						</p>
					)}
				</div>
				{canManage && invite.status === "pending" && (
					<button
						type="button"
						onClick={() => void askCancel()}
						disabled={cancelMutation.isPending}
						className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
					>
						<X className="h-3.5 w-3.5" />
						Cancel
					</button>
				)}
			</div>
		</AppSurfaceCard>
	);
}

function StatusBadge({ status }: { status: ProjectInvite["status"] }) {
	const styles =
		status === "accepted"
			? "border-emerald-200 bg-emerald-50 text-emerald-700"
			: status === "declined"
				? "border-rose-200 bg-rose-50 text-rose-700"
				: "border-slate-300 bg-slate-100 text-slate-700";
	return (
		<span
			className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles}`}
		>
			{status}
		</span>
	);
}
