import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
	ChevronRight,
	Loader2,
	Mail,
	Pencil,
	Plus,
	Trash2,
	Users,
	X,
} from "lucide-react";
import { AppSectionHeader, AppSurfaceCard } from "@/components/common/AppPrimitives";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { MemberDisplay } from "@/components/common/MemberDisplay";
import { ModalPortal } from "@/components/common/ModalPortal";
import { useToast } from "@/hooks/useToast";
import { useAuthStore, useUser } from "@/stores/authStore";
import {
	cancelTeamInvite,
	getTeam,
	inviteTeamMemberByEmail,
	listTeamInvites,
	listTeamMembers,
	removeTeamMember,
	updateTeamMember,
	type TeamInvite,
	type TeamMember,
	type TeamRole,
} from "@/services/teams.service";

/**
 * Blue chip for the free-form member position (e.g. "Backend Developer").
 * Mirrors the landing-page accent palette.
 */
function PositionChip({ children }: { children: ReactNode }) {
	return (
		<span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
			{children}
		</span>
	)
}

/**
 * Slate chip for the access level (owner / admin / member). All three
 * use the same neutral fill so the row reads as a clean two-tone pair
 * with the blue position chip; the role text alone communicates the
 * tier.
 */
function RoleChip({ role }: { role: TeamRole }) {
	return (
		<span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
			{role}
		</span>
	)
}

export const Route = createFileRoute("/teams/$teamId/")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
	},
	component: TeamDetailPage,
});

function TeamDetailPage() {
	const { teamId } = Route.useParams();
	const user = useUser();
	const teamQuery = useQuery({
		queryKey: ["teams", "detail", teamId],
		queryFn: () => getTeam(teamId),
	});
	const membersQuery = useQuery({
		queryKey: ["teams", "members", teamId],
		queryFn: () => listTeamMembers(teamId),
	});

	const team = teamQuery.data;
	const members = membersQuery.data ?? [];
	const isOwner = team && user && team.owner_id === user.id;
	const [inviteOpen, setInviteOpen] = useState(false);

	// Pending invites are only readable by owner / admins. We gate the
	// query to avoid 403 noise for plain members.
	const invitesQuery = useQuery({
		queryKey: ["teams", "invites", teamId],
		queryFn: () => listTeamInvites(teamId),
		enabled: Boolean(isOwner),
	});
	const pendingInvites = (invitesQuery.data ?? []).filter(
		(i) => i.status === "pending",
	)

	if (teamQuery.isLoading) {
		return (
			<DashboardShell>
				<div className="flex h-64 items-center justify-center text-slate-500">
					<Loader2 className="mr-2 h-5 w-5 animate-spin" />
					Loading team…
				</div>
			</DashboardShell>
		)
	}
	if (teamQuery.error) {
		return (
			<DashboardShell>
				<AppSurfaceCard className="m-8 p-6 text-rose-700">
					{(teamQuery.error as Error).message}
				</AppSurfaceCard>
			</DashboardShell>
		)
	}
	if (!team) return null;

	return (
		<DashboardShell>
			<div className="mx-auto w-full max-w-[1040px] px-5 py-8 md:px-8 md:py-10">
				<nav
					aria-label="Breadcrumb"
					className="mb-6 flex items-center gap-1.5 text-sm font-medium"
				>
					<Link
						to="/teams"
						className="text-slate-600 transition-colors hover:text-slate-900"
					>
						Teams
					</Link>
					<ChevronRight
						className="h-4 w-4 text-slate-400"
						aria-hidden="true"
					/>
					<span aria-current="page" className="truncate text-slate-900">
						{team.name || "Untitled team"}
					</span>
				</nav>

				<AppSectionHeader
					kicker="Team"
					title={team.name}
					subtitle={team.description ?? undefined}
				/>

				<div className="mt-8">
					<div className="mb-3 flex items-center justify-between">
						<h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
							Members ({members.length}
							{pendingInvites.length > 0
								? ` · ${pendingInvites.length} pending`
								: ""}
							)
						</h3>
						{isOwner && (
							<button
								type="button"
								onClick={() => setInviteOpen(true)}
								className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
							>
								<Plus className="h-4 w-4" />
								Invite member
							</button>
						)}
					</div>
					<AppSurfaceCard className="overflow-hidden">
						{membersQuery.isLoading ? (
							<div className="flex items-center justify-center py-10 text-slate-500">
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Loading…
							</div>
						) : members.length === 0 && pendingInvites.length === 0 ? (
							<div className="px-6 py-10 text-center text-sm text-slate-500">
								No members yet.
							</div>
						) : (
							<ul className="divide-y divide-slate-200">
								{members.map((m) => (
									<MemberRow
										key={m.id}
										member={m}
										teamId={teamId}
										isOwnerView={Boolean(isOwner)}
										ownerId={team.owner_id}
									/>
								))}
								{pendingInvites.map((invite) => (
									<PendingInviteRow
										key={invite.id}
										invite={invite}
										teamId={teamId}
										isOwnerView={Boolean(isOwner)}
									/>
								))}
							</ul>
						)}
					</AppSurfaceCard>
				</div>
			</div>

			{inviteOpen && (
				<InviteMemberModal
					teamId={teamId}
					onClose={() => setInviteOpen(false)}
				/>
			)}
		</DashboardShell>
	)
}

