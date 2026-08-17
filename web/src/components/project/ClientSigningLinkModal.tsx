import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link2, Loader2, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { useConfirm } from "@/hooks/useConfirm";
import { useToast } from "@/hooks/useToast";
import { formatContractDate } from "@/lib/contract-term";
import { type Contract, contractService } from "@/services/contract.service";

/**
 * Send the agreement to the client to sign remotely.
 *
 * Modelled on ShareRoadmapModal, with the security posture a contract needs:
 * the link is single-use, expires, is revocable, and replaces any outstanding
 * one when re-issued — so a URL the consultant thinks they took back cannot
 * still sign.
 *
 * The expiry and email controls render whether or not a link already exists.
 * They used to be in the no-link branch only, which meant "Replace link"
 * silently ran with `sendEmail: false` — the consultant got a fresh URL and the
 * client got nothing, holding a link that had just been revoked out from under
 * them.
 */

const EXPIRY_OPTIONS = [7, 14, 30];

export function ClientSigningLinkModal({
	contract,
	onClose,
}: {
	contract: Contract;
	onClose: () => void;
}) {
	const qc = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const expiryId = useId();
	const [days, setDays] = useState(14);
	// Defaults on: creating a signing link and not sending it is the unusual case.
	const counterparty = contract.positions.find(
		(position) => position.capacity !== "consultant",
	);
	const counterpartyEmail =
		counterparty?.email_snapshot ?? contract.client_email;
	const counterpartyLabel =
		contract.relationship_kind === "talent_services" ? "Talent" : "Client";
	const [sendEmail, setSendEmail] = useState(Boolean(counterpartyEmail));
	const [copied, setCopied] = useState(false);

	const linkQuery = useQuery({
		queryKey: ["contract", contract.id, "signature-link"],
		queryFn: () => contractService.getSignatureLink(contract.id),
		staleTime: 0,
	});
	const link = linkQuery.data ?? null;

	const invalidate = () =>
		void qc.invalidateQueries({
			queryKey: ["contract", contract.id, "signature-link"],
		});

	const createMutation = useMutation({
		mutationFn: () =>
			contractService.createSignatureLink(contract.id, {
				expires_in_days: days,
				send_email: sendEmail,
				...(counterpartyEmail ? { recipient_email: counterpartyEmail } : {}),
			}),
		onSuccess: (created) => {
			// Report from the server's delivery result, never from local state:
			// the send is best-effort and can fail after the link is created.
			const delivery = created.email_delivery;
			if (!sendEmail) {
				toast.success("Signing link created");
			} else if (delivery?.sent) {
				toast.success(`Link created and emailed to ${delivery.to}`);
			} else {
				toast.warning(
					`Link created, but the email didn't go out — ${
						delivery?.reason ?? "unknown error"
					} Copy the link and send it yourself.`,
				);
			}
			invalidate();
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const revokeMutation = useMutation({
		mutationFn: () => contractService.revokeSignatureLink(contract.id),
		onSuccess: () => {
			toast.success(
				link?.recipient_email
					? `Link revoked — we let ${link.recipient_email} know`
					: "Link revoked",
			);
			invalidate();
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const copy = async () => {
		if (!link) return;
		await navigator.clipboard.writeText(link.url);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const askRevoke = async () => {
		const ok = await confirm({
			title: "Revoke this signing link?",
			message: link?.recipient_email
				? `The link stops working immediately and ${link.recipient_email} will be emailed to say it was withdrawn. You can create a new one afterwards.`
				: "The link stops working immediately. You can create a new one afterwards.",
			confirmLabel: "Revoke link",
			tone: "danger",
		});
		if (ok) revokeMutation.mutate();
	};

	const askReplace = async () => {
		const ok = await confirm({
			title: "Replace this signing link?",
			message: sendEmail
				? `The current link stops working and a new one is emailed to the ${counterpartyLabel.toLowerCase()}.`
				: "The current link stops working straight away. Nothing will be emailed — you'll need to send the new link yourself.",
			confirmLabel: "Replace link",
			tone: "danger",
		});
		if (ok) createMutation.mutate();
	};

	const busy = createMutation.isPending || revokeMutation.isPending;

	const options = (
		<div className="space-y-3">
			<div>
				<label
					htmlFor={expiryId}
					className="mb-1.5 block text-xs font-semibold text-muted-foreground"
				>
					Expires after
				</label>
				<div className="inline-flex rounded-lg border border-border p-0.5 text-xs font-medium">
					{EXPIRY_OPTIONS.map((d) => (
						<button
							key={d}
							id={d === days ? expiryId : undefined}
							type="button"
							onClick={() => setDays(d)}
							className={`rounded-md px-2.5 py-1 transition ${
								days === d
									? "bg-primary text-primary-foreground"
									: "text-muted-foreground hover:text-foreground"
							}`}
						>
							{d} days
						</button>
					))}
				</div>
			</div>

			{counterpartyEmail ? (
				<label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
					<input
						type="checkbox"
						checked={sendEmail}
						onChange={(e) => setSendEmail(e.target.checked)}
						className="h-3.5 w-3.5 accent-primary"
					/>
					Email it to {counterpartyEmail}
				</label>
			) : (
				<p className="text-[11px] text-muted-foreground">
					No {counterpartyLabel.toLowerCase()} email on the contract — you'll
					need to send the link yourself.
				</p>
			)}
		</div>
	);

	return (
		<AppDialog
			open
			onClose={onClose}
			busy={busy}
			size="md"
			title={`Send to the ${counterpartyLabel.toLowerCase()} to sign`}
			description="They open the link, read the agreement, and sign — no Proyekto account needed. The link works once and then stops."
			footer={
				<button
					type="button"
					onClick={onClose}
					className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-muted"
				>
					Done
				</button>
			}
		>
			{linkQuery.isPending ? (
				<div className="flex justify-center py-8">
					<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
				</div>
			) : link ? (
				<div className="space-y-4">
					<div className="flex items-center gap-2">
						<input
							readOnly
							value={link.url}
							aria-label="Signing link"
							onFocus={(e) => e.currentTarget.select()}
							className="min-w-0 flex-1 rounded-lg border border-input bg-muted/40 px-3 py-2 text-xs text-card-foreground outline-none"
						/>
						<button
							type="button"
							onClick={() => void copy()}
							className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
						>
							{copied ? (
								<Check className="h-3.5 w-3.5" />
							) : (
								<Copy className="h-3.5 w-3.5" />
							)}
							{copied ? "Copied" : "Copy"}
						</button>
					</div>

					<p className="text-[11px] text-muted-foreground">
						{link.view_count > 0
							? `Opened ${link.view_count} time${link.view_count === 1 ? "" : "s"}`
							: "Not opened yet"}
						{" · expires "}
						{formatContractDate(link.expires_at.slice(0, 10))}
						{link.recipient_email ? ` · sent to ${link.recipient_email}` : ""}
					</p>

					<div className="border-t border-border pt-3">
						<p className="mb-2 text-xs font-semibold text-foreground">
							Replace with a new link
						</p>
						{options}
					</div>

					<div className="flex justify-between gap-2 pt-1">
						<button
							type="button"
							onClick={() => void askRevoke()}
							disabled={busy}
							className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
						>
							<Trash2 className="h-3.5 w-3.5" />
							Revoke
						</button>
						<button
							type="button"
							onClick={() => void askReplace()}
							disabled={busy}
							className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
						>
							{createMutation.isPending ? "Replacing…" : "Replace link"}
						</button>
					</div>
				</div>
			) : (
				<div className="space-y-3">
					{options}
					<button
						type="button"
						onClick={() => createMutation.mutate()}
						disabled={busy}
						className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
					>
						{createMutation.isPending ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Link2 className="h-3.5 w-3.5" />
						)}
						Create signing link
					</button>
				</div>
			)}
		</AppDialog>
	);
}
