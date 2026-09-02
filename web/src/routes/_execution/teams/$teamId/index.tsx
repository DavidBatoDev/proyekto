import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import {
	FolderKanban,
	Loader2,
	Lock,
	Mail,
	Pencil,
	Plus,
	Trash2,
	Users,
	X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import { AppTabs } from "@/components/common/AppTabs";
import { ModalPortal } from "@/components/common/ModalPortal";
import { RoleBadge } from "@/components/common/SemanticBadge";
import {
	PROJECT_STATUS_CONFIG,
	ProjectCard,
} from "@/components/home/ProjectsGrid";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { TeamOverviewTab } from "@/components/team/overview/TeamOverviewTab";
import { canEditTeam } from "@/components/team/teamPermissions";
import { invalidateMyTeams } from "@/hooks/dashboardInvalidation";
import { useToast } from "@/hooks/useToast";
import {
	cancelTeamInvite,
	getTeam,
	inviteTeamMemberByEmail,
	listTeamInvites,
	listTeamMembers,
	listTeamProjects,
	removeTeamMember,
	type TeamInvite,
	type TeamMember,
	type TeamRole,
	updateTeamMember,
} from "@/services/teams.service";
import { useAuthStore, useUser } from "@/stores/authStore";

/**
 * Slate chip for the access level (owner / admin / member). All three
 * use the same neutral fill so the row reads as a clean two-tone pair
 * with the blue position chip; the role text alone communicates the
 * tier.
 */
function RoleChip({ role }: { role: TeamRole }) {
	return <RoleBadge>{role}</RoleBadge>;
}

/**
 * A ghost of the real CompactProjectCard, drawn in flat theme tokens: banner
 * strip, title bar, status dot, avatar row. Three of them are fanned behind
 * the empty-state copy so the blank tab shows the shape of what will fill it
 * rather than a lone icon in a circle.
 */
function GhostProjectCard({ className }: { className?: string }) {
	return (
		<div
			aria-hidden
			className={`h-24 w-40 overflow-hidden rounded-xl border border-border bg-card shadow-sm ${className ?? ""}`}
		>
			<div className="h-1/5 w-full bg-primary/15" />
			<div className="flex h-4/5 flex-col justify-between p-2.5">
				<div className="space-y-1.5">
					<div className="h-2 w-3/4 rounded-full bg-muted-foreground/25" />
					<div className="h-1.5 w-1/2 rounded-full bg-muted-foreground/15" />
				</div>
				<div className="flex items-center justify-between">
					<span className="flex items-center gap-1">
						<span className="h-1.5 w-1.5 rounded-full bg-primary/50" />
						<span className="h-1.5 w-8 rounded-full bg-muted-foreground/15" />
					</span>
					<span className="flex items-center">
						{[0, 1, 2].map((i) => (
							<span
								key={i}
								className="h-4 w-4 rounded-full border-2 border-card bg-muted-foreground/20"
								style={{ marginLeft: i === 0 ? 0 : -5 }}
							/>
						))}
					</span>
				</div>
			</div>
		</div>
	);
}

/**
 * The Members tab before anyone has joined. Same grammar as the projects
 * ghost: a flat stand-in for the real table row (avatar, name and email bars,
 * position and role chips) so the shape of what is missing is legible.
 */
function GhostMemberRow({ className }: { className?: string }) {
	return (
		<div
			aria-hidden
			className={`flex w-72 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm ${className ?? ""}`}
		>
			<span className="h-8 w-8 shrink-0 rounded-full bg-muted-foreground/20" />
			<span className="flex-1 space-y-1.5">
				<span className="block h-2 w-2/3 rounded-full bg-muted-foreground/25" />
				<span className="block h-1.5 w-1/2 rounded-full bg-muted-foreground/15" />
			</span>
			<span className="h-4 w-12 shrink-0 rounded-full bg-primary/20" />
			<span className="h-4 w-9 shrink-0 rounded-full bg-muted-foreground/15" />
		</div>
	);
}

/**
 * Members is the one tab whose action lives on this page, so the owner gets
 * the real Invite button here; everyone else gets the explanation without a
 * button they cannot use.
 */
function TeamMembersEmptyState({
	teamName,
	canInvite,
	onInvite,
}: {
	teamName?: string | null;
	canInvite: boolean;
	onInvite: () => void;
}) {
	return (
		<div className="relative overflow-hidden rounded-2xl border border-dashed border-border bg-linear-to-b from-primary/5 to-card px-6 py-12 text-center">
			{/* Three rows stacked with a slight scale/offset falloff, so the strip
			    reads as a member list receding rather than three equal cards. */}
			<div className="mx-auto mb-7 flex w-72 flex-col items-center gap-2">
				<GhostMemberRow />
				<GhostMemberRow className="scale-95 opacity-60" />
				<GhostMemberRow className="scale-90 opacity-35" />
			</div>

			<h4 className="text-lg font-semibold text-foreground">No members yet</h4>
			<p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
				{canInvite
					? "Invite people by email. Give each one a position and an access level, and they carry both onto every project this team is attached to."
					: `${teamName?.trim() || "This team"} has no members yet. The team owner can invite people by email.`}
			</p>

			{canInvite && (
				<button
					type="button"
					onClick={onInvite}
					className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
				>
					<Plus className="h-4 w-4" />
					Invite member
				</button>
			)}
		</div>
	);
}

/**
 * The Projects tab before anything is attached. A team cannot attach a project
 * from here — attachment lives on the project's own Team page — so the copy
 * says where to go and the buttons take you there, rather than dangling an
 * action this page cannot perform.
 */
function TeamProjectsEmptyState({ teamName }: { teamName?: string | null }) {
	return (
		<div className="px-6 py-12 text-center">
			<div className="relative mx-auto mb-7 flex h-28 w-64 items-end justify-center">
				<GhostProjectCard className="absolute bottom-2 left-0 -rotate-6 opacity-45" />
				<GhostProjectCard className="absolute bottom-2 right-0 rotate-6 opacity-45" />
				<GhostProjectCard className="relative z-10 shadow-md" />
			</div>

			<h4 className="text-lg font-semibold text-foreground">No projects yet</h4>
			<p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
				Attach {teamName?.trim() || "this team"} to a project and it lands here
				— with its status, its owner, and the members working on it. Attaching
				happens on the project&rsquo;s own Team page.
			</p>

			<div className="mt-6 flex flex-wrap items-center justify-center gap-2">
				<Link
					to="/dashboard"
					className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
				>
					<FolderKanban className="h-4 w-4" />
					Browse projects
				</Link>
				<Link
					to="/project/new"
					search={{ roadmapId: undefined }}
					className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
				>
					<Plus className="h-4 w-4" />
					New project
				</Link>
			</div>
		</div>
	);
}

/**
 * A project this team is attached to that the viewer cannot open.
 *
 * Rendered instead of the real card rather than as a disabled version of it:
 * the full card advertises progress, a roadmap and a "view project" link, none
 * of which this viewer can act on, and the link would 403.
 */
function LockedProjectCard({ title }: { title: string }) {
	return (
		<div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 px-4 py-10 text-center">
			<Lock className="h-4 w-4 text-muted-foreground" />
			<p className="text-sm font-medium text-foreground">{title}</p>
			<p className="text-xs text-muted-foreground">
				You do not have access to this project
			</p>
		</div>
	);
}

const TEAM_TABS = ["overview", "projects", "members"] as const;
type TeamTab = (typeof TEAM_TABS)[number];

interface TeamDetailSearch {
	/** Optional so links elsewhere can point here without a tab, and so the
	 *  default tab (Projects) leaves the URL clean. */
	tab?: TeamTab;
}

export const Route = createFileRoute("/_execution/teams/$teamId/")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
	},
	// The tab lives in the URL so a deep link lands on the right one and the
	// back button steps through them. Unknown values fall back to Projects.
	validateSearch: (search: Record<string, unknown>): TeamDetailSearch => ({
		tab: TEAM_TABS.includes(search.tab as TeamTab)
			? (search.tab as TeamTab)
			: undefined,
	}),
	component: TeamDetailPage,
});

