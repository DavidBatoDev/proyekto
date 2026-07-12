import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
	Check,
	ChevronRight,
	Loader2,
	Lock,
	Mail,
	MoreHorizontal,
	Pencil,
	Plus,
	Trash2,
	Users,
	X,
} from "lucide-react";
import { AppSectionHeader, AppSurfaceCard } from "@/components/common/AppPrimitives";
import {
	PositionBadge,
	ProjectStatusBadge,
	RoleBadge,
} from "@/components/common/SemanticBadge";
import { TeamAvatar } from "@/components/team/TeamAvatar";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { ModalPortal } from "@/components/common/ModalPortal";
import { useToast } from "@/hooks/useToast";
import { useAuthStore, useUser } from "@/stores/authStore";
import {
	cancelTeamInvite,
	getTeam,
	inviteTeamMemberByEmail,
	listCuratedMembers,
	listTeamInvites,
	listTeamMembers,
	listTeamProjects,
	removeTeamMember,
	updateTeamMember,
	type ProjectTeamMember,
	type TeamInvite,
	type TeamMember,
	type TeamRole,
} from "@/services/teams.service";
import { PROJECT_STATUS_CONFIG } from "@/components/home/ProjectsGrid";
import { projectService } from "@/services/project.service";

/**
 * Blue chip for the free-form member position (e.g. "Backend Developer").
 * Mirrors the landing-page accent palette.
 */
function PositionChip({ children }: { children: ReactNode }) {
	return <PositionBadge>{children}</PositionBadge>;
}

/**
 * Slate chip for the access level (owner / admin / member). All three
 * use the same neutral fill so the row reads as a clean two-tone pair
 * with the blue position chip; the role text alone communicates the
 * tier.
 */
function RoleChip({ role }: { role: TeamRole }) {
	return <RoleBadge>{role}</RoleBadge>;
}

