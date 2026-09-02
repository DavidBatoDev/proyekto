import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { Check, FolderKanban, Loader2, Quote, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	AppEmptyState,
	AppSectionHeader,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { MemberDisplay } from "@/components/common/MemberDisplay";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { AcceptProjectTeamInviteDialog } from "@/components/team/AcceptProjectTeamInviteDialog";
import { WorkspaceInviteCard } from "@/components/workspace/WorkspaceInviteCard";
import { useToast } from "@/hooks/useToast";
import { useMyWorkspaceInvitesQuery } from "@/hooks/useWorkspaceQueries";
import { parseInviteIdParam } from "@/lib/inviteIdParam";
import {
	listMyProjectTeamInvites,
	listMyTeamInvites,
	type ProjectTeamInvite,
	respondProjectTeamInvite,
	respondTeamInvite,
	type TeamInvite,
} from "@/services/teams.service";
import { useAuthStore, useUser } from "@/stores/authStore";

export const Route = createFileRoute("/_execution/teams/me/invites")({
	validateSearch: (search: Record<string, unknown>): { inviteId?: string } => ({
		// `?inviteId=` names the invitation the email was about, so someone
		// holding several does not have to guess. Validated, not cast — see
		// parseInviteIdParam.
		inviteId: parseInviteIdParam(search.inviteId),
	}),
	beforeLoad: ({ search }) => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated)
			throw redirect({
				to: "/auth/login",
				search: {
					// Carry the invite through the login round-trip, otherwise the
					// deep link is lost exactly when it is most useful — a brand new
					// account arriving straight from the invitation email.
					redirect: search.inviteId
						? `/teams/me/invites?inviteId=${search.inviteId}`
						: "/teams/me/invites",
				},
			});
	},
	component: TeamInvitesPage,
});

function TeamInvitesPage() {
	const { inviteId } = Route.useSearch();
	const invitesQuery = useQuery({
		queryKey: ["teams", "my-invites"],
		queryFn: listMyTeamInvites,
	});
	// "Someone invited YOUR team to THEIR project" — the mirror image of the
	// invites above, and it lands on the same page deliberately: this is where
	// people come to answer invitations, and a second route for a second kind
	// would only mean half of them go unanswered.
	const projectInvitesQuery = useQuery({
		queryKey: ["teams", "my-project-invites"],
		queryFn: listMyProjectTeamInvites,
	});
	// The third kind: workspace (organization) invitations, answered here for
	// the same reason the project ones are.
	const workspaceInvitesQuery = useMyWorkspaceInvitesQuery();

	const invites = invitesQuery.data ?? [];
	const pending = invites.filter((i) => i.status === "pending");
	const settled = invites.filter((i) => i.status !== "pending");

	const projectInvites = projectInvitesQuery.data ?? [];
	const pendingProject = projectInvites.filter((i) => i.status === "pending");
	const settledProject = projectInvites.filter((i) => i.status !== "pending");

	const workspaceInvites = workspaceInvitesQuery.data ?? [];
	const pendingWorkspace = workspaceInvites.filter(
		(i) => i.status === "pending",
	);
	const settledWorkspace = workspaceInvites.filter(
		(i) => i.status !== "pending",
	);

	const isLoading =
		invitesQuery.isLoading ||
		projectInvitesQuery.isLoading ||
		workspaceInvitesQuery.isLoading;
	const isEmpty =
		invites.length === 0 &&
		projectInvites.length === 0 &&
		workspaceInvites.length === 0;

	return (
		<DashboardShell>
			<div className="mx-auto w-full max-w-[1040px] px-5 py-8 md:px-8 md:py-10">
				<AppSectionHeader
					kicker="Invitations"
					title="Your invites"
					subtitle="Invitations to join other people's workspaces and teams, and to bring one of your teams onto their projects."
				/>

				{isLoading ? (
					<div className="mt-8 flex items-center justify-center py-16 text-slate-500">
						<Loader2 className="mr-2 h-5 w-5 animate-spin" />
						Loading invites…
					</div>
				) : isEmpty ? (
					<div className="mt-8">
						<AppEmptyState
							icon={Users}
							title="No invites yet"
							description="When someone invites you to a team, or asks your team to join a project, it'll show up here."
						/>
					</div>
				) : (
					<div className="mt-8 space-y-8">
						{pendingWorkspace.length > 0 && (
							<section>
								<h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">
									Workspace invites ({pendingWorkspace.length})
								</h3>
								<div className="space-y-3">
									{pendingWorkspace.map((invite) => (
										<WorkspaceInviteCard
											key={invite.id}
											invite={invite}
											highlighted={invite.id === inviteId}
										/>
									))}
								</div>
							</section>
						)}
						{pendingProject.length > 0 && (
							<section>
								<h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">
									Project invitations for your team ({pendingProject.length})
								</h3>
								<div className="space-y-3">
									{pendingProject.map((invite) => (
										<ProjectInviteCard
											key={invite.id}
											invite={invite}
											interactive
											highlighted={invite.id === inviteId}
										/>
									))}
								</div>
							</section>
						)}
						{pending.length > 0 && (
							<section>
								<h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">
									Team invites ({pending.length})
								</h3>
								<div className="space-y-3">
									{pending.map((invite) => (
										<InviteCard
											key={invite.id}
											invite={invite}
											interactive
											highlighted={invite.id === inviteId}
										/>
									))}
								</div>
							</section>
						)}
						{(settled.length > 0 ||
							settledProject.length > 0 ||
							settledWorkspace.length > 0) && (
							<section>
								<h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">
									Past invites
								</h3>
								<div className="space-y-3">
									{settledWorkspace.map((invite) => (
										<WorkspaceInviteCard
											key={invite.id}
											invite={invite}
											interactive={false}
										/>
									))}
									{settledProject.map((invite) => (
										<ProjectInviteCard
											key={invite.id}
											invite={invite}
											interactive={false}
										/>
									))}
									{settled.map((invite) => (
										<InviteCard
											key={invite.id}
											invite={invite}
											interactive={false}
										/>
									))}
								</div>
							</section>
						)}
					</div>
				)}
			</div>
		</DashboardShell>
	);
}

