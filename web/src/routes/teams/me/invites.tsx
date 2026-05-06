import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Check, Loader2, Quote, Users, X } from "lucide-react";
import {
	AppEmptyState,
	AppSectionHeader,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { MemberDisplay } from "@/components/common/MemberDisplay";
import { useToast } from "@/hooks/useToast";
import { useAuthStore } from "@/stores/authStore";
import {
	listMyTeamInvites,
	respondTeamInvite,
	type TeamInvite,
} from "@/services/teams.service";

export const Route = createFileRoute("/teams/me/invites")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) throw redirect({ to: "/auth/login" });
	},
	component: TeamInvitesPage,
});

function TeamInvitesPage() {
	const invitesQuery = useQuery({
		queryKey: ["teams", "my-invites"],
		queryFn: listMyTeamInvites,
	});

	const invites = invitesQuery.data ?? [];
	const pending = invites.filter((i) => i.status === "pending");
	const settled = invites.filter((i) => i.status !== "pending");

	return (
		<DashboardShell>
			<div className="mx-auto w-full max-w-[1040px] px-5 py-8 md:px-8 md:py-10">
				<AppSectionHeader
					kicker="Invitations"
					title="Team invites"
					subtitle="Accept or decline invitations to join other people's teams."
				/>

				{invitesQuery.isLoading ? (
					<div className="mt-8 flex items-center justify-center py-16 text-slate-500">
						<Loader2 className="mr-2 h-5 w-5 animate-spin" />
						Loading invites…
					</div>
				) : invites.length === 0 ? (
					<div className="mt-8">
						<AppEmptyState
							icon={Users}
							title="No invites yet"
							description="When someone invites you to a team, it'll show up here."
						/>
					</div>
				) : (
					<div className="mt-8 space-y-8">
						{pending.length > 0 && (
							<section>
								<h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">
									Pending ({pending.length})
								</h3>
								<div className="space-y-3">
									{pending.map((invite) => (
										<InviteCard
											key={invite.id}
											invite={invite}
											interactive
										/>
									))}
								</div>
							</section>
						)}
						{settled.length > 0 && (
							<section>
								<h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">
									Past invites
								</h3>
								<div className="space-y-3">
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

function InviteCard({
	invite,
	interactive,
}: {
	invite: TeamInvite;
	interactive: boolean;
}) {
	const queryClient = useQueryClient();
	const toast = useToast();

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
