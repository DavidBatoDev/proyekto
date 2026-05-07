import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
	ChevronDown,
	ChevronRight,
	Loader2,
	Plus,
	Unlink,
	UserMinus,
	Users,
} from "lucide-react";
import { ProjectSettingsLayout } from "@/components/project/ProjectSettingsLayout";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import { MemberDisplay } from "@/components/common/MemberDisplay";
import { ModalPortal } from "@/components/common/ModalPortal";
import { useToast } from "@/hooks/useToast";
import {
	useProjectMembersQuery,
	useProjectMyPermissionsQuery,
} from "@/hooks/useProjectQueries";
import {
	addCuratedMember,
	attachTeam,
	detachTeam,
	getTeam,
	listAvailableTeamMembers,
	listCuratedMembers,
	listMyTeams,
	listProjectTeams,
	listTeamMembers,
	removeCuratedMember,
	type ProjectTeam,
	type ProjectTeamDefaultRole,
	type ProjectTeamMember,
} from "@/services/teams.service";

export const Route = createFileRoute("/project/$projectId/settings/teams")({
	component: ProjectTeamsTab,
});

function ProjectTeamsTab() {
	const { projectId } = Route.useParams();
	const permissionsQuery = useProjectMyPermissionsQuery(projectId);
	const teamsQuery = useQuery({
		queryKey: ["project", projectId, "teams"],
		queryFn: () => listProjectTeams(projectId),
	});
	const [attachOpen, setAttachOpen] = useState(false);

	const canManageTeams = Boolean(permissionsQuery.data?.teams.manage);
	// teams.manage covers attach/detach. Curation gates separately on
	// members.manage; AttachedTeamRow handles its own member-level UI.
	const canManageMembers = Boolean(permissionsQuery.data?.members.manage);

	return (
		<ProjectSettingsLayout projectId={projectId}>
			<div className="flex items-end justify-between">
				<div>
					<p className="app-section-kicker">Teams</p>
					<h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
						Attached teams
					</h2>
					<p className="mt-1 max-w-2xl text-sm text-slate-600">
						Attach a team to bring its members into this project.
						Pick which members participate — others on the team
						won't see this project.
					</p>
				</div>
				{canManageTeams && (
					<button
						type="button"
						onClick={() => setAttachOpen(true)}
						className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
					>
						<Plus className="h-4 w-4" />
						Attach team
					</button>
				)}
			</div>

			<div className="mt-6 space-y-4">
				{teamsQuery.isLoading ? (
					<div className="flex items-center justify-center py-10 text-slate-500">
						<Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
					</div>
				) : teamsQuery.error ? (
					<AppSurfaceCard className="p-5 text-rose-700">
						{(teamsQuery.error as Error).message}
					</AppSurfaceCard>
				) : !teamsQuery.data || teamsQuery.data.length === 0 ? (
					<AppSurfaceCard className="border-dashed p-10 text-center">
						<div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600">
							<Users className="h-4 w-4" />
						</div>
						<p className="text-sm font-medium text-slate-900">
							No teams attached
						</p>
						<p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
							Attach a team to manage its members on this project.
						</p>
					</AppSurfaceCard>
				) : (
					teamsQuery.data.map((pt) => (
						<AttachedTeamRow
							key={pt.team_id}
							projectId={projectId}
							projectTeam={pt}
							canManageTeams={canManageTeams}
							canManageMembers={canManageMembers}
						/>
					))
				)}
			</div>

			{attachOpen && (
				<AttachTeamModal
					projectId={projectId}
					onClose={() => setAttachOpen(false)}
				/>
			)}
		</ProjectSettingsLayout>
	);
}

