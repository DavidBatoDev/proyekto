import { Link } from "@tanstack/react-router";
import {
	useMutation,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
	ChevronDown,
	ChevronRight,
	Loader2,
	Mail,
	Plus,
	Settings,
	Users,
	X,
} from "lucide-react";
import {
	AppEmptyState,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { MemberDisplay } from "@/components/common/MemberDisplay";
import { ModalPortal } from "@/components/common/ModalPortal";
import { useToast } from "@/hooks/useToast";
import {
	useProjectCancelInviteMutation,
	useProjectInvitesQuery,
	useProjectMembersQuery,
	useProjectMyPermissionsQuery,
	useProjectRemoveMemberMutation,
} from "@/hooks/useProjectQueries";
import { projectKeys } from "@/queries/project";
import {
	addCuratedMember,
	getTeam,
	listAvailableTeamMembers,
	listCuratedMembers,
	listProjectTeams,
	removeCuratedMember,
	type ProjectTeam,
	type ProjectTeamMember,
} from "@/services/teams.service";
import type { ProjectInvite, ProjectMember } from "@/services/project.service";
import type { ProfileSummary } from "@/services/teams.service";
import { ProjectMemberRow } from "./ProjectMemberRow";

/**
 * project_access rows carry a slightly looser user shape than the
 * teams service's ProfileSummary (optional fields + undefined instead
 * of null). Coerce so MemberDisplay's typed prop is happy.
 */
function toProfileSummary(
	u: ProjectMember["user"] | undefined,
): ProfileSummary | null {
	if (!u) return null;
	return {
		id: u.id,
		display_name: u.display_name ?? null,
		avatar_url: u.avatar_url ?? null,
		email: u.email ?? null,
		first_name: u.first_name ?? null,
		last_name: u.last_name ?? null,
	};
}
import { InviteToProjectModal } from "./InviteToProjectModal";
import { TeamSkeleton } from "./TeamSkeleton";

export function TeamPage({ projectId }: { projectId: string }) {
	const membersQuery = useProjectMembersQuery(projectId);
	const invitesQuery = useProjectInvitesQuery(projectId);
	const permissionsQuery = useProjectMyPermissionsQuery(projectId);
	const teamsQuery = useQuery({
		queryKey: ["project", projectId, "teams"],
		queryFn: () => listProjectTeams(projectId),
	});

	const [inviteOpen, setInviteOpen] = useState(false);

	const canManage = Boolean(permissionsQuery.data?.members.manage);
	const members = membersQuery.data ?? [];
	const invites = invitesQuery.data ?? [];
	const projectTeams = teamsQuery.data ?? [];

	const pendingInvites = invites.filter((i) => i.status === "pending");

	// Direct shares = project_access rows whose origin is NOT a team
	// fan-out. Team-derived rows live inside their team's card.
	const directShares = members.filter(
		(m) => !m.origin || !m.origin.startsWith("team:"),
	);

	// Sort attached teams: primary first, then by attached_at as a
	// stable secondary key (we don't have team names embedded here).
	const sortedTeams = [...projectTeams].sort((a, b) => {
		if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
		return (a.attached_at ?? "").localeCompare(b.attached_at ?? "");
	});

	// Batch-fetch team detail rows so we can name multi-origin siblings
	// on the Direct collaborators card. Each AttachedTeamCard runs its
	// own getTeam query too — react-query dedupes by queryKey, so this
	// is a single network call shared across both consumers.
	const teamDetailQueries = useQueries({
		queries: projectTeams.map((pt) => ({
			queryKey: ["teams", "detail", pt.team_id],
			queryFn: () => getTeam(pt.team_id),
		})),
	});
	const teamNameById = useMemo(() => {
		const map = new Map<string, string>();
		for (const q of teamDetailQueries) {
			if (q.data) map.set(q.data.id, q.data.name);
		}
		return map;
	}, [teamDetailQueries]);

	// Yoked-role lookup. After the access-sync rule, every project_access
	// row for a (project, user) carries the same role; we use the first
	// one we see per user as the source of truth so the team cards
	// display the user's effective role on the project (e.g. OWNER for
	// the consultant) instead of the team's natural default_role.
	const syncedRoleByUserId = useMemo(() => {
		const map = new Map<string, string>();
		for (const m of members) {
			if (!m.user_id) continue;
			if (map.has(m.user_id)) continue;
			map.set(m.user_id, m.role);
		}
		return map;
	}, [members]);

	// For each user_id with a direct share, collect the team names of
	// any team-derived sibling rows. Used to render "Also on <Team>"
	// chips so the dual-grant nature is visible without double-listing.
	const directAlsoOnByUserId = useMemo(() => {
		const out = new Map<string, string[]>();
		const directUserIds = new Set(
			members
				.filter((m) => !m.origin || !m.origin.startsWith("team:"))
				.map((m) => m.user_id)
				.filter((id): id is string => Boolean(id)),
		);
		for (const m of members) {
			if (!m.user_id || !m.origin?.startsWith("team:")) continue;
			if (!directUserIds.has(m.user_id)) continue;
			const teamId = m.origin.slice("team:".length);
			const name = teamNameById.get(teamId);
			if (!name) continue;
			const arr = out.get(m.user_id) ?? [];
			if (!arr.includes(name)) arr.push(name);
			out.set(m.user_id, arr);
		}
		return out;
	}, [members, teamNameById]);

	const isLoading =
		membersQuery.isPending || invitesQuery.isPending || teamsQuery.isPending;

	if (isLoading) {
		return (
			<div className="mx-auto w-full max-w-[1040px] px-5 py-8 md:px-8 md:py-10">
				<TeamSkeleton />
			</div>
		);
	}

	const showFullEmpty =
		sortedTeams.length === 0 &&
		directShares.length === 0 &&
		pendingInvites.length === 0;

	return (
		<div className="mx-auto w-full max-w-[1040px] px-5 py-8 md:px-8 md:py-10">
			{/* Header */}
			<div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<p className="app-section-kicker">Team</p>
					<h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
						Project team
					</h2>
					<p className="mt-1 max-w-2xl text-sm text-slate-600">
						Everyone with access to this project, grouped by the team they
						belong to.
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{canManage && (
						<button
							type="button"
							onClick={() => setInviteOpen(true)}
							className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
						>
							<Plus className="h-4 w-4" />
							Invite by email
						</button>
					)}
					<Link
						to="/project/$projectId/settings/teams"
						params={{ projectId }}
						className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
					>
						<Settings className="h-4 w-4" />
						Manage teams
					</Link>
				</div>
			</div>

			{/* Body */}
			<div className="mt-8 space-y-6">
				{showFullEmpty ? (
					<AppEmptyState
						icon={Users}
						title="No collaborators yet"
						description="Invite someone by email or attach a team to bring its members onto this project."
						action={
							canManage ? (
								<div className="flex items-center justify-center gap-2">
									<button
										type="button"
										onClick={() => setInviteOpen(true)}
										className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
									>
										<Plus className="h-4 w-4" />
										Invite by email
									</button>
									<Link
										to="/project/$projectId/settings/teams"
										params={{ projectId }}
										className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
									>
										<Settings className="h-4 w-4" />
										Attach a team
									</Link>
								</div>
							) : null
						}
					/>
				) : (
					<>
						{pendingInvites.length > 0 && (
							<PendingInvitesCard
								projectId={projectId}
								invites={pendingInvites}
								canManage={canManage}
							/>
						)}

						{directShares.length > 0 && (
							<DirectSharesCard
								projectId={projectId}
								shares={directShares}
								canManage={canManage}
								alsoOnByUserId={directAlsoOnByUserId}
							/>
						)}

						{sortedTeams.length > 0 && (
							<section>
								<h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
									Teams ({sortedTeams.length})
								</h3>
								<div className="space-y-4">
									{sortedTeams.map((pt) => (
										<AttachedTeamCard
											key={pt.team_id}
											projectId={projectId}
											projectTeam={pt}
											canManage={canManage}
											syncedRoleByUserId={syncedRoleByUserId}
										/>
									))}
								</div>
							</section>
						)}
					</>
				)}
			</div>

			{inviteOpen && (
				<InviteToProjectModal
					projectId={projectId}
					onClose={() => setInviteOpen(false)}
				/>
			)}
		</div>
	);
}

// ─── Pending invites ────────────────────────────────────────────────────────

function PendingInvitesCard({
	projectId,
	invites,
	canManage,
}: {
	projectId: string;
	invites: ProjectInvite[];
	canManage: boolean;
}) {
	const cancelMutation = useProjectCancelInviteMutation(projectId);
	const toast = useToast();

	return (
		<section>
			<h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
				Pending invites ({invites.length})
			</h3>
			<AppSurfaceCard className="overflow-hidden">
				<ul className="divide-y divide-slate-200">
					{invites.map((invite) => {
						// project_invites only carries invitee_email + (when
						// reconciled to a profile) invitee_id. No embedded
						// profile, so we display the email directly and let
						// the position field act as the sub-label.
						const displayEmail = invite.invitee_email || "unknown";
						return (
							<li
								key={invite.id}
								className="flex items-center justify-between gap-3 px-5 py-3"
							>
								<div className="flex min-w-0 items-center gap-3">
									<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
										<Mail className="h-4 w-4" />
									</div>
									<div className="min-w-0">
										<p className="truncate text-sm font-medium text-slate-900">
											{displayEmail}
										</p>
										<p className="mt-0.5 flex items-center gap-2 truncate text-xs text-slate-500">
											<span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
												Pending
											</span>
											{invite.invited_position && (
												<span className="truncate">
													{invite.invited_position}
												</span>
											)}
										</p>
									</div>
								</div>
								{canManage && (
									<button
										type="button"
										onClick={() =>
											cancelMutation.mutate(invite.id, {
												onSuccess: () =>
													toast.success("Invite cancelled"),
												onError: (err) =>
													toast.error((err as Error).message),
											})
										}
										disabled={cancelMutation.isPending}
										aria-label="Cancel invite"
										title="Cancel invite"
										className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
									>
										{cancelMutation.isPending ? (
											<Loader2 className="h-3.5 w-3.5 animate-spin" />
										) : (
											<X className="h-3.5 w-3.5" />
										)}
									</button>
								)}
							</li>
						);
					})}
				</ul>
			</AppSurfaceCard>
		</section>
	);
}

// ─── Attached team card ─────────────────────────────────────────────────────

function AttachedTeamCard({
	projectId,
	projectTeam,
	canManage,
	syncedRoleByUserId,
}: {
	projectId: string;
	projectTeam: ProjectTeam;
	canManage: boolean;
	syncedRoleByUserId: Map<string, string>;
}) {
	const [expanded, setExpanded] = useState(true);
	const [pickerOpen, setPickerOpen] = useState(false);
	const queryClient = useQueryClient();
	const toast = useToast();

	const teamQuery = useQuery({
		queryKey: ["teams", "detail", projectTeam.team_id],
		queryFn: () => getTeam(projectTeam.team_id),
	});
	const curatedQuery = useQuery({
		queryKey: [
			"project",
			projectId,
			"teams",
			projectTeam.team_id,
			"curated",
		],
		queryFn: () => listCuratedMembers(projectId, projectTeam.team_id),
	});

	const team = teamQuery.data;
	const curated = curatedQuery.data ?? [];

	const removeMutation = useMutation({
		mutationFn: (userId: string) =>
			removeCuratedMember(projectId, projectTeam.team_id, userId),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: [
					"project",
					projectId,
					"teams",
					projectTeam.team_id,
					"curated",
				],
			});
			void queryClient.invalidateQueries({
				queryKey: projectKeys.members(projectId),
			});
			toast.success("Member removed from project");
		},
		onError: (err) => toast.error((err as Error).message),
	});

	return (
		<div>
			<AppSurfaceCard className="overflow-hidden">
				<div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/60 px-5 py-3">
					<button
						type="button"
						onClick={() => setExpanded((v) => !v)}
						className="flex min-w-0 flex-1 items-center gap-2 text-left"
					>
						{expanded ? (
							<ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
						) : (
							<ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
						)}
						<TeamHeaderIcon team={team} />
						<span className="truncate text-sm font-semibold text-slate-900">
							{team?.name ?? "Loading…"}
						</span>
						{projectTeam.is_primary && (
							<span className="shrink-0 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
								Primary
							</span>
						)}
					</button>
					<div className="flex shrink-0 items-center gap-2">
						{canManage && (
							<button
								type="button"
								onClick={() => setPickerOpen(true)}
								className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
							>
								<Plus className="h-3.5 w-3.5" />
								Add from team
							</button>
						)}
						{team && (
							<Link
								to="/teams/$teamId"
								params={{ teamId: team.id }}
								className="text-xs font-medium text-slate-500 hover:text-slate-900"
							>
								Open team →
							</Link>
						)}
					</div>
				</div>

				{expanded &&
					(curatedQuery.isPending ? (
						<div className="flex items-center justify-center py-10 text-sm text-slate-500">
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							Loading…
						</div>
					) : curated.length === 0 ? (
						<div className="px-6 py-10 text-center text-sm text-slate-500">
							Nobody from this team is on the project yet.
							{canManage && " Add someone above."}
						</div>
					) : (
						<ul className="divide-y divide-slate-200">
							{curated.map((m) => (
								<CuratedMemberRow
									key={m.user_id}
									member={m}
									effectiveRole={
										syncedRoleByUserId.get(m.user_id) ?? "viewer"
									}
									canManage={canManage}
									isRemoving={
										removeMutation.isPending &&
										removeMutation.variables === m.user_id
									}
									onRemove={() => removeMutation.mutate(m.user_id)}
								/>
							))}
						</ul>
					))}
			</AppSurfaceCard>

			{pickerOpen && (
				<AddCuratedMemberModal
					projectId={projectId}
					teamId={projectTeam.team_id}
					teamName={team?.name ?? "team"}
					onClose={() => setPickerOpen(false)}
				/>
			)}
		</div>
	);
}