function MemberRow({
	member,
	teamId,
	isOwnerView,
	ownerId,
}: {
	member: TeamMember;
	teamId: string;
	isOwnerView: boolean;
	ownerId: string;
}) {
	const queryClient = useQueryClient();
	const toast = useToast();
	const isOwnerRow = member.user_id === ownerId;
	const [editOpen, setEditOpen] = useState(false);

	const removeMutation = useMutation({
		mutationFn: () => removeTeamMember(teamId, member.user_id),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["teams", "members", teamId],
			})
			toast.success("Member removed");
		},
		onError: (err) => toast.error((err as Error).message),
	});

	return (
		<>
			<li className="flex items-center justify-between px-5 py-3">
				<MemberDisplay
					user={member.user}
					fallbackId={member.user_id}
					subtitleSlot={
						<>
							{member.position && (
								<PositionChip>{member.position}</PositionChip>
							)}
							<RoleChip role={member.role} />
						</>
					}
				/>
				{isOwnerView && (
					<div className="flex shrink-0 items-center gap-1">
						<button
							type="button"
							onClick={() => setEditOpen(true)}
							aria-label="Edit member"
							title="Edit member"
							className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
						>
							<Pencil className="h-3.5 w-3.5" />
						</button>
						{!isOwnerRow && (
							<button
								type="button"
								onClick={() => removeMutation.mutate()}
								disabled={removeMutation.isPending}
								aria-label="Remove member"
								title="Remove member"
								className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
							>
								{removeMutation.isPending ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								) : (
									<Trash2 className="h-3.5 w-3.5" />
								)}
							</button>
						)}
					</div>
				)}
			</li>
			{editOpen && (
				<EditMemberModal
					teamId={teamId}
					member={member}
					isOwnerRow={isOwnerRow}
					onClose={() => setEditOpen(false)}
				/>
			)}
		</>
	)
}

function EditMemberModal({
	teamId,
	member,
	isOwnerRow,
	onClose,
}: {
	teamId: string;
	member: TeamMember;
	isOwnerRow: boolean;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const toast = useToast();
	const [position, setPosition] = useState(member.position ?? "");
	const [role, setRole] = useState<"admin" | "member">(
		member.role === "admin" ? "admin" : "member",
	)

	const mutation = useMutation({
		mutationFn: () => {
			// Owner row's role is non-editable on the backend; only send
			// position to avoid an unnecessary 403 on the role check.
			const patch: { position: string; role?: "admin" | "member" } = {
				position: position.trim(),
			}
			if (!isOwnerRow) patch.role = role;
			return updateTeamMember(teamId, member.user_id, patch);
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["teams", "members", teamId],
			})
			toast.success("Member updated");
			onClose();
		},
		onError: (err) => toast.error((err as Error).message),
	});

	return (
		<ModalPortal>
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
			onClick={onClose}
		>
			<div
				className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="mb-1 flex items-center gap-2">
					<Pencil className="h-5 w-5 text-slate-700" />
					<h2 className="text-lg font-semibold text-slate-900">
						Edit member
					</h2>
				</div>
				<p className="mt-1 text-sm text-slate-600">
					Update this person's title and role within the team.
				</p>
				<form
					className="mt-5 space-y-4"
					onSubmit={(e) => {
						e.preventDefault();
						mutation.mutate();
					}}
				>
					<label className="block">
						<span className="text-sm font-medium text-slate-700">
							Position
						</span>
						<input
							autoFocus
							type="text"
							value={position}
							onChange={(e) => setPosition(e.target.value)}
							maxLength={120}
							placeholder="e.g. Engineering Lead, Designer"
							className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
						/>
					</label>
					{!isOwnerRow && (
						<label className="block">
							<span className="text-sm font-medium text-slate-700">
								Access level
							</span>
							<select
								value={role}
								onChange={(e) =>
									setRole(e.target.value as "admin" | "member")
								}
								className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
							>
								<option value="member">Member</option>
								<option value="admin">Admin</option>
							</select>
						</label>
					)}
					<div className="flex justify-end gap-2 pt-2">
						<button
							type="button"
							onClick={onClose}
							className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={mutation.isPending}
							className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
						>
							{mutation.isPending && (
								<Loader2 className="h-4 w-4 animate-spin" />
							)}
							Save
						</button>
					</div>
				</form>
			</div>
		</div>
		</ModalPortal>
	)
}