function TeamDetailPage() {
	const { teamId } = Route.useParams();
	const { tab: tabParam } = Route.useSearch();
	const tab: TeamTab = tabParam ?? "overview";
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
	// Alphabetical by title so the grid is scannable — the API returns
	// attachment order. Rows whose project failed to resolve carry no title,
	// so they sort last (they render as nothing anyway).
	const attachedProjects = useMemo(() => {
		return [...(projectsQuery.data ?? [])].sort((a, b) => {
			const titleA = a.project?.title?.trim() ?? "";
			const titleB = b.project?.title?.trim() ?? "";
			if (!titleA) return titleB ? 1 : 0;
			if (!titleB) return -1;
			return titleA.localeCompare(titleB, undefined, {
				sensitivity: "base",
				numeric: true,
			});
		});
	}, [projectsQuery.data]);

	const team = teamQuery.data;
	const members = membersQuery.data ?? [];
	const isOwner = team && user && team.owner_id === user.id;
	// Owner or team admin. Derived from the member list rather than
	// `team.viewer_role`, which is only reliably populated by listMyTeams.
	const canEdit = canEditTeam(team, membersQuery.data, user?.id);
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
	);
	const membersIsEmpty =
		!membersQuery.isLoading &&
		members.length === 0 &&
		pendingInvites.length === 0;

	if (teamQuery.isLoading) {
		return (
			<DashboardShell>
				<div className="flex h-64 items-center justify-center text-slate-500">
					<Loader2 className="mr-2 h-5 w-5 animate-spin" />
					Loading team…
				</div>
			</DashboardShell>
		);
	}
	if (teamQuery.error) {
		return (
			<DashboardShell>
				<AppSurfaceCard className="m-8 p-6 text-rose-700">
					{(teamQuery.error as Error).message}
				</AppSurfaceCard>
			</DashboardShell>
		);
	}
	if (!team) return null;

	return (
		<DashboardShell>
			<div className="w-full px-6 pb-6 pt-10">
				{/* Tabs and the tab's own action share one row: the action belongs
				    to whichever tab is open, so it reads as part of the switcher
				    rather than as a second, competing page header. The team's name
				    and avatar are not repeated here — they live on the Overview,
				    where they are also editable. */}
				<div className="flex flex-wrap items-center justify-between gap-3">
					<AppTabs
						items={[
							{ key: "overview", label: "Overview" },
							{
								key: "projects",
								label: "Projects",
								count: attachedProjects.length,
							},
							{
								key: "members",
								label: "Members",
								count: members.length + pendingInvites.length,
							},
						]}
						active={tab}
						linkFor={(key) => ({
							to: "/teams/$teamId",
							params: { teamId },
							// Overview is the default, so it clears the param rather than
							// stamping ?tab=overview onto every share of the page.
							search: { tab: key === "overview" ? undefined : key },
						})}
						variant="pill"
					/>

					{/* Hidden while the members empty state is up — that carries its
					    own Invite button, and two side by side reads as a bug. */}
					{tab === "members" && isOwner && !membersIsEmpty && (
						<button
							type="button"
							onClick={() => setInviteOpen(true)}
							className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
						>
							<Plus className="h-4 w-4" />
							Add a member
						</button>
					)}
				</div>

				{tab === "overview" && (
					<div className="mt-6">
						<TeamOverviewTab
							team={team}
							members={members}
							projectCount={attachedProjects.length}
							canEdit={canEdit}
						/>
					</div>
				)}

				{tab === "projects" && (
					<div className="mt-6">
						{projectsQuery.isLoading ? (
							<AppSurfaceCard className="flex items-center justify-center py-10 text-slate-500">
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Loading projects…
							</AppSurfaceCard>
						) : attachedProjects.length === 0 ? (
							<TeamProjectsEmptyState teamName={team.name} />
						) : (
							// The same card the dashboard uses, so a project reads
							// identically wherever it is listed.
							<div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
								{attachedProjects.map((row) => {
									if (!row.project) return null;
									const project = row.project;
									const statusKey = (project.status || "").toLowerCase();
									const statusConfig = PROJECT_STATUS_CONFIG[statusKey] ?? {
										label: project.status || "Unknown",
										color: "#9c27b0",
									};

									// A team can be attached to a project the viewer has no
									// access to. Showing the full card would offer a "view
									// project" link that 403s, so those stay a locked stub.
									if (!row.viewer_has_access) {
										return (
											<LockedProjectCard
												key={project.id}
												title={project.title ?? "Untitled project"}
											/>
										);
									}

									return (
										<ProjectCard
											key={project.id}
											projectId={project.id}
											status={statusConfig.label}
											title={project.title ?? "Untitled project"}
											owner={project.owner?.display_name || "Assigned"}
											progress={
												project.roadmap_summary
													? project.roadmap_summary.progress
													: project.status === "completed"
														? 100
														: null
											}
											progressColor={statusConfig.color}
											roadmapSummary={project.roadmap_summary ?? null}
											dueDate={null}
											// This team's curated members on the project — the one
											// thing that actually differs between two projects in
											// this list. Batched by the API, not fetched per card.
											members={project.curated_members ?? []}
										/>
									);
								})}
							</div>
						)}
					</div>
				)}

				{tab === "members" && (
					<div className="mt-6">
						{membersQuery.isLoading ? (
							<AppSurfaceCard className="flex items-center justify-center py-10 text-slate-500">
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Loading…
							</AppSurfaceCard>
						) : membersIsEmpty ? (
							<TeamMembersEmptyState
								teamName={team.name}
								canInvite={Boolean(isOwner)}
								onInvite={() => setInviteOpen(true)}
							/>
						) : (
							// Borderless on the page ground: no card, no header fill, no row
							// rules. The avatars and the role chips carry the structure, so
							// every line of chrome removed is one less thing competing.
							<div className="-mx-2 overflow-x-auto">
								<table className="w-full min-w-[640px] border-separate border-spacing-0">
									<thead>
										<tr>
											<th className="px-2 pb-3 text-left text-sm font-normal text-muted-foreground">
												Name
											</th>
											<th className="px-2 pb-3 text-left text-sm font-normal text-muted-foreground">
												Email
											</th>
											<th className="px-2 pb-3 text-left text-sm font-normal text-muted-foreground">
												Role
											</th>
											<th className="px-2 pb-3 text-left text-sm font-normal text-muted-foreground">
												Joined
											</th>
											<th className="px-2 pb-3" />
										</tr>
									</thead>
									<tbody>
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
							</div>
						)}
					</div>
				)}
			</div>

			{inviteOpen && (
				<InviteMemberModal
					teamId={teamId}
					onClose={() => setInviteOpen(false)}
				/>
			)}
		</DashboardShell>
	);
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
			});
			// The dashboard TEAMS card shows member count + avatar previews.
			void invalidateMyTeams(queryClient);
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
	const avatarInitial = (member.user?.display_name ||
		member.user?.first_name ||
		"?")[0].toUpperCase();

	return (
		<>
			<tr className="group transition-colors hover:bg-muted/40">
				<td className="rounded-l-lg px-2 py-2.5">
					<div className="flex items-center gap-3">
						<div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-muted">
							{member.user?.avatar_url ? (
								<img
									src={member.user.avatar_url}
									alt=""
									className="h-full w-full object-cover"
								/>
							) : (
								<span className="flex h-full w-full items-center justify-center text-xs font-semibold text-muted-foreground">
									{avatarInitial}
								</span>
							)}
						</div>
						{/* The position rides under the name as plain text rather than in
						    its own chip column — it identifies the person, the way a
						    handle does, and the row is calmer for it. */}
						<div className="min-w-0">
							<p className="truncate text-sm font-medium text-foreground">
								{displayName}
							</p>
							{member.position && (
								<p className="truncate text-xs text-muted-foreground">
									{member.position}
								</p>
							)}
						</div>
					</div>
				</td>
				<td className="px-2 py-2.5 text-sm text-muted-foreground">
					<span className="block max-w-[260px] truncate">
						{member.user?.email || "—"}
					</span>
				</td>
				<td className="px-2 py-2.5">
					<RoleChip role={member.role} />
				</td>
				<td className="px-2 py-2.5 text-sm whitespace-nowrap text-muted-foreground">
					{joinedLabel}
				</td>
				<td className="rounded-r-lg px-2 py-2.5 text-right">
					{/* Row actions stay out of the way until the row is hovered or
					    focused, which is what keeps the list reading as a list. */}
					<div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
						{isOwnerView && (
							<button
								type="button"
								onClick={() => setEditOpen(true)}
								aria-label="Edit member"
								title="Edit member"
								className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
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
								className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
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
								Remove{" "}
								<span className="font-semibold text-slate-900">
									{displayName}
								</span>{" "}
								from this team?
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
	);
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
	);

	const mutation = useMutation({
		mutationFn: () => {
			// Owner row's role is non-editable on the backend; only send
			// position to avoid an unnecessary 403 on the role check.
			const patch: { position: string; role?: "admin" | "member" } = {
				position: position.trim(),
			};
			if (!isOwnerRow) patch.role = role;
			return updateTeamMember(teamId, member.user_id, patch);
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["teams", "members", teamId],
			});
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
	);
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
			});
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
		null;

	const invitedLabel = new Date(invite.created_at).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});

	return (
		<tr className="group transition-colors hover:bg-muted/40">
			<td className="rounded-l-lg px-2 py-2.5">
				<div className="flex items-center gap-3">
					<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
						<Mail className="h-4 w-4" />
					</div>
					<div className="min-w-0">
						<p className="truncate text-sm font-medium text-foreground">
							{displayName || displayEmail}
						</p>
						{invite.position && (
							<p className="truncate text-xs text-muted-foreground">
								{invite.position}
							</p>
						)}
					</div>
				</div>
			</td>
			<td className="px-2 py-2.5 text-sm text-muted-foreground">
				<span className="block max-w-[260px] truncate">{displayEmail}</span>
			</td>
			<td className="px-2 py-2.5">
				<span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
					Pending · {invite.role}
				</span>
			</td>
			<td className="px-2 py-2.5 text-sm whitespace-nowrap text-muted-foreground">
				Invited {invitedLabel}
			</td>
			<td className="rounded-r-lg px-2 py-2.5 text-right">
				{isOwnerView && (
					<button
						type="button"
						onClick={() => cancelMutation.mutate()}
						disabled={cancelMutation.isPending}
						className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
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
	);
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
		onSuccess: (createdInvite) => {
			void queryClient.invalidateQueries({
				queryKey: ["teams", "invites", teamId],
			});
			// The invite exists either way; only the email can fail. Saying
			// "Invite sent" when it was suppressed would leave the inviter waiting
			// on a reply that is never coming.
			if (createdInvite.email_delivery?.sent === false) {
				const reason = createdInvite.email_delivery.reason?.trim();
				toast.warning(
					reason && reason.length > 0
						? `Invite created, but email was not delivered: ${reason}`
						: "Invite created, but email was not delivered. Please share the invite link manually.",
				);
			} else {
				toast.success(`Invite sent to ${email.trim()}`);
			}
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
	);
}
