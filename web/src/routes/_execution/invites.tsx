import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { parseInviteIdParam } from "@/lib/inviteIdParam";
import { type ProjectInvite, projectService } from "@/services/project.service";
import { useAuthStore } from "@/stores/authStore";

/**
 * Project invitations, for whoever received one.
 *
 * Canonical home of this page. It lived at `/freelancer/invites`, which was
 * wrong for everyone who is not a freelancer — a client or consultant invited
 * to a project got mailed a URL with someone else's persona in it. Nothing
 * about the page is persona-specific: `getMyInvites()` returns every project
 * invite for the signed-in user and the only guard is authentication.
 *
 * `/freelancer/invites` still resolves, as a redirect here — invitation emails
 * carrying the old path are already in inboxes.
 */

export const Route = createFileRoute("/_execution/invites")({
	validateSearch: (search: Record<string, unknown>): { inviteId?: string } => ({
		// Validated, not cast — see parseInviteIdParam.
		inviteId: parseInviteIdParam(search.inviteId),
	}),
	beforeLoad: ({ search }) => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) {
			throw redirect({
				to: "/auth/login",
				search: {
					// Carry the invite through the login round-trip, otherwise the
					// deep link is lost exactly when it is most useful.
					redirect: search.inviteId
						? `/invites?inviteId=${search.inviteId}`
						: "/invites",
				},
			});
		}
	},
	component: InvitesPage,
});

function statusBadge(status: ProjectInvite["status"]) {
	if (status === "accepted") {
		return "bg-green-100 text-green-700";
	}
	if (status === "declined") {
		return "bg-red-100 text-red-700";
	}
	return "bg-amber-100 text-amber-700";
}

function InvitesPage() {
	const queryClient = useQueryClient();
	const { inviteId } = Route.useSearch();
	const highlightRef = useRef<HTMLDivElement | null>(null);

	const invitesQuery = useQuery({
		queryKey: ["projects", "my-invites"],
		queryFn: () => projectService.getMyInvites(),
	});

	const respondMutation = useMutation({
		mutationFn: ({
			inviteId: id,
			status,
		}: {
			inviteId: string;
			status: "accepted" | "declined";
		}) => projectService.respondInvite(id, status),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["projects", "my-invites"],
			});
		},
	});

	const invites = invitesQuery.data || [];

	// Scroll once the list has actually rendered. Guarded on the ref rather than
	// on `isLoading` so a slow query still lands on the right card.
	useEffect(() => {
		if (!inviteId || !highlightRef.current) return;
		highlightRef.current.scrollIntoView({ block: "center" });
	}, [inviteId, invitesQuery.data]);

	return (
		<div className="min-h-screen bg-gray-50 pt-24 pb-12 px-4">
			<div className="max-w-5xl mx-auto space-y-6">
				<div className="bg-white border border-gray-200 rounded-2xl p-6">
					<h1 className="text-2xl font-bold text-gray-900">
						Your project invites
					</h1>
					<p className="text-sm text-gray-600 mt-1">
						Review and respond to invitations to join a project.
					</p>
				</div>

				{invitesQuery.isLoading ? (
					<div className="bg-white border border-gray-200 rounded-2xl p-12 flex items-center justify-center">
						<Loader2 className="w-8 h-8 animate-spin text-primary" />
					</div>
				) : invites.length === 0 ? (
					<div className="bg-white border border-gray-200 rounded-2xl p-12 text-center">
						<h2 className="text-lg font-semibold text-gray-900">
							No invites yet
						</h2>
						<p className="text-sm text-gray-600 mt-1">
							New project invites will appear here.
						</p>
					</div>
				) : (
					<div className="space-y-4">
						{invites.map((invite) => {
							const isHighlighted = invite.id === inviteId;
							return (
								<div
									key={invite.id}
									ref={isHighlighted ? highlightRef : undefined}
									className={`bg-white rounded-2xl p-5 flex flex-col gap-4 border ${
										isHighlighted
											? "border-primary ring-2 ring-primary/20"
											: "border-gray-200"
									}`}
								>
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div>
											<h2 className="text-lg font-semibold text-gray-900">
												{invite.project?.title || "Untitled Project"}
											</h2>
											<p className="text-sm text-gray-600 mt-1">
												Invited by {invite.inviter?.display_name || "Team lead"}
											</p>
											<p className="text-xs text-gray-500 mt-1">
												Sent {new Date(invite.created_at).toLocaleString()}
											</p>
										</div>
										<span
											className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium capitalize ${statusBadge(invite.status)}`}
										>
											{invite.status}
										</span>
									</div>

									{invite.message && (
										<div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
											{invite.message}
										</div>
									)}

									{invite.status === "pending" ? (
										<div className="flex items-center gap-2">
											<button
												type="button"
												disabled={respondMutation.isPending}
												onClick={() =>
													respondMutation.mutate({
														inviteId: invite.id,
														status: "declined",
													})
												}
												className="px-4 py-2 rounded-xl border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
											>
												Decline
											</button>
											<button
												type="button"
												disabled={respondMutation.isPending}
												onClick={() =>
													respondMutation.mutate({
														inviteId: invite.id,
														status: "accepted",
													})
												}
												className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary-dark disabled:opacity-60"
											>
												Accept invite
											</button>
										</div>
									) : null}
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
