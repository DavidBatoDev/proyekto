import { useQuery } from "@tanstack/react-query";
import { Loader2, Send, TriangleAlert } from "lucide-react";
import { ModalPortal } from "@/components/common/ModalPortal";
import { InvoicePreview } from "@/components/invoices/InvoicePreview";
import { formatContractDate } from "@/lib/contract-term";
import { formatCurrency } from "@/lib/currency";
import { invoiceToPreviewProps } from "@/lib/invoicePreviewProps";
import {
	type Invoice,
	type InvoiceRecipientSource,
	invoiceService,
} from "@/services/invoice.service";

/**
 * The last stop before an invoice leaves for a real client's inbox.
 *
 * Issuing used to fire straight off the button, so the first time a consultant
 * learned which address it went to was the delivery report — after the fact,
 * and unfixable, because issuing is one-way. This shows the resolved recipient,
 * the document exactly as the PDF will render it, and what issuing forecloses.
 */

/** Where the address came from — worth saying when it isn't the obvious one. */
function recipientNote(source: InvoiceRecipientSource): string | null {
	switch (source) {
		case "contract_snapshot":
			return null; // The expected case; no need to explain it.
		case "recipient_account":
			return "From the linked client account — the contract has no client email.";
		case "project_client":
			return "From the project's client account — neither the contract nor the invoice names an address.";
		case "none":
			return null; // Handled as a hard block below.
	}
}

export function ConfirmIssueInvoiceModal({
	invoice,
	isPending,
	onCancel,
	onConfirm,
}: {
	invoice: Invoice;
	isPending: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	const recipientQuery = useQuery({
		queryKey: ["invoice", invoice.id, "recipient"],
		queryFn: () => invoiceService.getRecipient(invoice.id),
		// The address is read fresh every time this opens: a confirmation showing
		// a cached address is the exact failure it exists to prevent.
		staleTime: 0,
		gcTime: 0,
	});

	const recipient = recipientQuery.data;
	const note = recipient ? recipientNote(recipient.source) : null;
	const hasRecipient = Boolean(recipient?.email);
	const blocked = recipientQuery.isSuccess && !hasRecipient;

	return (
		<ModalPortal>
			<div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-4">
				<div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-card shadow-xl">
					<div className="border-b border-border px-5 py-4">
						<h2 className="text-sm font-bold text-card-foreground">
							{recipientQuery.isPending ? (
								<>Send invoice {invoice.number}…</>
							) : hasRecipient ? (
								<>
									Send invoice {invoice.number} to{" "}
									<span className="text-primary">{recipient?.email}</span>?
								</>
							) : (
								<>Invoice {invoice.number} has nowhere to go</>
							)}
						</h2>
						{note && (
							<p className="mt-1 text-[11px] text-muted-foreground">{note}</p>
						)}
						{blocked && (
							<p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-destructive">
								<TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
								No client email on the contract, the invoice, or the project.
								Add one before issuing.
							</p>
						)}
					</div>

					{/* The document itself — same mapping the emailed PDF is built from. */}
					<div className="min-h-0 flex-1 overflow-y-auto bg-muted/40 px-5 py-4">
						<InvoicePreview {...invoiceToPreviewProps(invoice)} />
					</div>

					<div className="border-t border-border px-5 py-4">
						<dl className="grid grid-cols-3 gap-3 text-[11px]">
							<Fact
								label="Total"
								value={formatCurrency(invoice.total, invoice.currency)}
							/>
							<Fact
								label="Due"
								value={
									invoice.due_date ? formatContractDate(invoice.due_date) : "—"
								}
							/>
							<Fact label="Hours" value={hoursDetailLabel(invoice)} />
						</dl>
						<p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
							The client receives the PDF by email. Once issued, this invoice
							can only be voided — not edited.
						</p>
						<div className="mt-4 flex justify-end gap-2">
							<button
								type="button"
								onClick={onCancel}
								disabled={isPending}
								className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-muted disabled:opacity-50"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={onConfirm}
								disabled={isPending || !hasRecipient}
								className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
							>
								{isPending ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								) : (
									<Send className="h-3.5 w-3.5" />
								)}
								Issue &amp; send
							</button>
						</div>
					</div>
				</div>
			</div>
		</ModalPortal>
	);
}

function Fact({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<dt className="font-semibold uppercase tracking-wide text-muted-foreground">
				{label}
			</dt>
			<dd className="mt-0.5 text-xs font-semibold text-card-foreground">
				{value}
			</dd>
		</div>
	);
}

/** What the client will see about time on this invoice. */
function hoursDetailLabel(invoice: Invoice): string {
	if (invoice.hours_detail_level === "none") return "Not shown";
	if (invoice.hours_detail_level === "detailed") return "Itemised by task";
	return "Summarised";
}
