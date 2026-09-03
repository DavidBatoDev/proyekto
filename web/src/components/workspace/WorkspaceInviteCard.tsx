import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Building2, Check, Loader2, Quote, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import { MemberDisplay } from "@/components/common/MemberDisplay";
import { useEnterWorkspace } from "@/hooks/useEnterWorkspace";
import { useToast } from "@/hooks/useToast";
import { useRespondWorkspaceInviteMutation } from "@/hooks/useWorkspaceQueries";
import { workspaceKeys } from "@/queries/workspaces";
import {
	listMyWorkspaces,
	type WorkspaceInvite,
} from "@/services/workspaces.service";
import { useUser } from "@/stores/authStore";

/**
 * "Join our workspace" — the organization tier above teams and projects.
 * The invites page shows workspace invitations alongside team and project ones
 * so none of them go unanswered.
 */
export function WorkspaceInviteCard({
	invite,
	highlighted = false,
	interactive = true,
}: {
	invite: WorkspaceInvite;
	/** Named by `?inviteId=` on the invitation email's link. */
	highlighted?: boolean;
	/** False in the "Past invites" list, which is a record, not a prompt. */
	interactive?: boolean;
}) {
	const toast = useToast();
	const cardRef = useRef<HTMLDivElement | null>(null);
	const respondMutation = useRespondWorkspaceInviteMutation();
	const enterWorkspace = useEnterWorkspace();
	const queryClient = useQueryClient();
	const user = useUser();

	// Scroll once the card is actually mounted, rather than on query settle, so
	// a slow list still lands on the right invitation.
	useEffect(() => {
		if (!highlighted || !cardRef.current) return;
		cardRef.current.scrollIntoView({ block: "center" });
	}, [highlighted]);

	const respond = (status: "accepted" | "declined") => {
		respondMutation.mutate(
			{ inviteId: invite.id, status },
			{
				onSuccess: async () => {
					toast.success(
						status === "accepted" ? "Invite accepted" : "Invite declined",
					);
					if (status !== "accepted" || !user) return;
					// Accepting means joining: land on the new workspace's dashboard.
					// The list is refetched (not read from cache) because the
					// membership did not exist a moment ago.
					const workspaces = await queryClient.fetchQuery({
						queryKey: workspaceKeys.mine(user.id),
						queryFn: listMyWorkspaces,
					});
					const joined = workspaces.find(
						(workspace) => workspace.id === invite.workspace_id,
					);
					if (joined) enterWorkspace(joined);
				},
				onError: (err) => toast.error((err as Error).message),
			},
		);
	};

	const workspaceName = invite.workspace?.name ?? "Workspace";
	const sentLabel = formatDistanceToNow(new Date(invite.created_at), {
		addSuffix: true,
	});

	return (
		<div
			ref={cardRef}
			className={highlighted ? "rounded-2xl ring-2 ring-primary/30" : undefined}
		>
			<AppSurfaceCard className="overflow-hidden p-0">
				{/* Header: workspace identity, role, and timestamp. */}
				<div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
					<div className="flex min-w-0 items-center gap-3">
						<WorkspaceAvatar
							name={workspaceName}
							avatarUrl={invite.workspace?.avatar_url ?? null}
						/>
						<div className="min-w-0">
							<h3 className="truncate text-base font-semibold text-slate-900">
								{workspaceName}
							</h3>
							<p className="mt-0.5 text-xs text-slate-500">
								Invited as{" "}
								<span className="font-medium text-slate-700">
									{invite.role}
								</span>{" "}
								· {sentLabel}
							</p>
						</div>
					</div>
				</div>

				{/* Body: who invited + optional message. */}
				<div className="space-y-4 px-6 py-4">
					{invite.invited_by_profile && (
						<div>
							<p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
								Invited by
							</p>
							<MemberDisplay
								// The invite payload's profile has no name parts; MemberDisplay
								// falls back to display_name / email either way.
								user={{
									...invite.invited_by_profile,
									first_name: null,
									last_name: null,
								}}
								fallbackId={invite.invited_by ?? undefined}
								size="sm"
							/>
						</div>
					)}
					{invite.message && (
						<div>
							<p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
								Message
							</p>
							<blockquote className="relative rounded-lg border-l-2 border-slate-300 bg-slate-50 px-4 py-3 text-sm italic text-slate-700">
								<Quote
									className="absolute -left-1 -top-1 h-4 w-4 -rotate-12 text-slate-300"
									aria-hidden="true"
								/>
								{invite.message}
							</blockquote>
						</div>
					)}
				</div>

				<div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3">
					{!interactive && (
						<span className="text-xs font-medium capitalize text-slate-500">
							{invite.status}
						</span>
					)}
					{interactive && (
						<>
							<button
								type="button"
								onClick={() => respond("declined")}
								disabled={respondMutation.isPending}
								className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
							>
								<X className="h-4 w-4" />
								Decline
							</button>
							<button
								type="button"
								onClick={() => respond("accepted")}
								disabled={respondMutation.isPending}
								className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-50"
							>
								{respondMutation.isPending ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									<Check className="h-4 w-4" />
								)}
								Accept
							</button>
						</>
					)}
				</div>
			</AppSurfaceCard>
		</div>
	);
}

function WorkspaceAvatar({
	name,
	avatarUrl,
}: {
	name: string;
	avatarUrl: string | null;
}) {
	if (avatarUrl) {
		return (
			<img
				src={avatarUrl}
				alt={name}
				className="h-10 w-10 shrink-0 rounded-xl object-cover"
			/>
		);
	}
	return (
		<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
			<Building2 className="h-5 w-5" aria-hidden="true" />
		</div>
	);
}
