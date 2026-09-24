import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Mail, Plus, Share2, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
	AppPrimaryButton,
	AppSecondaryButton,
} from "@/components/common/AppButton";
import { AppDialog } from "@/components/common/AppDialog";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import { SelectField, TextField } from "@/components/common/FormFields";
import {
	FINANCE_ROLE_LABELS,
	FinanceShareDialog,
} from "@/components/finance/FinanceShareDialog";
import { InitialsTile } from "@/components/finance/InitialsTile";
import { useHubTeam } from "@/components/finance/nav/useManagedTeams";
import { TeamFinanceChrome } from "@/components/finance/team/TeamFinanceChrome";
import { useConfirm } from "@/hooks/useConfirm";
import { useToast } from "@/hooks/useToast";
import {
	type FinanceBookMember,
	financeBooksService,
	isInvitePending,
} from "@/services/financeBooks.service";
import {
	cancelTeamInvite,
	inviteTeamMemberByEmail,
	listTeamInvites,
	listTeamMembers,
	type ProfileSummary,
	type TeamInvite,
} from "@/services/teams.service";

/**
 * The people behind a team's money, in two clearly separate groups:
 *
 * - Team members — who is on the team (and who has been invited but not yet
 *   joined). Membership is what time, rates, and payouts are about.
 * - Finance access — who can see or run this team's finance (managers,
 *   accountants, client viewers). Finance access never opens the project
 *   workspace, and never makes someone a team member.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/team/$teamId/members",
)({
	component: TeamMembersPage,
});

function profileName(profile: ProfileSummary | null | undefined): string {
	if (!profile) return "Member";
	return (
		profile.display_name ||
		[profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
		profile.email ||
		"Member"
	);
}

function financeMemberName(member: FinanceBookMember): string {
	return (
		member.user?.display_name ??
		member.user?.email ??
		member.invited_email ??
		"Member"
	);
}

function TeamMembersPage() {
	const { teamId } = Route.useParams();
	const { team } = useHubTeam(teamId);
	const isAdmin =
		team?.my_team_role === "owner" || team?.my_team_role === "admin";

	return (
		<TeamFinanceChrome
			teamId={teamId}
			section="members"
			subtitle="Who is on the team, who is invited, and who can see its money."
		>
			<div className="grid gap-8 pb-8 lg:grid-cols-2">
				{team && team.my_team_role !== "guest" ? (
					<TeamMembersSection teamId={teamId} canInvite={isAdmin} />
				) : null}
				<FinanceAccessSection
					bookId={team?.book?.id}
					title={team?.team_name ?? "Team"}
					canManage={
						team?.book_role === "owner" || team?.book_role === "manager"
					}
				/>
			</div>
		</TeamFinanceChrome>
	);
}

function TeamMembersSection({
	teamId,
	canInvite,
}: {
	teamId: string;
	canInvite: boolean;
}) {
	const qc = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const [inviteOpen, setInviteOpen] = useState(false);

	const membersQuery = useQuery({
		queryKey: ["team", teamId, "members"],
		queryFn: () => listTeamMembers(teamId),
	});
	const invitesQuery = useQuery({
		queryKey: ["team", teamId, "invites"],
		queryFn: () => listTeamInvites(teamId),
		enabled: canInvite,
	});
	const pending = (invitesQuery.data ?? []).filter(
		(invite) => invite.status === "pending",
	);

	const cancelMutation = useMutation({
		mutationFn: (inviteId: string) => cancelTeamInvite(teamId, inviteId),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["team", teamId, "invites"] });
			toast.success("Invite cancelled");
		},
		onError: (error: Error) => toast.error(error.message),
	});

	return (
		<section>
			<SectionHeading
				title="Team members"
				hint="Who is on the team. Members log time, and are paid through rates and payouts."
			/>
			<AppSurfaceCard className="overflow-hidden">
				{membersQuery.isPending ? (
					<EmptyRow>Loading…</EmptyRow>
				) : (
					(membersQuery.data ?? []).map((member) => (
						<PersonRow
							key={member.id}
							name={profileName(member.user)}
							detail={member.position ?? member.user?.email ?? ""}
							badge={member.role}
						/>
					))
				)}

				{pending.length > 0 ? (
					<>
						<p className="border-t border-border/60 bg-muted/30 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
							Pending invites · {pending.length}
						</p>
						{pending.map((invite) => (
							<PendingInviteRow
								key={invite.id}
								invite={invite}
								onCancel={async () => {
									const ok = await confirm({
										title: "Cancel this invite?",
										message: `${invite.invitee_email ?? profileName(invite.invitee)} will no longer be able to join with it.`,
										confirmLabel: "Cancel invite",
										tone: "danger",
									});
									if (ok) cancelMutation.mutate(invite.id);
								}}
							/>
						))}
					</>
				) : null}

				{canInvite ? (
					<AddRow onClick={() => setInviteOpen(true)}>Invite to team</AddRow>
				) : null}
			</AppSurfaceCard>

			{inviteOpen ? (
				<InviteToTeamDialog
					teamId={teamId}
					onClose={() => setInviteOpen(false)}
				/>
			) : null}
		</section>
	);
}

function FinanceAccessSection({
	bookId,
	title,
	canManage,
}: {
	bookId: string | undefined;
	title: string;
	canManage: boolean;
}) {
	const [shareOpen, setShareOpen] = useState(false);
	const membersQuery = useQuery({
		queryKey: ["finance-books", "members", bookId],
		queryFn: () => financeBooksService.listMembers(bookId as string),
		enabled: Boolean(bookId),
	});
	const invitesQuery = useQuery({
		queryKey: ["finance-books", "invites", bookId],
		queryFn: () => financeBooksService.listInvites(bookId as string),
		enabled: Boolean(bookId) && canManage,
	});
	const pending = (invitesQuery.data ?? []).filter(isInvitePending);

	return (
		<section>
			<SectionHeading
				title="Finance access"
				hint="Accountants, managers, and client viewers. Finance access never opens the project workspace."
			/>
			<AppSurfaceCard className="overflow-hidden">
				{!bookId ? (
					<EmptyRow>
						Set up the team&apos;s finance (Overview) to share it with an
						accountant or manager.
					</EmptyRow>
				) : membersQuery.isPending ? (
					<EmptyRow>Loading…</EmptyRow>
				) : (
					(membersQuery.data ?? []).map((member) => (
						<PersonRow
							key={member.id ?? member.user_id ?? member.invited_email}
							name={financeMemberName(member)}
							detail={
								member.source === "team_owner"
									? "Team owner"
									: member.inherited
										? "Inherited access"
										: (member.user?.email ?? "Direct access")
							}
							badge={
								FINANCE_ROLE_LABELS[member.finance_role] ?? member.finance_role
							}
						/>
					))
				)}

				{pending.length > 0 ? (
					<>
						<p className="border-t border-border/60 bg-muted/30 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
							Pending finance invites · {pending.length}
						</p>
						{pending.map((invite) => (
							<PersonRow
								key={invite.id}
								name={invite.email}
								detail={`Invited ${new Date(invite.created_at).toLocaleDateString()} · expires ${new Date(invite.expires_at).toLocaleDateString()}`}
								badge={
									FINANCE_ROLE_LABELS[invite.finance_role] ??
									invite.finance_role
								}
								pending
							/>
						))}
					</>
				) : null}

				{bookId && canManage ? (
					<AddRow
						onClick={() => setShareOpen(true)}
						icon={<Share2 className="h-4 w-4" />}
					>
						Manage finance access
					</AddRow>
				) : null}
			</AppSurfaceCard>

			{bookId ? (
				<FinanceShareDialog
					bookId={bookId}
					bookTitle={`${title} · Team finance`}
					canManage={canManage}
					open={shareOpen}
					onClose={() => setShareOpen(false)}
				/>
			) : null}
		</section>
	);
}

function PersonRow({
	name,
	detail,
	badge,
	pending,
	action,
}: {
	name: string;
	detail: string;
	badge: string;
	pending?: boolean;
	action?: ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-4 border-b border-border/50 px-5 py-3.5 last:border-b-0">
			<span className="flex min-w-0 items-center gap-3">
				{pending ? (
					<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
						<Mail className="h-4 w-4" />
					</span>
				) : (
					<InitialsTile name={name} shape="round" size="md" />
				)}
				<span className="min-w-0">
					<span className="block truncate text-sm font-semibold text-foreground">
						{name}
					</span>
					<span className="block truncate text-xs text-muted-foreground">
						{detail}
					</span>
				</span>
			</span>
			<span className="flex shrink-0 items-center gap-2">
				<span
					className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${
						pending
							? "bg-warning/10 text-warning-foreground"
							: "bg-muted text-muted-foreground"
					}`}
				>
					{pending ? `${badge} · pending` : badge}
				</span>
				{action}
			</span>
		</div>
	);
}

function PendingInviteRow({
	invite,
	onCancel,
}: {
	invite: TeamInvite;
	onCancel: () => void;
}) {
	const who = invite.invitee_email ?? profileName(invite.invitee);
	const by = invite.invited_by_profile
		? ` by ${profileName(invite.invited_by_profile)}`
		: "";
	return (
		<PersonRow
			name={who}
			detail={`Invited ${new Date(invite.created_at).toLocaleDateString()}${by}`}
			badge={invite.role}
			pending
			action={
				<button
					type="button"
					onClick={onCancel}
					aria-label={`Cancel invite for ${who}`}
					className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
				>
					<X className="h-4 w-4" />
				</button>
			}
		/>
	);
}

function InviteToTeamDialog({
	teamId,
	onClose,
}: {
	teamId: string;
	onClose: () => void;
}) {
	const qc = useQueryClient();
	const toast = useToast();
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<"member" | "admin">("member");
	const [position, setPosition] = useState("");

	const inviteMutation = useMutation({
		mutationFn: () =>
			inviteTeamMemberByEmail(teamId, {
				email: email.trim(),
				role,
				position: position.trim() || undefined,
			}),
		onSuccess: (invite) => {
			void qc.invalidateQueries({ queryKey: ["team", teamId, "invites"] });
			// `sent: false` is not a failure — the invite exists; say so plainly.
			const sent = (invite as TeamInvite & { sent?: boolean }).sent;
			if (sent === false) {
				toast.success("Invite created — the email could not be sent");
			} else {
				toast.success(`Invite sent to ${email.trim()}`);
			}
			onClose();
		},
		onError: (error: Error) => toast.error(error.message),
	});

	return (
		<AppDialog
			open
			onClose={onClose}
			title="Invite to team"
			size="md"
			footer={
				<div className="flex w-full justify-end gap-2">
					<AppSecondaryButton onClick={onClose}>Cancel</AppSecondaryButton>
					<AppPrimaryButton
						onClick={() => inviteMutation.mutate()}
						disabled={!/.+@.+\..+/.test(email.trim())}
						loading={inviteMutation.isPending}
					>
						Send invite
					</AppPrimaryButton>
				</div>
			}
		>
			<div className="space-y-4">
				<TextField
					label="Email"
					type="email"
					value={email}
					onChange={setEmail}
					placeholder="name@company.com"
				/>
				<div className="grid gap-4 sm:grid-cols-2">
					<SelectField
						label="Role"
						value={role}
						onChange={(value) => setRole(value as "member" | "admin")}
						options={[
							{ value: "member", label: "Member" },
							{ value: "admin", label: "Admin" },
						]}
					/>
					<TextField
						label="Position"
						optional
						value={position}
						onChange={setPosition}
						placeholder="e.g. Designer"
					/>
				</div>
				<p className="text-xs text-muted-foreground">
					To give someone access to this team&apos;s money without joining the
					team, use Finance access instead.
				</p>
			</div>
		</AppDialog>
	);
}

function AddRow({
	onClick,
	children,
	icon,
}: {
	onClick: () => void;
	children: ReactNode;
	icon?: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex w-full items-center gap-3 border-t border-border/50 px-5 py-3.5 text-left text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
		>
			<span className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-border">
				{icon ?? <Plus className="h-4 w-4" />}
			</span>
			{children}
		</button>
	);
}

function SectionHeading({ title, hint }: { title: string; hint: string }) {
	return (
		<div className="mb-3">
			<h2 className="text-base font-semibold text-foreground">{title}</h2>
			<p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
		</div>
	);
}

function EmptyRow({ children }: { children: ReactNode }) {
	return <p className="px-5 py-4 text-sm text-muted-foreground">{children}</p>;
}
