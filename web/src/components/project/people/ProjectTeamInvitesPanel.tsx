import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Loader2, MailCheck, X } from "lucide-react";
import { MemberDisplay } from "@/components/common/MemberDisplay";
import { useToast } from "@/hooks/useToast";
import { projectKeys } from "@/queries/project";
import {
	cancelProjectTeamInvite,
	listProjectTeamInvites,
	type ProjectTeamInvite,
} from "@/services/teams.service";

/**
 * Outstanding "invite a team" invitations on this project.
 *
 * Shown between the attached teams and nothing else because a sent invitation
 * is the only visible trace the feature leaves on the project side — without
 * it, an admin who invited someone last week has no way to tell whether they
 * are waiting on a reply or forgot to send it at all.
 *
 * Settled invitations are listed too, but quietly: a declined invitation is
 * information (do not keep waiting), while an accepted one has already turned
 * into an attached team above and needs no second telling.
 */
export function ProjectTeamInvitesPanel({
	projectId,
	canManageTeams,
}: {
	projectId: string;
	canManageTeams: boolean;
}) {
	const invitesQuery = useQuery({
		queryKey: ["project", projectId, "team-invites"],
		queryFn: () => listProjectTeamInvites(projectId),
	});

	const invites = invitesQuery.data ?? [];
	const pending = invites.filter((i) => i.status === "pending");
	const declined = invites.filter((i) => i.status === "declined");

	if (invitesQuery.isPending || (pending.length === 0 && declined.length === 0))
		return null;

	return (
		<section className="space-y-2">
			<h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				Invited teams
			</h3>
			<div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
				{pending.map((invite) => (
					<InviteRow
						key={invite.id}
						projectId={projectId}
						invite={invite}
						canManageTeams={canManageTeams}
					/>
				))}
				{declined.map((invite) => (
					<InviteRow
						key={invite.id}
						projectId={projectId}
						invite={invite}
						canManageTeams={false}
					/>
				))}
			</div>
		</section>
	);
}

function InviteRow({
	projectId,
	invite,
	canManageTeams,
}: {
	projectId: string;
	invite: ProjectTeamInvite;
	canManageTeams: boolean;
}) {
	const qc = useQueryClient();
	const toast = useToast();

	const cancelMutation = useMutation({
		mutationFn: () => cancelProjectTeamInvite(projectId, invite.id),
		onSuccess: () => {
			void qc.invalidateQueries({
				queryKey: ["project", projectId, "team-invites"],
			});
			void qc.invalidateQueries({ queryKey: projectKeys.members(projectId) });
			toast.success("Invitation cancelled");
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const sentLabel = formatDistanceToNow(new Date(invite.created_at), {
		addSuffix: true,
	});
	const isPending = invite.status === "pending";

	return (
		<div
			className={`flex items-center gap-3 px-3 py-2.5 ${
				isPending ? "" : "opacity-60"
			}`}
		>
			<MailCheck
				className="h-4 w-4 shrink-0 text-muted-foreground"
				aria-hidden="true"
			/>
			<div className="min-w-0 flex-1">
				{invite.invitee ? (
					<MemberDisplay
						user={invite.invitee}
						fallbackId={invite.invitee_id ?? undefined}
						size="sm"
					/>
				) : (
					// No profile yet — the address is all we have, and showing it is
					// what tells the admin the invite went somewhere real.
					<p className="truncate text-sm text-foreground">
						{invite.invitee_email}
					</p>
				)}
				<p className="mt-0.5 truncate text-[11px] text-muted-foreground">
					{invite.team_name_hint ? `${invite.team_name_hint} · ` : ""}
					joins as {invite.member_role}
					{invite.make_primary ? " · asked to be primary" : ""} · invited{" "}
					{sentLabel}
				</p>
			</div>
			{isPending ? (
				<span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
					Awaiting reply
				</span>
			) : (
				<span className="shrink-0 text-[11px] text-muted-foreground">
					Declined
				</span>
			)}
			{isPending && canManageTeams && (
				<button
					type="button"
					onClick={() => cancelMutation.mutate()}
					disabled={cancelMutation.isPending}
					aria-label="Cancel invitation"
					className="shrink-0 rounded-lg border border-input p-1.5 text-muted-foreground transition hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
				>
					{cancelMutation.isPending ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" />
					) : (
						<X className="h-3.5 w-3.5" />
					)}
				</button>
			)}
		</div>
	);
}
