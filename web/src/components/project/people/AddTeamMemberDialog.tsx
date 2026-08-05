import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { Dropdown } from "@/components/common/Dropdown";
import {
	displayNameOf,
	MemberDisplay,
} from "@/components/common/MemberDisplay";
import { useConfirm } from "@/hooks/useConfirm";
import { useToast } from "@/hooks/useToast";
import { projectKeys } from "@/queries/project";
import {
	addCuratedMember,
	listAvailableTeamMembers,
	type ProjectTeamDefaultRole,
} from "@/services/teams.service";

const ROLE_OPTIONS: Array<{
	value: ProjectTeamDefaultRole;
	label: string;
}> = [
	{ value: "admin", label: "Admin — manage people and settings" },
	{ value: "editor", label: "Editor — change project content" },
	{ value: "commenter", label: "Commenter — comment, but not edit" },
	{ value: "viewer", label: "Viewer — read only" },
];

export function AddTeamMemberDialog({
	projectId,
	teamId,
	teamName,
	directInvitedUserIds,
	onClose,
}: {
	projectId: string;
	teamId: string;
	teamName: string;
	directInvitedUserIds: ReadonlySet<string>;
	onClose: () => void;
}) {
	const qc = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
	const [role, setRole] = useState<ProjectTeamDefaultRole>("editor");
	const membersQuery = useQuery({
		queryKey: ["project", projectId, "teams", teamId, "available-members"],
		queryFn: () => listAvailableTeamMembers(projectId, teamId),
	});

	const addMutation = useMutation({
		mutationFn: (moveDirectGrant: boolean) => {
			if (!selectedUserId) throw new Error("Pick a team member first");
			return addCuratedMember(projectId, teamId, {
				user_id: selectedUserId,
				role,
				move_direct_grant: moveDirectGrant || undefined,
			});
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["project", projectId, "teams"] });
			void qc.invalidateQueries({ queryKey: projectKeys.members(projectId) });
			toast.success("Member added to the project");
			onClose();
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const addSelectedMember = async () => {
		if (!selectedUserId) return;
		const member = membersQuery.data?.find(
			(candidate) => candidate.user_id === selectedUserId,
		);
		const isDirectInvite = directInvitedUserIds.has(selectedUserId);
		if (isDirectInvite) {
			const name = displayNameOf(member?.user, selectedUserId);
			const move = await confirm({
				title: "Move this member to the team?",
				message: `${name} is already a direct collaborator on this project. Move their access origin to ${teamName}? Their current role and permissions will stay the same.`,
				confirmLabel: "Move to team",
				cancelLabel: "Keep direct",
			});
			if (!move) return;
		}
		addMutation.mutate(isDirectInvite);
	};

	return (
		<AppDialog
			open
			onClose={onClose}
			title={`Add someone from ${teamName}`}
			description="Choose a team member to give access to this project."
			busy={addMutation.isPending}
			footer={
				<>
					<button
						type="button"
						onClick={onClose}
						disabled={addMutation.isPending}
						className="rounded-lg border border-input px-4 py-2 text-sm text-foreground transition hover:bg-muted disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={() => void addSelectedMember()}
						disabled={!selectedUserId || addMutation.isPending}
						className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
					>
						{addMutation.isPending && (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						)}
						Add member
					</button>
				</>
			}
		>
			<div className="space-y-5">
				<div>
					<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Team member
					</p>
					{membersQuery.isPending ? (
						<div className="flex justify-center py-6">
							<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
						</div>
					) : (membersQuery.data?.length ?? 0) === 0 ? (
						<p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
							Everyone on this team is already on the project.
						</p>
					) : (
						<div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
							{membersQuery.data?.map((member) => (
								<button
									key={member.user_id}
									type="button"
									onClick={() => setSelectedUserId(member.user_id)}
									className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition ${
										selectedUserId === member.user_id
											? "bg-primary/10"
											: "hover:bg-muted"
									}`}
								>
									<span
										aria-hidden="true"
										className={`h-3.5 w-3.5 shrink-0 rounded-full border ${
											selectedUserId === member.user_id
												? "border-primary bg-primary ring-2 ring-primary/25"
												: "border-input"
										}`}
									/>
									<MemberDisplay
										user={member.user}
										fallbackId={member.user_id}
										size="sm"
									/>
								</button>
							))}
						</div>
					)}
				</div>

				<div>
					<p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Project role
					</p>
					{selectedUserId && directInvitedUserIds.has(selectedUserId) ? (
						<p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
							Their existing project role will be kept when moved to this team.
						</p>
					) : (
						<Dropdown
							value={role}
							onChange={(value) => setRole(value as ProjectTeamDefaultRole)}
							options={ROLE_OPTIONS}
							disabled={addMutation.isPending}
							menuPlacement="top"
						/>
					)}
				</div>
			</div>
		</AppDialog>
	);
}