/**
 * "Bring your team onto our project."
 *
 * Accepting needs two choices this card cannot hold — which team, and who from
 * it — so Accept opens a dialog rather than acting on click. Declining needs
 * neither, so it stays a one-click action here.
 */
function ProjectInviteCard({
	invite,
	interactive,
	highlighted = false,
}: {
	invite: ProjectTeamInvite;
	interactive: boolean;
	highlighted?: boolean;
}) {
	const queryClient = useQueryClient();
	const toast = useToast();
	const user = useUser();
	const cardRef = useRef<HTMLDivElement | null>(null);
	const [acceptOpen, setAcceptOpen] = useState(false);

	useEffect(() => {
		if (!highlighted || !cardRef.current) return;
		cardRef.current.scrollIntoView({ block: "center" });
	}, [highlighted]);

	const declineMutation = useMutation({
		mutationFn: () =>
			respondProjectTeamInvite(invite.id, { status: "declined" }),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["teams", "my-project-invites"],
			});
			toast.success("Invite declined");
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const projectName = invite.project?.title ?? "A project";
	const sentLabel = formatDistanceToNow(new Date(invite.created_at), {
		addSuffix: true,
	});

	return (
		<div
			ref={cardRef}
			className={highlighted ? "rounded-2xl ring-2 ring-primary/30" : undefined}
		>
			<AppSurfaceCard className="overflow-hidden p-0">
				<div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
					<div className="flex min-w-0 items-center gap-3">
						<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
							<FolderKanban className="h-5 w-5" aria-hidden="true" />
						</div>
						<div className="min-w-0">
							<div className="flex items-center gap-2">
								<h3 className="truncate text-base font-semibold text-slate-900">
									{projectName}
								</h3>
								<StatusBadge status={invite.status} />
							</div>
							<p className="mt-0.5 text-xs text-slate-500">
								Your members would join as{" "}
								<span className="font-medium text-slate-700">
									{invite.member_role}
								</span>{" "}
								· {sentLabel}
							</p>
						</div>
					</div>
				</div>

				<div className="space-y-4 px-6 py-4">
					{invite.invited_by_profile && (
						<div>
							<p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
								Invited by
							</p>
							<MemberDisplay
								user={invite.invited_by_profile}
								fallbackId={invite.invited_by ?? undefined}
								size="sm"
							/>
						</div>
					)}
					{invite.team_name_hint && (
						<div>
							<p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
								Team they asked for
							</p>
							<p className="text-sm text-slate-700">{invite.team_name_hint}</p>
						</div>
					)}
					{invite.team && (
						<div>
							<p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
								Team you brought
							</p>
							<p className="text-sm text-slate-700">{invite.team.name}</p>
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

				{interactive ? (
					<div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3">
						<button
							type="button"
							onClick={() => declineMutation.mutate()}
							disabled={declineMutation.isPending}
							className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
						>
							<X className="h-4 w-4" />
							Decline
						</button>
						<button
							type="button"
							onClick={() => setAcceptOpen(true)}
							disabled={declineMutation.isPending}
							className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
						>
							<Check className="h-4 w-4" />
							Choose a team…
						</button>
					</div>
				) : (
					<div className="border-t border-slate-100 bg-slate-50/60 px-6 py-3 text-xs text-slate-500">
						{invite.responded_at ? (
							<>
								{invite.status === "accepted" && "Accepted "}
								{invite.status === "declined" && "Declined "}
								{invite.status === "cancelled" && "Cancelled "}
								{formatDistanceToNow(new Date(invite.responded_at), {
									addSuffix: true,
								})}
							</>
						) : (
							<>No longer actionable.</>
						)}
					</div>
				)}
			</AppSurfaceCard>

			{acceptOpen && (
				<AcceptProjectTeamInviteDialog
					invite={invite}
					currentUserId={user?.id ?? null}
					onClose={() => setAcceptOpen(false)}
				/>
			)}
		</div>
	);
}

function InviteCard({
	invite,
	interactive,
	highlighted = false,
}: {
	invite: TeamInvite;
	interactive: boolean;
	/** Named by `?inviteId=` on the invitation email's link. */
	highlighted?: boolean;
}) {
	const queryClient = useQueryClient();
	const toast = useToast();
	const cardRef = useRef<HTMLDivElement | null>(null);

	// Scroll once the card is actually mounted, rather than on query settle, so
	// a slow list still lands on the right invitation.
	useEffect(() => {
		if (!highlighted || !cardRef.current) return;
		cardRef.current.scrollIntoView({ block: "center" });
	}, [highlighted]);

	const respondMutation = useMutation({
		mutationFn: (status: "accepted" | "declined") =>
			respondTeamInvite(invite.id, status),
		onSuccess: (_data, status) => {
			void queryClient.invalidateQueries({
				queryKey: ["teams", "my-invites"],
			});
			void queryClient.invalidateQueries({ queryKey: ["teams", "mine"] });
			toast.success(
				status === "accepted" ? "Invite accepted" : "Invite declined",
			);
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const teamName = invite.team?.name ?? "Team";
	const sentLabel = formatDistanceToNow(new Date(invite.created_at), {
		addSuffix: true,
	});

	return (
		<div
			ref={cardRef}
			className={highlighted ? "rounded-2xl ring-2 ring-primary/30" : undefined}
		>
			<AppSurfaceCard className="overflow-hidden p-0">
				{/* Header: team identity, status, and timestamp. */}
				<div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
					<div className="flex min-w-0 items-center gap-3">
						<TeamAvatar
							name={teamName}
							avatarUrl={invite.team?.avatar_url ?? null}
						/>
						<div className="min-w-0">
							<div className="flex items-center gap-2">
								<h3 className="truncate text-base font-semibold text-slate-900">
									{teamName}
								</h3>
								<StatusBadge status={invite.status} />
							</div>
							<p className="mt-0.5 text-xs text-slate-500">
								Invited as{" "}
								<span className="font-medium text-slate-700">
									{invite.position
										? `${invite.position} (${invite.role})`
										: invite.role}
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
								user={invite.invited_by_profile}
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

				{/* Footer: actions on pending only; otherwise outcome line. */}
				{interactive ? (
					<div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3">
						<button
							type="button"
							onClick={() => respondMutation.mutate("declined")}
							disabled={respondMutation.isPending}
							className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
						>
							<X className="h-4 w-4" />
							Decline
						</button>
						<button
							type="button"
							onClick={() => respondMutation.mutate("accepted")}
							disabled={respondMutation.isPending}
							className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
						>
							{respondMutation.isPending ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Check className="h-4 w-4" />
							)}
							Accept
						</button>
					</div>
				) : (
					<div className="border-t border-slate-100 bg-slate-50/60 px-6 py-3 text-xs text-slate-500">
						{invite.responded_at ? (
							<>
								{invite.status === "accepted" && "Accepted "}
								{invite.status === "declined" && "Declined "}
								{invite.status === "cancelled" && "Cancelled "}
								{formatDistanceToNow(new Date(invite.responded_at), {
									addSuffix: true,
								})}
							</>
						) : (
							<>No longer actionable.</>
						)}
					</div>
				)}
			</AppSurfaceCard>
		</div>
	);
}

function StatusBadge({ status }: { status: TeamInvite["status"] }) {
	const styles =
		status === "accepted"
			? "border-emerald-200 bg-emerald-50 text-emerald-700"
			: status === "declined"
				? "border-rose-200 bg-rose-50 text-rose-700"
				: // pending and cancelled both use the neutral slate chip — pending
					// is communicated by section header, cancelled by being in "past".
					"border-slate-300 bg-slate-100 text-slate-700";
	return (
		<span
			className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles}`}
		>
			{status}
		</span>
	);
}

function TeamAvatar({
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
	const initial = (name?.trim()[0] || "T").toUpperCase();
	return (
		<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
			<span className="text-sm font-semibold">{initial}</span>
		</div>
	);
}
