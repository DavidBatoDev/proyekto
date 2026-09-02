import { Loader2, MailWarning, Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { useToast } from "@/hooks/useToast";
import { useWorkspaceInviteMutation } from "@/hooks/useWorkspaceQueries";
import type { WorkspaceAssignableRole } from "@/services/workspaces.service";

/**
 * Invite people into a workspace — the organization tier, not a project.
 *
 * Each row is its own invitation, so a batch can partially succeed: rows that
 * went through disappear, rows that failed stay with their error attached. A
 * suppressed email is a warning, never a failure — the invitation is committed
 * and waiting in-app either way.
 */

interface InviteRow {
	key: number;
	email: string;
	role: WorkspaceAssignableRole;
	error?: string;
}

export function WorkspaceInviteDialog({
	workspaceId,
	open,
	onClose,
}: {
	workspaceId: string;
	open: boolean;
	onClose: () => void;
}) {
	// Remount per open so a reopened dialog starts from a clean slate.
	if (!open) return null;
	return (
		<WorkspaceInviteDialogInner workspaceId={workspaceId} onClose={onClose} />
	);
}

function WorkspaceInviteDialogInner({
	workspaceId,
	onClose,
}: {
	workspaceId: string;
	onClose: () => void;
}) {
	const toast = useToast();
	const inviteMutation = useWorkspaceInviteMutation(workspaceId);

	const nextKey = useRef(1);
	const [rows, setRows] = useState<InviteRow[]>([
		{ key: 0, email: "", role: "member" },
	]);
	// The mutation's isPending only covers the latest row; this covers the batch.
	const [submitting, setSubmitting] = useState(false);

	const filledRows = rows.filter((row) => row.email.trim().length > 0);

	const updateRow = (key: number, patch: Partial<InviteRow>) => {
		setRows((prev) =>
			prev.map((row) => (row.key === key ? { ...row, ...patch } : row)),
		);
	};

	const addRow = () => {
		setRows((prev) => [
			...prev,
			{ key: nextKey.current++, email: "", role: "member" },
		]);
	};

	const removeRow = (key: number) => {
		setRows((prev) => prev.filter((row) => row.key !== key));
	};

	const submit = async () => {
		if (filledRows.length === 0 || submitting) return;
		setSubmitting(true);

		const failed: InviteRow[] = [];
		const unsentEmails: string[] = [];
		let sentCount = 0;

		// Sequential on purpose: each row lands or fails on its own, and the
		// order of any per-email errors matches the order on screen.
		for (const row of filledRows) {
			try {
				const invite = await inviteMutation.mutateAsync({
					email: row.email.trim(),
					role: row.role,
				});
				sentCount += 1;
				if (invite.email_delivery && !invite.email_delivery.sent) {
					unsentEmails.push(row.email.trim());
				}
			} catch (err) {
				failed.push({ ...row, error: (err as Error).message });
			}
		}

		setSubmitting(false);

		if (unsentEmails.length > 0) {
			// Suppressed email ≠ failed invitation: it is committed and waiting
			// in-app, so this is a warning, not an error.
			toast.warning(
				`Invitation${unsentEmails.length === 1 ? "" : "s"} created for ${unsentEmails.join(
					", ",
				)}, but the email couldn't be sent — they'll find it waiting in Proyekto.`,
			);
		}

		if (failed.length === 0) {
			if (unsentEmails.length === 0) {
				toast.success(
					sentCount === 1 ? "Invitation sent" : `${sentCount} invitations sent`,
				);
			}
			onClose();
			return;
		}

		// Keep only the rows that failed, each carrying its error, so the fix is
		// a retry of exactly what didn't land.
		setRows(failed);
		toast.error(
			sentCount > 0
				? `Sent ${sentCount} of ${filledRows.length} invitations — the rest are listed below with what went wrong`
				: "No invitations were sent — see the errors below",
		);
	};

	return (
		<AppDialog
			open
			onClose={onClose}
			size="lg"
			busy={submitting}
			title="Invite to workspace"
			description="Members can work in this workspace's teams and projects; admins can also manage its people and settings."
			footer={
				<>
					<button
						type="button"
						onClick={onClose}
						disabled={submitting}
						className="rounded-lg border border-input px-4 py-2 text-sm text-foreground transition hover:bg-muted disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={() => void submit()}
						disabled={filledRows.length === 0 || submitting}
						className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
					>
						{submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
						{filledRows.length > 1
							? `Send ${filledRows.length} invitations`
							: "Send invitation"}
					</button>
				</>
			}
		>
			<div className="space-y-5">
				<div>
					<p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Who to invite
					</p>
					<div className="space-y-2">
						{rows.map((row) => (
							<div key={row.key}>
								<div className="flex items-center gap-2">
									<input
										type="email"
										value={row.email}
										onChange={(e) =>
											updateRow(row.key, {
												email: e.target.value,
												error: undefined,
											})
										}
										disabled={submitting}
										placeholder="name@company.com"
										aria-label="Email address"
										className={`min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary disabled:opacity-50 ${
											row.error ? "border-rose-300" : "border-input"
										}`}
									/>
									<RoleToggle
										value={row.role}
										disabled={submitting}
										onChange={(role) => updateRow(row.key, { role })}
									/>
									{rows.length > 1 && (
										<button
											type="button"
											onClick={() => removeRow(row.key)}
											disabled={submitting}
											aria-label="Remove this row"
											className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
										>
											<X className="h-4 w-4" />
										</button>
									)}
								</div>
								{row.error && (
									<p className="mt-1 text-[11px] text-rose-600">{row.error}</p>
								)}
							</div>
						))}
					</div>
					<button
						type="button"
						onClick={addRow}
						disabled={submitting}
						className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary transition hover:text-primary/80 disabled:opacity-50"
					>
						<Plus className="h-3.5 w-3.5" />
						Add another
					</button>
				</div>

				<p className="flex items-start gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-[11px] text-muted-foreground">
					<MailWarning
						className="mt-0.5 h-3.5 w-3.5 shrink-0"
						aria-hidden="true"
					/>
					Anyone without a Proyekto account yet will find the invitation waiting
					when they sign up with that address.
				</p>
			</div>
		</AppDialog>
	);
}

function RoleToggle({
	value,
	disabled,
	onChange,
}: {
	value: WorkspaceAssignableRole;
	disabled: boolean;
	onChange: (role: WorkspaceAssignableRole) => void;
}) {
	const options: Array<{ value: WorkspaceAssignableRole; label: string }> = [
		{ value: "member", label: "Member" },
		{ value: "admin", label: "Admin" },
	];
	return (
		<div className="inline-flex shrink-0 rounded-lg border border-input p-0.5">
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					onClick={() => onChange(option.value)}
					disabled={disabled}
					aria-pressed={value === option.value}
					className={`rounded-md px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${
						value === option.value
							? "bg-primary text-primary-foreground"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}