function CuratedMemberRow({
	member,
	effectiveRole,
	canManage,
	isRemoving,
	onRemove,
}: {
	member: ProjectTeamMember;
	/** Effective (yoked) role on the project. May be higher than the
	 * team's natural source if this user holds a stronger direct
	 * grant — e.g. a consultant curated via team still reads as OWNER. */
	effectiveRole: string;
	canManage: boolean;
	isRemoving: boolean;
	onRemove: () => void;
}) {
	return (
		<ProjectMemberRow
			user={member.user}
			fallbackId={member.user_id}
			// project_team_members carries role only; the team-side
			// position lives on team_members and isn't currently embedded
			// in this payload. Position editing happens on /teams/$teamId.
			position={null}
			role={effectiveRole}
			isRemoving={isRemoving}
			onRemove={canManage ? onRemove : undefined}
		/>
	);
}

function TeamHeaderIcon({
	team,
}: {
	team: { avatar_url?: string | null; name?: string } | undefined;
}) {
	if (team?.avatar_url) {
		return (
			<img
				src={team.avatar_url}
				alt={team.name ?? ""}
				className="h-6 w-6 shrink-0 rounded-md object-cover ring-1 ring-slate-200"
			/>
		);
	}
	return (
		<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-200 text-slate-600">
			<Users className="h-3.5 w-3.5" />
		</div>
	);
}

