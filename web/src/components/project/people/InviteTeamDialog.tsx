import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MailWarning } from "lucide-react";
import { useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { Dropdown } from "@/components/common/Dropdown";
import { useToast } from "@/hooks/useToast";
import {
	inviteTeamToProject,
	listProjectTeams,
	type ProjectTeamDefaultRole,
} from "@/services/teams.service";

/**
 * Invite an outside team onto this project.
 *
 * The sibling of AttachTeamDialog, and the difference is the whole point:
 * Attach works on teams you are already on, so it can list them and act
 * immediately. This one is for a team you are NOT on — you cannot see it, so
 * you address a person instead, and they choose which of their teams to bring
 * and who from it joins. What you keep control of is what happens on YOUR
 * project: the role those people land on, and whether the team becomes
 * primary.
 */
const ROLE_OPTIONS: Array<{ value: ProjectTeamDefaultRole; label: string }> = [
	{ value: "admin", label: "Admin — manage people and settings" },
	{ value: "editor", label: "Editor — change project content" },
	{ value: "commenter", label: "Commenter — comment, but not edit" },
	{ value: "viewer", label: "Viewer — read only" },
];

export function InviteTeamDialog({
	projectId,
	onClose,
}: {
	projectId: string;
	onClose: () => void;
}) {
	const qc = useQueryClient();
	const toast = useToast();

	const [email, setEmail] = useState("");
	const [teamNameHint, setTeamNameHint] = useState("");
	const [memberRole, setMemberRole] =
		useState<ProjectTeamDefaultRole>("editor");
	const [makePrimary, setMakePrimary] = useState(false);
	const [message, setMessage] = useState("");

	const attachedQuery = useQuery({
		queryKey: ["project", projectId, "teams"],
		queryFn: () => listProjectTeams(projectId),
	});
	const hasAttachedTeams = (attachedQuery.data ?? []).length > 0;
	const currentPrimary = (attachedQuery.data ?? []).find((t) => t.is_primary);

	const trimmedEmail = email.trim();

	const inviteMutation = useMutation({
		mutationFn: () =>
			inviteTeamToProject(projectId, {
				email: trimmedEmail,
				team_name_hint: teamNameHint.trim() || undefined,
				member_role: memberRole,
				make_primary: makePrimary,
				message: message.trim() || undefined,
			}),
		onSuccess: (invite) => {
			void qc.invalidateQueries({
				queryKey: ["project", projectId, "team-invites"],
			});
			// A suppressed or failed send is NOT a failed invitation — the invite
			// is committed and waiting in-app. Saying "sent" regardless would let
			// the inviter assume an email landed when it never will.
			if (invite.email_delivery && !invite.email_delivery.sent) {
				toast.warning(
					`Invitation created, but the email wasn't sent: ${
						invite.email_delivery.reason ?? "unknown reason"
					}`,
				);
			} else {
				toast.success("Invitation sent");
			}
			onClose();
		},
		onError: (err) => toast.error((err as Error).message),
	});

	return (
		<AppDialog
			open
			onClose={onClose}
			size="lg"
			busy={inviteMutation.isPending}
			title="Invite a team"
			description="Ask someone to bring their team onto this project. They choose which team and who from it joins; you set the access those people get."
			footer={
				<>
					<button
						type="button"
						onClick={onClose}
						disabled={inviteMutation.isPending}
						className="rounded-lg border border-input px-4 py-2 text-sm text-foreground transition hover:bg-muted disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={() => inviteMutation.mutate()}
						disabled={!trimmedEmail || inviteMutation.isPending}
						className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
					>
						{inviteMutation.isPending && (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						)}
						Send invitation
					</button>
				</>
			}
		>
			<div className="space-y-5">
				<div>
					<label
						htmlFor="invite-team-email"
						className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
					>
						Who are you asking
					</label>
					<input
						id="invite-team-email"
						type="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						disabled={inviteMutation.isPending}
						placeholder="name@company.com"
						className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary disabled:opacity-50"
					/>
					<p className="mt-1 text-[11px] text-muted-foreground">
						They need to own or administer the team they bring. If they don't
						have a Proyekto account yet, the invitation waits for them when they
						sign up with this address.
					</p>
				</div>

				<div>
					<label
						htmlFor="invite-team-hint"
						className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
					>
						Which team you mean{" "}
						<span className="font-normal normal-case tracking-normal">
							(optional)
						</span>
					</label>
					<input
						id="invite-team-hint"
						type="text"
						value={teamNameHint}
						onChange={(e) => setTeamNameHint(e.target.value)}
						disabled={inviteMutation.isPending}
						placeholder="e.g. Dungog Digital"
						className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary disabled:opacity-50"
					/>
					<p className="mt-1 text-[11px] text-muted-foreground">
						Just a label so they know which team you had in mind — they pick the
						actual team when they accept.
					</p>
				</div>

				<div>
					<p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Access for the people they bring
					</p>
					<Dropdown
						value={memberRole}
						onChange={(v) => setMemberRole(v as ProjectTeamDefaultRole)}
						options={ROLE_OPTIONS}
						disabled={inviteMutation.isPending}
						menuPlacement="top"
					/>
					<p className="mt-1 text-[11px] text-muted-foreground">
						Applies to members who aren't on this project yet. Anyone already
						here keeps the role they have.
					</p>
				</div>

				{hasAttachedTeams ? (
					<label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
						<input
							type="checkbox"
							checked={makePrimary}
							onChange={(e) => setMakePrimary(e.target.checked)}
							disabled={inviteMutation.isPending}
							className="mt-0.5 h-3.5 w-3.5 accent-primary"
						/>
						<span className="text-xs text-foreground">
							Ask for this to become the primary team
							<span className="mt-0.5 block text-[11px] text-muted-foreground">
								The primary team's billing identity fills in contracts and its
								pay periods drive invoicing.
								{currentPrimary
									? " Whichever team is primary now will stop being so."
									: ""}
							</span>
						</span>
					</label>
				) : (
					<p className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground">
						This project has no team yet, so whichever team they bring becomes
						the primary one — its billing identity fills in contracts and its
						pay periods drive invoicing.
					</p>
				)}

				<div>
					<label
						htmlFor="invite-team-message"
						className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
					>
						Message{" "}
						<span className="font-normal normal-case tracking-normal">
							(optional)
						</span>
					</label>
					<textarea
						id="invite-team-message"
						value={message}
						onChange={(e) => setMessage(e.target.value)}
						disabled={inviteMutation.isPending}
						rows={3}
						maxLength={500}
						placeholder="A line about the work, so they know what they're saying yes to."
						className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary disabled:opacity-50"
					/>
				</div>

				<p className="flex items-start gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-[11px] text-muted-foreground">
					<MailWarning
						className="mt-0.5 h-3.5 w-3.5 shrink-0"
						aria-hidden="true"
					/>
					Nobody on their team gets access to this project until they accept.
				</p>
			</div>
		</AppDialog>
	);
}
