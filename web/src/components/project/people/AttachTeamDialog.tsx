import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { Dropdown } from "@/components/common/Dropdown";
import { MemberDisplay } from "@/components/common/MemberDisplay";
import { TeamAvatar } from "@/components/team/TeamAvatar";
import { useProjectMembersQuery } from "@/hooks/useProjectQueries";
import { useToast } from "@/hooks/useToast";
import { projectKeys } from "@/queries/project";
import {
	attachTeam,
	listMyTeams,
	listProjectTeams,
	listTeamMembers,
	type ProfileSummary,
	type ProjectTeamDefaultRole,
} from "@/services/teams.service";

/**
 * Attach a team and pick who from it joins the project.
 *
 * Rewritten from `ProjectTeamsPanel`'s modal, which had three problems the
 * demo surfaced:
 *
 *  - it listed *everyone*, including you and the project owner, so you could
 *    "add" yourself to a project you already own;
 *  - it offered two competing role controls — a "Set role for selected" bulk
 *    picker that wrote once with no feedback, plus a per-row picker — and it
 *    was never clear which won;
 *  - "Make primary team" was a bare checkbox that silently stole primary from
 *    another team, with no hint that it drives contract billing and pay periods.
 */

// `commenter` is a valid ProjectTeamDefaultRole that the old picker omitted.
const ROLE_OPTIONS: Array<{
	value: ProjectTeamDefaultRole;
	label: string;
}> = [
	{ value: "admin", label: "Admin — manage people and settings" },
	{ value: "editor", label: "Editor — change project content" },
	{ value: "commenter", label: "Commenter — comment, but not edit" },
	{ value: "viewer", label: "Viewer — read only" },
];