function PendingInviteRow({
	invite,
	teamId,
	isOwnerView,
}: {
	invite: TeamInvite;
	teamId: string;
	isOwnerView: boolean;
}) {
	const queryClient = useQueryClient();
	const toast = useToast();

	const cancelMutation = useMutation({
		mutationFn: () => cancelTeamInvite(teamId, invite.id),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["teams", "invites", teamId],
			})
			toast.success("Invite cancelled");
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const displayEmail =
		invite.invitee?.email || invite.invitee_email || "unknown";
	const displayName =
		invite.invitee?.display_name ||
		[invite.invitee?.first_name, invite.invitee?.last_name]
			.filter(Boolean)
			.join(" ") ||
		null

	const metaParts: string[] = [];
	if (invite.position) metaParts.push(invite.position);
	metaParts.push(invite.role);
	if (displayName) metaParts.push(displayEmail);

	return (
		<li className="flex items-center justify-between px-5 py-3">
			<div className="flex min-w-0 items-center gap-3">
				<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
					<Mail className="h-4 w-4" />
				</div>
				<div className="min-w-0">
					<p className="truncate text-sm font-medium text-slate-900">
						{displayName || displayEmail}
					</p>
					<p className="mt-0.5 flex items-center gap-2 truncate text-xs text-slate-500">
						<span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
							Pending
						</span>
						<span className="truncate">{metaParts.join(" · ")}</span>
					</p>
				</div>
			</div>
			{isOwnerView && (
				<button
					type="button"
					onClick={() => cancelMutation.mutate()}
					disabled={cancelMutation.isPending}
					className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
				>
					{cancelMutation.isPending ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" />
					) : (
						<X className="h-3.5 w-3.5" />
					)}
					Cancel invite
				</button>
			)}
		</li>
	)
}

function InviteMemberModal({
	teamId,
	onClose,
}: {
	teamId: string;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const toast = useToast();
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<TeamRole>("member");
	const [position, setPosition] = useState("");
	const [message, setMessage] = useState("");

	const mutation = useMutation({
		mutationFn: () =>
			inviteTeamMemberByEmail(teamId, {
				email: email.trim(),
				role,
				position: position.trim() || undefined,
				message: message.trim() || undefined,
			}),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["teams", "invites", teamId],
			})
			toast.success(`Invite sent to ${email.trim()}`);
			onClose();
		},
		onError: (err) => toast.error((err as Error).message),
	});

	return (
		<ModalPortal>
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
			onClick={onClose}
		>
			<div
				className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="mb-1 flex items-center gap-2">
					<Users className="h-5 w-5 text-slate-700" />
					<h2 className="text-lg font-semibold text-slate-900">
						Invite team member
					</h2>
				</div>
				<p className="mt-1 text-sm text-slate-600">
					Send an invite by email. They'll get a notification with an option
					to accept or decline. People who don't have an account yet will get
					reconciled automatically when they sign up.
				</p>
				<form
					className="mt-5 space-y-4"
					onSubmit={(e) => {
						e.preventDefault();
						if (!email.trim()) return;
						mutation.mutate();
					}}
				>
					<label className="block">
						<span className="text-sm font-medium text-slate-700">
							Email address
						</span>
						<input
							autoFocus
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							placeholder="someone@example.com"
							className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
						/>
					</label>
					<div className="grid grid-cols-2 gap-3">
						<label className="block">
							<span className="text-sm font-medium text-slate-700">
								Access level
							</span>
							<select
								value={role}
								onChange={(e) => setRole(e.target.value as TeamRole)}
								className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
							>
								<option value="member">Member</option>
								<option value="admin">Admin</option>
							</select>
						</label>
						<label className="block">
							<span className="text-sm font-medium text-slate-700">
								Position
							</span>
							<input
								type="text"
								value={position}
								onChange={(e) => setPosition(e.target.value)}
								maxLength={120}
								placeholder="e.g. Designer"
								className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
							/>
						</label>
					</div>
					<label className="block">
						<span className="text-sm font-medium text-slate-700">
							Message (optional)
						</span>
						<textarea
							value={message}
							onChange={(e) => setMessage(e.target.value)}
							maxLength={500}
							rows={3}
							placeholder="Hey — I'd love to have you on this team."
							className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
						/>
					</label>
					<div className="flex justify-end gap-2 pt-2">
						<button
							type="button"
							onClick={onClose}
							className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={!email.trim() || mutation.isPending}
							className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
						>
							{mutation.isPending && (
								<Loader2 className="h-4 w-4 animate-spin" />
							)}
							Send invite
						</button>
					</div>
				</form>
			</div>
		</div>
		</ModalPortal>
	)
}
