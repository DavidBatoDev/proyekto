import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus, Star, Unlink } from "lucide-react";
import { useState } from "react";
import { TeamAvatar } from "@/components/team/TeamAvatar";
import { useConfirm } from "@/hooks/useConfirm";
import { useToast } from "@/hooks/useToast";
import { projectKeys } from "@/queries/project";
import { updateProjectTeam } from "@/services/teams.service";
import { DetachTeamDialog } from "./DetachTeamDialog";
import { PersonRow } from "./PersonRow";
import type { PeopleTeamGroup, PersonAccess } from "./useProjectPeople";

/**
 * A team, collapsed into the roster rather than living on its own tab.
 *
 * Merges the two near-identical attached-team implementations that existed —
 * `TeamPage`'s (which rendered the team logo, and was dead code) and
 * `ProjectTeamsPanel`'s (which could actually detach and set primary). This
 * keeps the capabilities of the second and the logo of the first.
 */
export function TeamGroupCard({
	projectId,
	group,
	allPeople,
	curatedTeamIdsByUserId,
	teamNameById,
	canManageTeams,
	canManageMembers,
	defaultOpen,
	onOpenPerson,
	onAddMember,
}: {
	projectId: string;
	group: PeopleTeamGroup;
	/** The whole project roster — the detach dialog predicts outcomes from it. */
	allPeople: PersonAccess[];
	curatedTeamIdsByUserId: Map<string, Set<string>>;
	teamNameById: Record<string, string>;
	canManageTeams: boolean;
	canManageMembers: boolean;
	defaultOpen: boolean;
	onOpenPerson: (person: PersonAccess) => void;
	onAddMember: (teamId: string) => void;
}) {
	const qc = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const [open, setOpen] = useState(defaultOpen);
	const [detachOpen, setDetachOpen] = useState(false);

	const teamName = group.team?.name ?? "Team";
	const invalidate = () => {
		void qc.invalidateQueries({ queryKey: ["project", projectId, "teams"] });
		void qc.invalidateQueries({ queryKey: projectKeys.members(projectId) });
	};

	// First caller of updateProjectTeam anywhere in the app: the primary team
	// could previously only be chosen at attach time and never changed after.
	const primaryMutation = useMutation({
		mutationFn: () =>
			updateProjectTeam(projectId, group.attachment.team_id, {
				is_primary: true,
			}),
		onSuccess: () => {
			toast.success(`${teamName} is now the primary team`);
			invalidate();
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const askMakePrimary = async () => {
		const ok = await confirm({
			title: `Make ${teamName} the primary team?`,
			message:
				"The primary team's billing identity fills in new contracts, and its pay periods drive invoicing. Whichever team is primary now will stop being so.",
			confirmLabel: "Make primary",
		});
		if (ok) primaryMutation.mutate();
	};

	const busy = primaryMutation.isPending;

	return (
		<section className="overflow-hidden rounded-2xl border border-border bg-card">
			<div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2.5">
				<button
					type="button"
					onClick={() => setOpen((v) => !v)}
					className="flex min-w-0 flex-1 items-center gap-2 text-left"
				>
					{open ? (
						<ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
					) : (
						<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
					)}
					<TeamAvatar
						team={{
							name: teamName,
							avatar_url: group.team?.avatar_url ?? null,
						}}
						size="sm"
					/>
					<span className="truncate text-sm font-semibold text-foreground">
						{teamName}
					</span>
					{group.attachment.is_primary && (
						<span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
							Primary
						</span>
					)}
					<span className="shrink-0 text-xs text-muted-foreground">
						{group.people.length}
					</span>
				</button>

				<div className="flex shrink-0 items-center gap-1">
					{canManageMembers && (
						<button
							type="button"
							onClick={() => onAddMember(group.attachment.team_id)}
							className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted"
						>
							<Plus className="h-3.5 w-3.5" />
							Add
						</button>
					)}
					{canManageTeams && !group.attachment.is_primary && (
						<button
							type="button"
							onClick={() => void askMakePrimary()}
							disabled={busy}
							title="Use this team's billing identity and pay periods"
							className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
						>
							<Star className="h-3.5 w-3.5" />
							Make primary
						</button>
					)}
					{canManageTeams && (
						<button
							type="button"
							onClick={() => setDetachOpen(true)}
							disabled={busy}
							className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
						>
							<Unlink className="h-3.5 w-3.5" />
							Detach
						</button>
					)}
				</div>
			</div>

			{detachOpen && (
				<DetachTeamDialog
					projectId={projectId}
					attachment={group.attachment}
					team={group.team}
					people={allPeople}
					curatedTeamIdsByUserId={curatedTeamIdsByUserId}
					teamNameById={teamNameById}
					onClose={() => setDetachOpen(false)}
				/>
			)}

			{open &&
				(group.people.length === 0 ? (
					<p className="px-4 py-5 text-center text-xs text-muted-foreground">
						Nobody from {teamName} is on this project yet.
					</p>
				) : (
					<div className="divide-y divide-border">
						{group.people.map((person) => (
							<PersonRow
								key={person.key}
								person={person}
								badgeTeam={group.team}
								onOpen={onOpenPerson}
							/>
						))}
					</div>
				))}
		</section>
	);
}