export function AttachTeamDialog({
	projectId,
	currentUserId,
	onClose,
}: {
	projectId: string;
	currentUserId: string | null;
	onClose: () => void;
}) {
	const qc = useQueryClient();
	const toast = useToast();

	const myTeamsQuery = useQuery({
		queryKey: ["teams", "mine", currentUserId],
		queryFn: listMyTeams,
	});
	const attachedQuery = useQuery({
		queryKey: ["project", projectId, "teams"],
		queryFn: () => listProjectTeams(projectId),
	});
	const projectMembersQuery = useProjectMembersQuery(projectId);

	const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
	const [makePrimary, setMakePrimary] = useState(false);
	const [picked, setPicked] = useState<Set<string>>(new Set());
	const [defaultRole, setDefaultRole] =
		useState<ProjectTeamDefaultRole>("editor");
	/** Per-person overrides of `defaultRole`. Absent = follow the default. */
	const [roleOverrides, setRoleOverrides] = useState<
		Record<string, ProjectTeamDefaultRole>
	>({});

	const membersQuery = useQuery({
		queryKey: ["teams", "members", selectedTeamId],
		queryFn: () =>
			selectedTeamId ? listTeamMembers(selectedTeamId) : Promise.resolve([]),
		enabled: Boolean(selectedTeamId),
	});

	const attachedIds = useMemo(
		() => new Set((attachedQuery.data ?? []).map((p) => p.team_id)),
		[attachedQuery.data],
	);
	const candidateTeams = useMemo(
		() => (myTeamsQuery.data ?? []).filter((t) => !attachedIds.has(t.id)),
		[myTeamsQuery.data, attachedIds],
	);
	const hasAttachedTeams = attachedIds.size > 0;

	// Anyone already on the project keeps the role they have; the picker is
	// disabled for them but they still go in the payload so the team-derived
	// grant is registered.
	const existingRoleByUserId = useMemo(() => {
		const map = new Map<string, string>();
		for (const m of projectMembersQuery.data ?? []) {
			if (!m.user_id || map.has(m.user_id)) continue;
			map.set(m.user_id, m.role);
		}
		return map;
	}, [projectMembersQuery.data]);

	// TeamMember.user is nullable (a profile row can be missing); those rows
	// cannot be added meaningfully, so drop them rather than render a blank.
	const teamMembers = useMemo(
		() =>
			(membersQuery.data ?? []).filter(
				(m): m is typeof m & { user: NonNullable<typeof m.user> } =>
					Boolean(m.user?.id),
			),
		[membersQuery.data],
	);
	const roleFor = (userId: string): ProjectTeamDefaultRole =>
		roleOverrides[userId] ?? defaultRole;

	const attachMutation = useMutation({
		mutationFn: () => {
			if (!selectedTeamId) throw new Error("Pick a team first");
			const members = teamMembers
				.filter((m) => picked.has(m.user.id))
				.map((m) =>
					existingRoleByUserId.has(m.user.id)
						? { user_id: m.user.id }
						: { user_id: m.user.id, role: roleFor(m.user.id) },
				);
			return attachTeam(projectId, {
				team_id: selectedTeamId,
				is_primary: makePrimary || !hasAttachedTeams,
				members,
			});
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["project", projectId, "teams"] });
			void qc.invalidateQueries({ queryKey: projectKeys.members(projectId) });
			toast.success("Team attached");
			onClose();
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const selectedTeam = candidateTeams.find((t) => t.id === selectedTeamId);
	const currentPrimary = (attachedQuery.data ?? []).find((t) => t.is_primary);

	return (
		<AppDialog
			open
			onClose={onClose}
			size="lg"
			busy={attachMutation.isPending}
			title="Attach a team"
			description="Bring a team's people onto this project. Anyone you don't pick won't see it."
			footer={
				<>
					<button
						type="button"
						onClick={onClose}
						disabled={attachMutation.isPending}
						className="rounded-lg border border-input px-4 py-2 text-sm text-foreground transition hover:bg-muted disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={() => attachMutation.mutate()}
						disabled={!selectedTeamId || attachMutation.isPending}
						className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
					>
						{attachMutation.isPending && (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						)}
						Attach team
					</button>
				</>
			}
		>
			<div className="space-y-5">
				<div>
					<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Team
					</p>
					{myTeamsQuery.isPending ? (
						<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
					) : candidateTeams.length === 0 ? (
						<p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
							Every team you're on is already attached to this project.
						</p>
					) : (
						// Radio cards, not a <select>: there are rarely more than a
						// handful, and the logo makes them scannable at a glance.
						<div className="space-y-1.5">
							{candidateTeams.map((team) => (
								<button
									key={team.id}
									type="button"
									onClick={() => {
										setSelectedTeamId(team.id);
										setPicked(new Set());
										setRoleOverrides({});
									}}
									className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
										selectedTeamId === team.id
											? "border-primary bg-primary/5"
											: "border-border hover:bg-muted"
									}`}
								>
									<TeamAvatar team={team} size="sm" />
									<span className="truncate text-sm font-medium text-foreground">
										{team.name}
									</span>
								</button>
							))}
						</div>
					)}
				</div>

				{selectedTeamId && (
					<>
						<div>
							<p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								Default role for everyone you add
							</p>
							{/* One control, live-bound. The old bulk picker wrote once
							    into per-row state and then diverged from it silently. */}
							<Dropdown
								value={defaultRole}
								onChange={(v) => setDefaultRole(v as ProjectTeamDefaultRole)}
								options={ROLE_OPTIONS}
								disabled={attachMutation.isPending}
							/>
							<p className="mt-1 text-[11px] text-muted-foreground">
								You can change any individual below.
							</p>
						</div>

						<div>
							<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								Who joins the project
							</p>
							{membersQuery.isPending ? (
								<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
							) : (
								<MemberPicker
									members={teamMembers}
									picked={picked}
									setPicked={setPicked}
									currentUserId={currentUserId}
									existingRoleByUserId={existingRoleByUserId}
									roleFor={roleFor}
									setRoleOverrides={setRoleOverrides}
									disabled={attachMutation.isPending}
								/>
							)}
						</div>

						{hasAttachedTeams ? (
							<label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
								<input
									type="checkbox"
									checked={makePrimary}
									onChange={(e) => setMakePrimary(e.target.checked)}
									className="mt-0.5 h-3.5 w-3.5 accent-primary"
								/>
								<span className="text-xs text-foreground">
									Make{" "}
									<span className="font-semibold">
										{selectedTeam?.name ?? "this team"}
									</span>{" "}
									the primary team
									<span className="mt-0.5 block text-[11px] text-muted-foreground">
										The primary team's billing identity fills in contracts and
										its pay periods drive invoicing.
										{currentPrimary
											? " Whichever team is primary now will stop being so."
											: ""}
									</span>
								</span>
							</label>
						) : (
							<p className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground">
								This is the project's first team, so it becomes the primary one
								— its billing identity fills in contracts and its pay periods
								drive invoicing.
							</p>
						)}
					</>
				)}
			</div>
		</AppDialog>
	);
}

function MemberPicker({
	members,
	picked,
	setPicked,
	currentUserId,
	existingRoleByUserId,
	roleFor,
	setRoleOverrides,
	disabled,
}: {
	members: Array<{ user: ProfileSummary }>;
	picked: Set<string>;
	setPicked: (next: Set<string>) => void;
	currentUserId: string | null;
	existingRoleByUserId: Map<string, string>;
	roleFor: (userId: string) => ProjectTeamDefaultRole;
	setRoleOverrides: React.Dispatch<
		React.SetStateAction<Record<string, ProjectTeamDefaultRole>>
	>;
	disabled: boolean;
}) {
	if (members.length === 0) {
		return (
			<p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
				This team has no members yet.
			</p>
		);
	}

	const toggle = (userId: string) => {
		const next = new Set(picked);
		if (next.has(userId)) next.delete(userId);
		else next.add(userId);
		setPicked(next);
	};

	return (
		<div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
			{members.map((m) => {
				const userId = m.user.id;
				const isSelf = userId === currentUserId;
				const existingRole = existingRoleByUserId.get(userId);
				// Shown greyed rather than hidden: a name missing from the list
				// reads as a bug, not as "already handled".
				const alreadyOnProject = Boolean(existingRole);
				const locked = isSelf || alreadyOnProject;

				return (
					<div
						key={userId}
						className={`flex items-center gap-3 px-3 py-2.5 ${
							locked ? "opacity-60" : ""
						}`}
					>
						<input
							type="checkbox"
							checked={locked ? true : picked.has(userId)}
							disabled={locked || disabled}
							onChange={() => toggle(userId)}
							className="h-3.5 w-3.5 shrink-0 accent-primary"
						/>
						<div className="min-w-0 flex-1">
							<MemberDisplay user={m.user} fallbackId={userId} size="sm" />
						</div>
						{isSelf ? (
							<span className="shrink-0 text-[11px] text-muted-foreground">
								That's you
							</span>
						) : alreadyOnProject ? (
							<span className="shrink-0 text-[11px] text-muted-foreground">
								Already on this project · {existingRole}
							</span>
						) : (
							<div className="w-44 shrink-0">
								<Dropdown
									value={roleFor(userId)}
									onChange={(v) =>
										setRoleOverrides((prev) => ({
											...prev,
											[userId]: v as ProjectTeamDefaultRole,
										}))
									}
									options={ROLE_OPTIONS}
									disabled={disabled || !picked.has(userId)}
								/>
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
