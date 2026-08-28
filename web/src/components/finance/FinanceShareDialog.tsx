import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, MailPlus } from "lucide-react";
import { useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import {
	type FinanceBookMember,
	financeBooksService,
	type GrantableFinanceRole,
} from "@/services/financeBooks.service";

/**
 * The share dialog for one finance book — the Google-Docs-style surface for
 * "who can see this money, and as what".
 *
 * One place instead of two page sections: add someone by email with a role,
 * see everyone with access (including grants inherited from the team book,
 * which are managed there, not here), change or remove direct grants, and
 * cancel pending invites. Ownership is never grantable — it follows the book.
 *
 * The rule the whole surface exists to keep is stated at the bottom, where
 * every grant decision is made: finance access never opens the project
 * workspace.
 */

const ROLE_OPTIONS: Array<{
	value: GrantableFinanceRole;
	label: string;
	description: string;
}> = [
	{
		value: "manager",
		label: "Manager",
		description:
			"The HR tier — sees costs, manages rates and payouts, inherits onto project books.",
	},
	{
		value: "accountant",
		label: "Accountant",
		description: "Views and exports time logs and payouts. Never edits.",
	},
	{
		value: "viewer_client",
		label: "Client viewer",
		description:
			"The client seat — their contracts and invoices only. Never sees internal costs.",
	},
	{
		value: "viewer",
		label: "Viewer",
		description: "Read-only view of time logs. No exports.",
	},
];

const ROLE_LABELS: Record<string, string> = {
	owner: "Owner",
	manager: "Manager",
	accountant: "Accountant",
	viewer_client: "Client viewer",
	viewer: "Viewer",
};

export function FinanceShareDialog({
	bookId,
	bookTitle,
	canManage,
	open,
	onClose,
}: {
	bookId: string;
	bookTitle: string;
	/** Without manage_members the dialog is a read-only "who has access". */
	canManage: boolean;
	open: boolean;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<GrantableFinanceRole>("accountant");
	const [notice, setNotice] = useState<string | null>(null);

	const membersQuery = useQuery({
		queryKey: ["finance-books", bookId, "members"],
		queryFn: () => financeBooksService.listMembers(bookId),
		enabled: open,
	});
	const invitesQuery = useQuery({
		queryKey: ["finance-books", bookId, "invites"],
		queryFn: () => financeBooksService.listInvites(bookId),
		enabled: open && canManage,
	});

	const invalidate = () =>
		Promise.all([
			queryClient.invalidateQueries({
				queryKey: ["finance-books", bookId, "members"],
			}),
			queryClient.invalidateQueries({
				queryKey: ["finance-books", bookId, "invites"],
			}),
		]);

	const inviteMutation = useMutation({
		mutationFn: () =>
			financeBooksService.createInvite(bookId, { email, finance_role: role }),
		onSuccess: async (created) => {
			setEmail("");
			setNotice(
				created.email_delivery.sent
					? `Invitation emailed to ${created.email}.`
					: `Invitation created — the email could not be sent (${created.email_delivery.reason ?? "unknown reason"}). Copy the link from the pending row below.`,
			);
			await invalidate();
		},
	});
	const updateMutation = useMutation({
		mutationFn: ({
			memberId,
			finance_role,
		}: {
			memberId: string;
			finance_role: GrantableFinanceRole;
		}) => financeBooksService.updateMember(bookId, memberId, { finance_role }),
		onSuccess: invalidate,
	});
	const removeMutation = useMutation({
		mutationFn: (memberId: string) =>
			financeBooksService.removeMember(bookId, memberId),
		onSuccess: invalidate,
	});
	const cancelMutation = useMutation({
		mutationFn: (inviteId: string) =>
			financeBooksService.cancelInvite(bookId, inviteId),
		onSuccess: invalidate,
	});

	const mutationError =
		inviteMutation.error ??
		updateMutation.error ??
		removeMutation.error ??
		cancelMutation.error;
	const busy =
		inviteMutation.isPending ||
		updateMutation.isPending ||
		removeMutation.isPending ||
		cancelMutation.isPending;

	const selectedRole = ROLE_OPTIONS.find((option) => option.value === role);
	const pendingInvites = (invitesQuery.data ?? []).filter(
		(invite) => invite.status === "pending",
	);

	return (
		<AppDialog
			open={open}
			onClose={onClose}
			title={`Share "${bookTitle}"`}
			size="lg"
			busy={busy}
			footer={
				<div className="flex w-full items-center justify-between gap-4">
					<span className="flex items-center gap-2 text-xs text-muted-foreground">
						<Lock className="h-3.5 w-3.5" />
						Restricted — only people with access can open this book.
					</span>
					<button
						type="button"
						onClick={onClose}
						className="app-cta inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold text-white"
					>
						Done
					</button>
				</div>
			}
		>
			{canManage && (
				<>
					<div className="flex flex-col gap-2 sm:flex-row">
						<input
							type="email"
							value={email}
							onChange={(event) => setEmail(event.target.value)}
							placeholder="Add people by email"
							className="h-11 w-full rounded-xl border border-border bg-card px-4 text-sm text-foreground placeholder:text-muted-foreground"
						/>
						<select
							value={role}
							onChange={(event) =>
								setRole(event.target.value as GrantableFinanceRole)
							}
							className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground sm:w-40"
						>
							{ROLE_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
						<button
							type="button"
							disabled={!email.trim() || inviteMutation.isPending}
							onClick={() => {
								setNotice(null);
								inviteMutation.mutate();
							}}
							className="app-cta inline-flex h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-60"
						>
							<MailPlus className="h-4 w-4" />
							{inviteMutation.isPending ? "Sending…" : "Invite"}
						</button>
					</div>
					<p className="mt-2 text-xs leading-relaxed text-muted-foreground">
						{selectedRole ? (
							<>
								<span className="font-semibold text-foreground">
									{selectedRole.label}
								</span>{" "}
								— {selectedRole.description}
							</>
						) : null}
					</p>
					{notice && (
						<p className="mt-2 text-sm font-medium text-success-foreground">
							{notice}
						</p>
					)}
				</>
			)}

			<p className="mt-5 text-[11px] font-bold tracking-wider text-muted-foreground/70 uppercase">
				People with access
			</p>
			<div className="mt-1">
				{membersQuery.isPending ? (
					<p className="py-3 text-sm text-muted-foreground">Loading…</p>
				) : (
					(membersQuery.data ?? []).map((member) => (
						<ShareMemberRow
							key={member.id ?? `implicit-${member.user_id}`}
							member={member}
							canManage={canManage}
							onRoleChange={(finance_role) =>
								member.id
									? updateMutation.mutate({ memberId: member.id, finance_role })
									: undefined
							}
							onRemove={() =>
								member.id ? removeMutation.mutate(member.id) : undefined
							}
						/>
					))
				)}
			</div>

			{pendingInvites.length > 0 && (
				<>
					<p className="mt-5 text-[11px] font-bold tracking-wider text-muted-foreground/70 uppercase">
						Pending invites
					</p>
					<div className="mt-1">
						{pendingInvites.map((invite) => (
							<div
								key={invite.id}
								className="flex items-center justify-between gap-4 py-2.5"
							>
								<div className="flex min-w-0 items-center gap-3">
									<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/10 text-xs font-semibold text-warning-foreground">
										{invite.email.slice(0, 1).toUpperCase()}
									</span>
									<div className="min-w-0">
										<p className="truncate text-sm font-semibold text-foreground">
											{invite.email}
										</p>
										<p className="text-xs text-muted-foreground">
											{ROLE_LABELS[invite.finance_role] ?? invite.finance_role}{" "}
											· invited, not yet accepted
										</p>
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-2">
									<button
										type="button"
										disabled={cancelMutation.isPending}
										onClick={() => cancelMutation.mutate(invite.id)}
										className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive disabled:opacity-60"
									>
										Cancel
									</button>
								</div>
							</div>
						))}
					</div>
				</>
			)}

			{mutationError && (
				<p className="mt-3 text-sm font-medium text-destructive">
					{mutationError.message}
				</p>
			)}

			<p className="mt-5 border-t border-border pt-3 text-xs text-muted-foreground">
				Finance access never grants access to the project workspace — project
				entry stays with the project&apos;s own people settings.
			</p>
		</AppDialog>
	);
}

function ShareMemberRow({
	member,
	canManage,
	onRoleChange,
	onRemove,
}: {
	member: FinanceBookMember;
	canManage: boolean;
	onRoleChange: (role: GrantableFinanceRole) => void;
	onRemove: () => void;
}) {
	const name =
		member.user?.display_name ||
		member.user?.email ||
		member.invited_email ||
		"Unknown member";
	// Implicit owners and inherited F2 grants have no row on this book to
	// edit — role changes for inherited managers happen on the team book.
	const editable = canManage && !member.inherited && member.id !== null;

	return (
		<div className="flex items-center justify-between gap-4 py-2.5">
			<div className="flex min-w-0 items-center gap-3">
				{member.user?.avatar_url ? (
					<img
						src={member.user.avatar_url}
						alt=""
						className="h-8 w-8 shrink-0 rounded-full object-cover"
					/>
				) : (
					<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
						{name.slice(0, 1).toUpperCase()}
					</span>
				)}
				<div className="min-w-0">
					<p className="truncate text-sm font-semibold text-foreground">
						{name}
					</p>
					<p className="truncate text-xs text-muted-foreground">
						{member.source === "team_owner"
							? "Team owner"
							: member.inherited
								? "Inherited from the team book"
								: (member.user?.email ?? "Direct grant")}
					</p>
				</div>
			</div>
			{editable ? (
				<div className="flex shrink-0 items-center gap-2">
					<select
						value={member.finance_role}
						onChange={(event) =>
							onRoleChange(event.target.value as GrantableFinanceRole)
						}
						className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground"
					>
						{ROLE_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
					<button
						type="button"
						onClick={onRemove}
						className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
					>
						Remove
					</button>
				</div>
			) : (
				<span className="shrink-0 text-xs font-semibold text-muted-foreground">
					{ROLE_LABELS[member.finance_role] ?? member.finance_role}
				</span>
			)}
		</div>
	);
}