function AttachedTeamRow({
	projectId,
	projectTeam,
	canManageTeams,
	canManageMembers,
}: {
	projectId: string;
	projectTeam: ProjectTeam;
	/** teams.manage — gates Detach. */
	canManageTeams: boolean;
	/** members.manage — gates Add member + per-row Remove. */
	canManageMembers: boolean;
}) {
	const queryClient = useQueryClient();
	const toast = useToast();
	const [expanded, setExpanded] = useState(true);
	const [picker, setPicker] = useState(false);

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

	const detachMutation = useMutation({
		mutationFn: () => detachTeam(projectId, projectTeam.team_id),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["project", projectId, "teams"],
			});
			toast.success("Team detached");
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const team = teamQuery.data;
	const curated = curatedQuery.data ?? [];

	return (
		<AppSurfaceCard className="overflow-hidden">
			<div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/60 px-5 py-3">
				<button
					type="button"
					onClick={() => setExpanded((v) => !v)}
					className="flex items-center gap-2 text-left"
				>
					{expanded ? (
						<ChevronDown className="h-4 w-4 text-slate-500" />
					) : (
						<ChevronRight className="h-4 w-4 text-slate-500" />
					)}
					<Users className="h-4 w-4 text-slate-600" />
					<span className="text-sm font-semibold text-slate-900">
						{team?.name ?? projectTeam.team_id.slice(0, 8)}
					</span>
					{projectTeam.is_primary && (
						<span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
							Primary
						</span>
					)}
				</button>
				<div className="flex items-center gap-2">
					{canManageMembers && (
						<button
							type="button"
							onClick={() => setPicker(true)}
							className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
						>
							<Plus className="h-3.5 w-3.5" />
							Add member
						</button>
					)}
					{canManageTeams && (
					<button
						type="button"
						onClick={() => {
							if (
								confirm(
									`Detach "${team?.name ?? "this team"}" from this project? Curated members will lose access.`,
								)
							) {
								detachMutation.mutate();
							}
						}}
						disabled={detachMutation.isPending}
						className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
					>
						<Unlink className="h-3.5 w-3.5" />
						Detach
					</button>
					)}
				</div>
			</div>

			{expanded && (
				<div>
					{curatedQuery.isLoading ? (
						<div className="flex items-center justify-center py-6 text-sm text-slate-500">
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							Loading…
						</div>
					) : curated.length === 0 ? (
						<div className="px-5 py-6 text-center text-sm text-slate-500">
							No members from this team are on the project yet.
						</div>
					) : (
						<ul className="divide-y divide-slate-200">
							{curated.map((m) => (
								<CuratedMemberRow
									key={m.user_id}
									projectId={projectId}
									teamId={projectTeam.team_id}
									member={m}
									canManage={canManageMembers}
								/>
							))}
						</ul>
					)}
				</div>
			)}

			{picker && (
				<AddCuratedPicker
					projectId={projectId}
					teamId={projectTeam.team_id}
					onClose={() => setPicker(false)}
				/>
			)}
		</AppSurfaceCard>
	);
}

function CuratedMemberRow({
	projectId,
	teamId,
	member,
	canManage,
}: {
	projectId: string;
	teamId: string;
	member: ProjectTeamMember;
	canManage: boolean;
}) {
	const queryClient = useQueryClient();
	const toast = useToast();

	const removeMutation = useMutation({
		mutationFn: () => removeCuratedMember(projectId, teamId, member.user_id),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["project", projectId, "teams", teamId, "curated"],
			});
			toast.success("Removed from project");
		},
		onError: (err) => toast.error((err as Error).message),
	});

	return (
		<li className="flex items-center justify-between px-5 py-3">
			<MemberDisplay
				user={member.user}
				fallbackId={member.user_id}
			/>
			{canManage && (
				<button
					type="button"
					onClick={() => removeMutation.mutate()}
					disabled={removeMutation.isPending}
					className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
				>
					{removeMutation.isPending ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" />
					) : (
						<UserMinus className="h-3.5 w-3.5" />
					)}
					Remove
				</button>
			)}
		</li>
	);
}