// ─── Add curated member from a team's roster ───────────────────────────────

function AddCuratedMemberModal({
	projectId,
	teamId,
	teamName,
	onClose,
}: {
	projectId: string;
	teamId: string;
	teamName: string;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const toast = useToast();

	const availableQuery = useQuery({
		queryKey: ["project", projectId, "teams", teamId, "available"],
		queryFn: () => listAvailableTeamMembers(projectId, teamId),
	});

	const addMutation = useMutation({
		mutationFn: (userId: string) =>
			addCuratedMember(projectId, teamId, { user_id: userId }),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["project", projectId, "teams", teamId, "curated"],
			});
			void queryClient.invalidateQueries({
				queryKey: ["project", projectId, "teams", teamId, "available"],
			});
			void queryClient.invalidateQueries({
				queryKey: projectKeys.members(projectId),
			});
			toast.success("Member added to project");
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const available = availableQuery.data ?? [];

	return (
		<ModalPortal>
			<div
				className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
				onClick={onClose}
			>
				<div
					className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl"
					onClick={(e) => e.stopPropagation()}
				>
					<div className="border-b border-slate-100 px-6 py-4">
						<h2 className="text-lg font-semibold text-slate-900">
							Add member from {teamName}
						</h2>
						<p className="mt-1 text-sm text-slate-600">
							Pick someone from this team to bring onto the project.
						</p>
					</div>
					<div className="max-h-[420px] overflow-y-auto">
						{availableQuery.isPending ? (
							<div className="flex items-center justify-center py-10 text-sm text-slate-500">
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Loading…
							</div>
						) : available.length === 0 ? (
							<div className="px-6 py-10 text-center text-sm text-slate-500">
								Everyone on this team is already on the project.
							</div>
						) : (
							<ul className="divide-y divide-slate-200">
								{available.map((m) => (
									<li
										key={m.user_id}
										className="flex items-center justify-between gap-3 px-5 py-3"
									>
										<MemberDisplay
											user={m.user}
											fallbackId={m.user_id}
											size="sm"
											subtitle={m.role}
										/>
										<button
											type="button"
											onClick={() => addMutation.mutate(m.user_id)}
											disabled={
												addMutation.isPending &&
												addMutation.variables === m.user_id
											}
											className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
										>
											{addMutation.isPending &&
											addMutation.variables === m.user_id ? (
												<Loader2 className="h-3.5 w-3.5 animate-spin" />
											) : (
												<Plus className="h-3.5 w-3.5" />
											)}
											Add
										</button>
									</li>
								))}
							</ul>
						)}
					</div>
					<div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3">
						<button
							type="button"
							onClick={onClose}
							className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
						>
							Done
						</button>
					</div>
				</div>
			</div>
		</ModalPortal>
	);
}

// ─── Direct shares ─────────────────────────────────────────────────────────

function DirectSharesCard({
	projectId,
	shares,
	canManage,
	alsoOnByUserId,
}: {
	projectId: string;
	shares: ProjectMember[];
	canManage: boolean;
	/** Map of user_id → list of team names where the same user *also*
	 * holds a team-derived share. Used to surface multi-origin grants
	 * inline so we don't double-list the user across cards. */
	alsoOnByUserId: Map<string, string[]>;
}) {
	const removeMutation = useProjectRemoveMemberMutation(projectId);
	const toast = useToast();

	return (
		<section>
			<h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
				Direct collaborators ({shares.length})
			</h3>
			<AppSurfaceCard className="overflow-hidden">
				<ul className="divide-y divide-slate-200">
					{shares.map((m) => (
						<ProjectMemberRow
							key={m.id}
							user={toProfileSummary(m.user)}
							fallbackId={m.user_id ?? undefined}
							position={m.position ?? null}
							role={m.role}
							originLabel={m.origin ? `Direct · ${m.origin}` : "Direct"}
							alsoOnLabels={
								m.user_id
									? alsoOnByUserId.get(m.user_id)
									: undefined
							}
							onRemove={
								canManage
									? () =>
											removeMutation.mutate(m.id, {
												onSuccess: () =>
													toast.success("Removed from project"),
												onError: (err) =>
													toast.error((err as Error).message),
											})
									: undefined
							}
							isRemoving={
								removeMutation.isPending &&
								removeMutation.variables === m.id
							}
						/>
					))}
				</ul>
			</AppSurfaceCard>
		</section>
	);
}