function CardActionMenu({
	projectId,
	teamId,
	canSetStatus,
	currentStatus,
}: {
	projectId: string;
	teamId: string;
	canSetStatus: boolean;
	currentStatus: string | null;
}) {
	const [open, setOpen] = useState(false);
	const [statusOpen, setStatusOpen] = useState(false);
	const wrapperRef = useRef<HTMLDivElement>(null);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const toast = useToast();

	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
				setOpen(false);
				setStatusOpen(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);

	const statusMutation = useMutation({
		mutationFn: (status: string) => projectService.update(projectId, {
			status: status as "draft" | "active" | "bidding" | "paused" | "completed" | "archived",
		}),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["teams", "projects", teamId] });
			toast.success("Status updated");
			setOpen(false);
			setStatusOpen(false);
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const statuses = Object.entries(PROJECT_STATUS_CONFIG);

	return (
		<div ref={wrapperRef} className="absolute right-2 top-2 z-20">
			<button
				type="button"
				aria-label="Card actions"
				onClick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					setOpen((v) => !v);
					setStatusOpen(false);
				}}
				className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
			>
				<MoreHorizontal className="h-4 w-4" />
			</button>

			{open && (
				<div
					className="absolute right-0 top-8 z-50 w-44 overflow-visible rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-xl"
					onClick={(e) => e.stopPropagation()}
				>
					{/* Go to Project */}
					<button
						type="button"
						className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-popover-foreground hover:bg-muted"
						onClick={(e) => {
							e.preventDefault();
							e.stopPropagation();
							void navigate({ to: "/project/$projectId/roadmap", params: { projectId } });
						}}
					>
						Go to Project
					</button>

					{/* Set Status */}
					{canSetStatus && (
						<div className="relative">
							<button
								type="button"
								className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-popover-foreground hover:bg-muted"
								onClick={(e) => {
									e.preventDefault();
									e.stopPropagation();
									setStatusOpen((v) => !v);
								}}
							>
								Set Status
								<ChevronRight className="h-3.5 w-3.5 text-slate-400" />
							</button>

							{statusOpen && (
								<div className="absolute left-full top-0 ml-1 w-40 rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-xl">
									{statuses.map(([key, cfg]) => (
										<button
											key={key}
											type="button"
											disabled={statusMutation.isPending}
											className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-popover-foreground hover:bg-muted disabled:opacity-50"
											onClick={(e) => {
												e.preventDefault();
												e.stopPropagation();
												statusMutation.mutate(key);
											}}
										>
											<span
												className="h-2 w-2 shrink-0 rounded-full"
												style={{ backgroundColor: cfg.color }}
											/>
											<span className="flex-1">{cfg.label}</span>
											{currentStatus?.toLowerCase() === key && (
												<Check className="h-3.5 w-3.5 text-muted-foreground" />
											)}
										</button>
									))}
								</div>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function MemberAvatar({ member, size = 6 }: { member: ProjectTeamMember; size?: number }) {
	const initial = (
		member.user?.display_name ||
		member.user?.first_name ||
		"?"
	)[0].toUpperCase();
	const sizeClass = `h-${size} w-${size}`;
	return member.user?.avatar_url ? (
		<img
			src={member.user.avatar_url}
			alt={member.user.display_name ?? ""}
			className={`${sizeClass} rounded-full object-cover`}
		/>
	) : (
		<span className={`flex ${sizeClass} items-center justify-center rounded-full bg-slate-400 text-[9px] font-bold text-white`}>
			{initial}
		</span>
	);
}

function CompactProjectCard({
	number,
	projectId,
	teamId,
	title,
	client,
	status,
	statusColor,
	progress,
	progressColor,
	bannerUrl = null,
	isLocked = false,
	canSetStatus = false,
	members = [],
}: {
	number: number;
	projectId: string;
	teamId: string;
	title: string;
	client: string;
	status: string;
	statusColor: string;
	progress: number | null;
	progressColor: string;
	bannerUrl?: string | null;
	isLocked?: boolean;
	canSetStatus?: boolean;
	members?: ProjectTeamMember[];
}) {
	const displayedMembers = members.slice(0, 9);
	const extraCount = Math.max(0, members.length - 9);

	const avatarStrip = displayedMembers.length > 0 ? (
		<div className="flex items-center justify-end">
				<div className="group/avatars relative">
				<div className="pointer-events-none absolute bottom-full right-0 z-50 mb-2 hidden w-max min-w-[180px] max-w-[260px] rounded-xl border border-border bg-popover py-2 text-popover-foreground shadow-xl group-hover/avatars:block">
					<p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
						Team members ({members.length})
					</p>
					<ul className="max-h-52 overflow-y-auto">
						{members.map((m) => (
							<li key={m.user_id} className="flex items-center gap-2 px-3 py-1">
								<div className="shrink-0 overflow-hidden rounded-full border border-border">
									<MemberAvatar member={m} size={5} />
								</div>
								<span className="truncate text-[11px] text-popover-foreground">
									{m.user?.display_name ||
										[m.user?.first_name, m.user?.last_name]
											.filter(Boolean)
											.join(" ") ||
										"Unknown"}
								</span>
							</li>
						))}
					</ul>
				</div>
				<div className="flex items-center">
					{displayedMembers.map((m, i) => (
						<div
							key={m.user_id}
							className="shrink-0 overflow-hidden rounded-full border-2 border-card"
							style={{ marginLeft: i === 0 ? 0 : -6, zIndex: displayedMembers.length - i }}
						>
							<MemberAvatar member={m} size={6} />
						</div>
					))}
					{extraCount > 0 && (
						<div
							className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full border-2 border-card bg-muted px-1 text-[9px] font-bold text-muted-foreground"
							style={{ marginLeft: -6, zIndex: 0 }}
						>
							+{extraCount}
						</div>
					)}
				</div>
			</div>
		</div>
	) : null;

	if (isLocked) {
		return (
			<div className="flex h-full cursor-not-allowed select-none flex-col rounded-xl border border-border bg-card text-card-foreground opacity-60 shadow-sm grayscale">
				{bannerUrl && (
					<div className="relative h-20 w-full shrink-0 overflow-hidden rounded-t-xl">
						<img src={bannerUrl} alt="" className="h-full w-full object-cover" />
						<div className="absolute inset-0 bg-linear-to-t from-black/40 to-transparent" />
					</div>
				)}
				<div className="flex flex-1 flex-col gap-2 p-3">
					<div className="flex items-center gap-2">
						<span className="text-[11px] font-semibold text-muted-foreground">#{number}</span>
						<div className="h-3 w-px bg-border" />
						<span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
							<Lock className="h-2.5 w-2.5" />
							No access
						</span>
					</div>
					<div className="min-w-0">
						<h4 className="truncate text-sm font-semibold text-card-foreground">{title}</h4>
						<p className="truncate text-[11px] text-muted-foreground">
							<span className="font-medium text-card-foreground/80">Client:</span> {client}
						</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<Link
			to="/project/$projectId/roadmap"
			params={{ projectId }}
			className="group relative flex h-full flex-col rounded-xl border border-border bg-card text-card-foreground shadow-sm transition-all hover:z-10 hover:-translate-y-0.5 hover:border-(--app-border-strong) hover:bg-muted hover:shadow-md"
			style={bannerUrl ? undefined : {
				backgroundImage: `linear-gradient(to bottom, var(--card) 88%, color-mix(in srgb, ${statusColor} 9%, var(--card)))`,
			}}
		>
			<CardActionMenu
				projectId={projectId}
				teamId={teamId}
				canSetStatus={canSetStatus}
				currentStatus={status}
			/>
			{bannerUrl && (
				<div className="relative h-20 w-full shrink-0 overflow-hidden rounded-t-xl">
					<img src={bannerUrl} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
					<div className="absolute inset-0 bg-linear-to-t from-black/65 via-black/30 to-black/10" />
					<div className="absolute bottom-2 left-3 flex items-center gap-1.5">
						<span className="text-[11px] font-semibold text-white/80">#{number}</span>
						<div className="h-3 w-px bg-white/40" />
						<ProjectStatusBadge status={status} />
					</div>
				</div>
			)}
			<div className="flex flex-1 flex-col gap-2 p-3">
				{!bannerUrl && (
					<div className="flex items-center gap-2">
						<span className="text-[11px] font-semibold text-muted-foreground">#{number}</span>
						<div className="h-3 w-px bg-border" />
						<ProjectStatusBadge status={status} />
					</div>
				)}
				<div className="min-w-0">
					<h4 className="truncate text-sm font-semibold text-card-foreground">{title}</h4>
					<p className="truncate text-[11px] text-muted-foreground">
						<span className="font-medium text-card-foreground/80">Client:</span> {client}
					</p>
				</div>
				<div className="mt-auto flex flex-col gap-2 pt-1">
					<div>
						<div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
							<span>Progress</span>
							<span>{progress === null ? "Not tracked" : `${progress}%`}</span>
						</div>
						<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
							<div
								className="h-full rounded-full transition-all"
								style={{ width: `${progress ?? 0}%`, backgroundColor: progressColor }}
							/>
						</div>
					</div>
					{avatarStrip}
				</div>
			</div>
		</Link>
	);
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
	const projectsQuery = useQuery({
		queryKey: ["teams", "projects", teamId],
		queryFn: () => listTeamProjects(teamId),
	});
	const attachedProjects = projectsQuery.data ?? [];

	const projectMemberQueries = useQueries({
		queries: attachedProjects.map((row) => ({
			queryKey: ["teams", "projects", "members", row.project_id, teamId],
			queryFn: () => listCuratedMembers(row.project_id, teamId),
			enabled: !!row.project && !!row.viewer_has_access,
			staleTime: 60_000,
		})),
	});
	const projectMembersMap = new Map(
		attachedProjects.map((row, i) => [
			row.project_id,
			projectMemberQueries[i]?.data ?? [],
		]),
	);

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
			<div className="w-full px-6 pb-6 pt-10">
				<div className="flex items-center gap-4">
					<TeamAvatar team={team} size="md" />
					<AppSectionHeader
						title={team.name}
						subtitle={team.description ?? undefined}
					/>
				</div>

				<div className="mt-8">
					<div className="mb-3 flex items-center justify-between">
						<h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
							Projects ({attachedProjects.length})
						</h3>
					</div>
					{projectsQuery.isLoading ? (
						<AppSurfaceCard className="flex items-center justify-center py-10 text-slate-500">
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							Loading projects…
						</AppSurfaceCard>
					) : attachedProjects.length === 0 ? (
						<AppSurfaceCard className="px-6 py-10 text-center text-sm text-slate-500">
							No projects attached to this team yet.
						</AppSurfaceCard>
					) : (
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{attachedProjects.map((row, index) => {
								if (!row.project) return null;
								const statusKey = (row.project.status || "").toLowerCase();
								const statusConfig = PROJECT_STATUS_CONFIG[statusKey] ?? {
									label: row.project.status || "Unknown",
									color: "#9c27b0",
								};
								return (
									<CompactProjectCard
										key={row.project.id}
										number={index + 1}
										projectId={row.project.id}
										teamId={teamId}
										title={row.project.title ?? "Untitled project"}
										client={row.project.client?.display_name || "Assigned"}
										status={statusConfig.label}
										statusColor={statusConfig.color}
										progress={
											row.project.status === "completed" ? 100 : null
										}
										progressColor={statusConfig.color}
										bannerUrl={row.project.banner_url}
										isLocked={!row.viewer_has_access}
										canSetStatus={
											!!user?.id &&
											(row.project.client_id === user.id ||
												row.project.consultant_id === user.id)
										}
										members={projectMembersMap.get(row.project.id)}
									/>
								);
							})}
						</div>
					)}
				</div>

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
							<table className="w-full">
								<thead>
									<tr className="border-b border-slate-200 bg-slate-50">
										<th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Member</th>
										<th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Position</th>
										<th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Role</th>
										<th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Joined</th>
										<th className="px-4 py-3" />
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100">
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
								</tbody>
							</table>
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
	const currentUser = useUser();
	const isOwnerRow = member.user_id === ownerId;
	const isSelfRow = currentUser?.id === member.user_id;
	const [editOpen, setEditOpen] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const displayName =
		member.user?.display_name?.trim() ||
		[member.user?.first_name, member.user?.last_name]
			.filter(Boolean)
			.join(" ")
			.trim() ||
		member.user?.email?.trim() ||
		"this member";

	const removeMutation = useMutation({
		mutationFn: () => removeTeamMember(teamId, member.user_id),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["teams", "members", teamId],
			})
			setConfirmOpen(false);
			toast.success("Member removed");
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const handleRemoveMember = () => {
		setConfirmOpen(true);
	};

	const joinedLabel = member.joined_at
		? new Date(member.joined_at).toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
				year: "numeric",
			})
		: "—";
	const avatarInitial = (
		member.user?.display_name ||
		member.user?.first_name ||
		"?"
	)[0].toUpperCase();

	return (
		<>
			<tr className="transition-colors hover:bg-slate-50/60">
				<td className="px-5 py-3">
					<div className="flex items-center gap-3">
						<div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-slate-200">
							{member.user?.avatar_url ? (
								<img
									src={member.user.avatar_url}
									alt=""
									className="h-full w-full object-cover"
								/>
							) : (
								<span className="flex h-full w-full items-center justify-center text-xs font-semibold text-slate-600">
									{avatarInitial}
								</span>
							)}
						</div>
						<div className="min-w-0">
							<p className="truncate text-sm font-medium text-slate-900">
								{displayName}
							</p>
							{member.user?.email && (
								<p className="truncate text-xs text-slate-400">
									{member.user.email}
								</p>
							)}
						</div>
					</div>
				</td>
				<td className="px-4 py-3">
					{member.position ? (
						<PositionChip>{member.position}</PositionChip>
					) : (
						<span className="text-slate-300">—</span>
					)}
				</td>
				<td className="px-4 py-3">
					<RoleChip role={member.role} />
				</td>
				<td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
					{joinedLabel}
				</td>
				<td className="px-4 py-3 text-right">
					<div className="flex items-center justify-end gap-1">
						{isOwnerView && (
							<button
								type="button"
								onClick={() => setEditOpen(true)}
								aria-label="Edit member"
								title="Edit member"
								className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
							>
								<Pencil className="h-3.5 w-3.5" />
							</button>
						)}
						{isOwnerView && !isOwnerRow && !isSelfRow && (
							<button
								type="button"
								onClick={handleRemoveMember}
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
				</td>
			</tr>
			{editOpen && (
				<EditMemberModal
					teamId={teamId}
					member={member}
					isOwnerRow={isOwnerRow}
					onClose={() => setEditOpen(false)}
				/>
			)}
			{confirmOpen && (
				<ModalPortal>
					<div
						className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/40 px-4"
						onClick={() => {
							if (removeMutation.isPending) return;
							setConfirmOpen(false);
						}}
					>
						<div
							className="w-full max-w-md overflow-hidden rounded-2xl border border-rose-200 bg-white shadow-2xl"
							onClick={(e) => e.stopPropagation()}
						>
							<div className="border-b border-rose-100 bg-rose-50 px-5 py-4">
								<h3 className="text-base font-semibold text-rose-800">
									Remove member
								</h3>
								<p className="mt-1 text-xs text-rose-700">
									This action cannot be undone.
								</p>
							</div>
							<div className="px-5 py-4 text-sm text-slate-600">
								Remove <span className="font-semibold text-slate-900">{displayName}</span> from this team?
							</div>
							<div className="flex items-center justify-end gap-2 border-t border-rose-100 bg-rose-50/40 px-5 py-4">
								<button
									type="button"
									onClick={() => setConfirmOpen(false)}
									disabled={removeMutation.isPending}
									className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={() => removeMutation.mutate()}
									disabled={removeMutation.isPending}
									className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
								>
									{removeMutation.isPending ? (
										<Loader2 className="h-3.5 w-3.5 animate-spin" />
									) : (
										<Trash2 className="h-3.5 w-3.5" />
									)}
									{removeMutation.isPending ? "Removing..." : "Remove"}
								</button>
							</div>
						</div>
					</div>
				</ModalPortal>
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

	const invitedLabel = new Date(invite.created_at).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});

	return (
		<tr className="bg-amber-50/30 transition-colors hover:bg-amber-50/60">
			<td className="px-5 py-3">
				<div className="flex items-center gap-3">
					<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
						<Mail className="h-4 w-4" />
					</div>
					<div className="min-w-0">
						<p className="truncate text-sm font-medium text-slate-900">
							{displayName || displayEmail}
						</p>
						{displayName && (
							<p className="truncate text-xs text-slate-400">{displayEmail}</p>
						)}
					</div>
				</div>
			</td>
			<td className="px-4 py-3">
				{invite.position ? (
					<PositionChip>{invite.position}</PositionChip>
				) : (
					<span className="text-slate-300">—</span>
				)}
			</td>
			<td className="px-4 py-3">
				<span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
					Pending · {invite.role}
				</span>
			</td>
			<td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
				Invited {invitedLabel}
			</td>
			<td className="px-4 py-3 text-right">
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
			</td>
		</tr>
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
								Project role label
							</span>
							<input
								type="text"
								value={position}
								onChange={(e) => setPosition(e.target.value)}
								maxLength={120}
								placeholder="e.g. Consultant, Developer, Client collaborator"
								className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
							/>
							<span className="mt-1 block text-[11px] text-slate-500">
								Optional label used for filtering and clarity across projects.
							</span>
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