const ROLE_OPTIONS: ProjectTeamDefaultRole[] = [
	"admin",
	"editor",
	"commenter",
	"viewer",
];

function AddCuratedPicker({
	projectId,
	teamId,
	onClose,
}: {
	projectId: string;
	teamId: string;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const toast = useToast();
	const availableQuery = useQuery({
		queryKey: ["project", projectId, "teams", teamId, "available"],
		queryFn: () => listAvailableTeamMembers(projectId, teamId),
	});
	// Existing collaborators on the project — used to grey out the role
	// picker for anyone whose role is already locked by an existing
	// project_access grant (the yoke means their team-derived row will
	// take their existing role, not the picked one).
	const projectMembersQuery = useProjectMembersQuery(projectId);
	const existingRoleByUserId = useMemo(() => {
		const map = new Map<string, ProjectTeamDefaultRole>();
		for (const m of projectMembersQuery.data ?? []) {
			if (!m.user_id) continue;
			if (map.has(m.user_id)) continue;
			map.set(m.user_id, m.role as ProjectTeamDefaultRole);
		}
		return map;
	}, [projectMembersQuery.data]);

	const [pickedRoleByUserId, setPickedRoleByUserId] = useState<
		Record<string, ProjectTeamDefaultRole>
	>({});

	const addMutation = useMutation({
		mutationFn: ({
			userId,
			role,
		}: {
			userId: string;
			role: ProjectTeamDefaultRole;
		}) => addCuratedMember(projectId, teamId, { user_id: userId, role }),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["project", projectId, "teams", teamId, "curated"],
			});
			void queryClient.invalidateQueries({
				queryKey: ["project", projectId, "teams", teamId, "available"],
			});
			void queryClient.invalidateQueries({
				queryKey: ["project", projectId, "members"],
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
				className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				<h2 className="text-lg font-semibold text-slate-900">
					Add team member
				</h2>
				<p className="mt-1 text-sm text-slate-600">
					Pick from the team members not yet on this project.
				</p>
				<div className="mt-5 max-h-80 overflow-y-auto rounded-lg border border-slate-200">
					{availableQuery.isLoading ? (
						<div className="flex items-center justify-center py-8 text-slate-500">
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							Loading…
						</div>
					) : available.length === 0 ? (
						<div className="px-4 py-8 text-center text-sm text-slate-500">
							All team members are already on this project.
						</div>
					) : (
						<ul className="divide-y divide-slate-200">
							{available.map((m) => {
								const existing = existingRoleByUserId.get(m.user_id);
								const lockedRole = existing ?? null;
								const role =
									lockedRole ??
									pickedRoleByUserId[m.user_id] ??
									"editor";
								return (
									<li
										key={m.user_id}
										className="flex items-center justify-between gap-3 px-4 py-3"
									>
										<MemberDisplay
											user={m.user}
											fallbackId={m.user_id}
											size="sm"
										/>
										<div className="flex shrink-0 items-center gap-2">
											<select
												value={role}
												disabled={Boolean(lockedRole)}
												onChange={(e) =>
													setPickedRoleByUserId((prev) => ({
														...prev,
														[m.user_id]: e.target
															.value as ProjectTeamDefaultRole,
													}))
												}
												className="rounded-lg border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100 disabled:text-slate-500"
											>
												{ROLE_OPTIONS.map((r) => (
													<option key={r} value={r}>
														{r}
													</option>
												))}
											</select>
											<button
												type="button"
												onClick={() =>
													addMutation.mutate({
														userId: m.user_id,
														role,
													})
												}
												disabled={addMutation.isPending}
												className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
											>
												{addMutation.isPending ? (
													<Loader2 className="h-3.5 w-3.5 animate-spin" />
												) : (
													<Plus className="h-3.5 w-3.5" />
												)}
												Add
											</button>
										</div>
									</li>
								);
							})}
						</ul>
					)}
				</div>
				<div className="mt-5 flex justify-end">
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

function AttachTeamModal({
	projectId,
	onClose,
}: {
	projectId: string;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const toast = useToast();
	const myTeamsQuery = useQuery({
		queryKey: ["teams", "mine"],
		queryFn: listMyTeams,
	});
	const attachedQuery = useQuery({
		queryKey: ["project", projectId, "teams"],
		queryFn: () => listProjectTeams(projectId),
	});
	// Direct collaborators on this project — yoked-role lookup. Anyone
	// already on the project keeps their existing role; the picker is
	// disabled for them and the attach payload still includes them so
	// the team-derived row gets registered.
	const projectMembersQuery = useProjectMembersQuery(projectId);
	const existingRoleByUserId = useMemo(() => {
		const map = new Map<string, ProjectTeamDefaultRole>();
		for (const m of projectMembersQuery.data ?? []) {
			if (!m.user_id) continue;
			if (map.has(m.user_id)) continue;
			map.set(m.user_id, m.role as ProjectTeamDefaultRole);
		}
		return map;
	}, [projectMembersQuery.data]);

	const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
	const [isPrimary, setIsPrimary] = useState(false);
	const [pickedMemberIds, setPickedMemberIds] = useState<Set<string>>(
		new Set(),
	);
	const [pickedRoleByUserId, setPickedRoleByUserId] = useState<
		Record<string, ProjectTeamDefaultRole>
	>({});
	const [bulkRole, setBulkRole] =
		useState<ProjectTeamDefaultRole>("editor");

	const membersQuery = useQuery({
		queryKey: ["teams", "members", selectedTeamId],
		queryFn: () =>
			selectedTeamId ? listTeamMembers(selectedTeamId) : Promise.resolve([]),
		enabled: !!selectedTeamId,
	});

	const attachedIds = useMemo(
		() => new Set((attachedQuery.data ?? []).map((p) => p.team_id)),
		[attachedQuery.data],
	);
	const candidateTeams = (myTeamsQuery.data ?? []).filter(
		(t) => !attachedIds.has(t.id),
	);

	const applyBulkRole = () => {
		const members = membersQuery.data ?? [];
		setPickedRoleByUserId((prev) => {
			const next = { ...prev };
			for (const m of members) {
				if (!pickedMemberIds.has(m.user_id)) continue;
				if (existingRoleByUserId.has(m.user_id)) continue;
				next[m.user_id] = bulkRole;
			}
			return next;
		});
	};

	const attachMutation = useMutation({
		mutationFn: () => {
			if (!selectedTeamId) throw new Error("Pick a team first");
			const teamMembers = membersQuery.data ?? [];
			const members = teamMembers
				.filter((m) => pickedMemberIds.has(m.user_id))
				.map((m) => ({
					user_id: m.user_id,
					role:
						existingRoleByUserId.get(m.user_id) ??
						pickedRoleByUserId[m.user_id] ??
						"editor",
				}));
			return attachTeam(projectId, {
				team_id: selectedTeamId,
				is_primary: isPrimary,
				members,
			});
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["project", projectId, "teams"],
			});
			void queryClient.invalidateQueries({
				queryKey: ["project", projectId, "members"],
			});
			toast.success("Team attached");
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
				className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				<h2 className="text-lg font-semibold text-slate-900">
					Attach team
				</h2>
				<p className="mt-1 text-sm text-slate-600">
					Bring a team's members into this project.
				</p>

				<div className="mt-5 space-y-4">
					<div>
						<label className="text-sm font-medium text-slate-700">
							Team
						</label>
						{myTeamsQuery.isLoading ? (
							<div className="mt-1 flex items-center text-sm text-slate-500">
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Loading…
							</div>
						) : candidateTeams.length === 0 ? (
							<p className="mt-1 text-sm text-slate-600">
								No teams available to attach.{" "}
								<Link
									to="/teams"
									className="font-medium text-slate-900 underline"
								>
									Create one →
								</Link>
							</p>
						) : (
							<select
								value={selectedTeamId ?? ""}
								onChange={(e) => {
									setSelectedTeamId(e.target.value || null);
									setPickedMemberIds(new Set());
								}}
								className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
							>
								<option value="">Select a team…</option>
								{candidateTeams.map((t) => (
									<option key={t.id} value={t.id}>
										{t.name}
									</option>
								))}
							</select>
						)}
					</div>

					<label className="inline-flex items-center gap-2 text-sm text-slate-700">
						<input
							type="checkbox"
							checked={isPrimary}
							onChange={(e) => setIsPrimary(e.target.checked)}
						/>
						Make primary team
					</label>

					{selectedTeamId && (
						<div>
							<div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
								<span className="text-xs font-medium text-slate-600">
									Set role for selected
								</span>
								<div className="flex items-center gap-2">
									<select
										value={bulkRole}
										onChange={(e) =>
											setBulkRole(
												e.target.value as ProjectTeamDefaultRole,
											)
										}
										className="rounded-md border border-slate-300 px-2 py-1 text-xs"
									>
										{ROLE_OPTIONS.map((r) => (
											<option key={r} value={r}>
												{r}
											</option>
										))}
									</select>
									<button
										type="button"
										onClick={applyBulkRole}
										disabled={pickedMemberIds.size === 0}
										className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
									>
										Apply
									</button>
								</div>
							</div>
							<div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-slate-200">
								{membersQuery.isLoading ? (
									<div className="flex items-center justify-center py-6 text-sm text-slate-500">
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										Loading…
									</div>
								) : (membersQuery.data ?? []).length === 0 ? (
									<div className="px-4 py-6 text-center text-sm text-slate-500">
										This team has no members.
									</div>
								) : (
									<ul className="divide-y divide-slate-200">
										{(membersQuery.data ?? []).map((m) => {
											const existing =
												existingRoleByUserId.get(m.user_id) ?? null;
											const role =
												existing ??
												pickedRoleByUserId[m.user_id] ??
												"editor";
											const checked = pickedMemberIds.has(m.user_id);
											return (
												<li
													key={m.user_id}
													className="flex items-center gap-3 px-4 py-2.5"
												>
													<input
														type="checkbox"
														checked={checked}
														onChange={(e) => {
															setPickedMemberIds((prev) => {
																const next = new Set(prev);
																if (e.target.checked) next.add(m.user_id);
																else next.delete(m.user_id);
																return next;
															});
														}}
													/>
													<div className="flex min-w-0 flex-1 items-center gap-2">
														<MemberDisplay
															user={m.user}
															fallbackId={m.user_id}
															size="sm"
														/>
														{existing && (
															<span
																title="This person already has a grant on this project. The team-derived row adopts their existing role; the picker is locked."
																className="inline-flex shrink-0 items-center rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600"
															>
																Keeps existing role
															</span>
														)}
													</div>
													<select
														value={role}
														disabled={Boolean(existing)}
														onChange={(e) =>
															setPickedRoleByUserId((prev) => ({
																...prev,
																[m.user_id]: e.target
																	.value as ProjectTeamDefaultRole,
															}))
														}
														className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100 disabled:text-slate-500"
													>
														{ROLE_OPTIONS.map((r) => (
															<option key={r} value={r}>
																{r}
															</option>
														))}
													</select>
												</li>
											);
										})}
									</ul>
								)}
							</div>
						</div>
					)}
				</div>

				<div className="mt-6 flex justify-end gap-2">
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={() => attachMutation.mutate()}
						disabled={!selectedTeamId || attachMutation.isPending}
						className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
					>
						{attachMutation.isPending && (
							<Loader2 className="h-4 w-4 animate-spin" />
						)}
						Attach
					</button>
				</div>
			</div>
		</div>
		</ModalPortal>
	);
}
