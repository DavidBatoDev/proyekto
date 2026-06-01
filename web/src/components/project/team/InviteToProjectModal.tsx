import { useState } from "react";
import { Loader2, Plus, Users } from "lucide-react";
import { ModalPortal } from "@/components/common/ModalPortal";
import { useProjectInviteMemberMutation } from "@/hooks/useProjectQueries";
import { useToast } from "@/hooks/useToast";

type DefaultRole = "editor" | "viewer";

/**
 * Invite-by-email modal for direct project shares (people who aren't
 * coming through an attached team). Mirrors the new team-invite modal
 * styling: slate, plain inputs, ModalPortal so the overlay covers the
 * full viewport even when nested inside an `app-surface-card` that
 * applies `backdrop-filter`.
 *
 * Compared to the legacy AddMemberModal: drops the
 * client / consultant / freelancer role trichotomy. People who arrive
 * via an attached team already get their position from team_members;
 * direct shares just need an email + access level + optional title.
 */
export function InviteToProjectModal({
	projectId,
	onClose,
}: {
	projectId: string;
	onClose: () => void;
}) {
	const [email, setEmail] = useState("");
	const [defaultRole, setDefaultRole] = useState<DefaultRole>("editor");
	const [position, setPosition] = useState("");
	const [message, setMessage] = useState("");

	const inviteMutation = useProjectInviteMemberMutation(projectId);
	const toast = useToast();

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!email.trim() || inviteMutation.isPending) return;
		try {
			const createdInvite = await inviteMutation.mutateAsync({
				email: email.trim(),
				// `role` is the legacy lane field on project_invites; we
				// always send "member" since the lane concept is gone.
				// Effective access on accept is driven by `default_role`.
				role: "member",
				default_role: defaultRole,
				position: position.trim() || undefined,
				message: message.trim() || undefined,
			});
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
		} catch (err) {
			toast.error((err as Error).message);
		}
	};

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
							Invite to project
						</h2>
					</div>
					<p className="mt-1 text-sm text-slate-600">
						Send an invite by email. They'll be added directly to this
						project once they accept. To bring in a whole team, use{" "}
						<span className="font-medium text-slate-700">Manage teams</span>{" "}
						instead.
					</p>
					<form className="mt-5 space-y-4" onSubmit={submit}>
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
									value={defaultRole}
									onChange={(e) =>
										setDefaultRole(e.target.value as DefaultRole)
									}
									className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
								>
									<option value="editor">Editor</option>
									<option value="viewer">Viewer</option>
								</select>
							</label>
							<label className="block">
								<span className="text-sm font-medium text-slate-700">
									Position
								</span>
								<input
									type="text"
									value={position}
									onChange={(e) => setPosition(e.target.value)}
									maxLength={100}
									placeholder="e.g. Designer"
									className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
								/>
							</label>
						</div>
						<label className="block">
							<span className="text-sm font-medium text-slate-700">
								Message (optional)
							</span>
							<textarea
								value={message}
								onChange={(e) => setMessage(e.target.value)}
								maxLength={1200}
								rows={3}
								placeholder="Hey — wanted you to take a look at this project."
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
								disabled={!email.trim() || inviteMutation.isPending}
								className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
							>
								{inviteMutation.isPending ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									<Plus className="h-4 w-4" />
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
