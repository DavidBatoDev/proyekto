import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	CalendarClock,
	CircleDollarSign,
	Download,
	FileText,
	Loader2,
	Mail,
	Pencil,
	ReceiptText,
	Send,
	Sparkles,
	Trash2,
	Undo2,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
	AppEmptyState,
	AppSectionHeader,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { ConfirmIssueInvoiceModal } from "@/components/invoices/ConfirmIssueInvoiceModal";
import { useToast } from "@/hooks/useToast";
import { formatMoney } from "@/lib/contract-term";
import { invoiceHasClient, NO_CLIENT_HINT } from "@/lib/invoiceClient";
import { contractService } from "@/services/contract.service";
import {
	type Invoice,
	type InvoiceStatus,
	invoiceService,
} from "@/services/invoice.service";

export function ProjectInvoices({ projectId }: { projectId: string }) {
	const qc = useQueryClient();
	const toast = useToast();
	const navigate = useNavigate();
	const [confirmDelete, setConfirmDelete] = useState<Invoice | null>(null);
	// Issuing is one-way and emails a real client, so it goes through a
	// confirmation showing the resolved recipient and the rendered document.
	const [confirmIssue, setConfirmIssue] = useState<Invoice | null>(null);
	const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);
	const [voidInvoice, setVoidInvoice] = useState<Invoice | null>(null);
	const [reverseRequest, setReverseRequest] = useState<{
		invoice: Invoice;
		paymentId: string;
	} | null>(null);

	const invoicesQuery = useQuery({
		queryKey: ["invoices", "project", projectId],
		queryFn: () => invoiceService.listByProject(projectId, { limit: 100 }),
	});

	// Generating scheduled drafts needs a signed contract to bill against.
	const contractsQuery = useQuery({
		queryKey: ["contracts", projectId],
		queryFn: () => contractService.listByProject(projectId),
	});
	const signedContract = (contractsQuery.data ?? []).find(
		(c) => c.status === "signed",
	);

	const invalidate = () =>
		void qc.invalidateQueries({ queryKey: ["invoices", "project", projectId] });

	const issueMutation = useMutation({
		mutationFn: (invoiceId: string) => invoiceService.issue(invoiceId),
		onSuccess: (invoice) => {
			// Issuing always succeeds; emailing is best-effort, so report both.
			// A failed send is a WARNING, not a success: the invoice really was
			// issued, but the client has not been told, and a green toast let
			// consultants believe otherwise.
			const delivery = invoice.email_delivery;
			if (delivery?.sent) {
				toast.success(`Invoice issued and emailed to ${delivery.to}`);
			} else {
				toast.warning(
					`Invoice issued, but not emailed — ${
						delivery?.reason ?? "no client email on file."
					} Use Re-send once that's fixed.`,
				);
			}
			setConfirmIssue(null);
			invalidate();
		},
		onError: (err) => {
			toast.error((err as Error).message);
			setConfirmIssue(null);
		},
	});

	const resendMutation = useMutation({
		mutationFn: (invoiceId: string) => invoiceService.resend(invoiceId),
		onSuccess: (delivery) => {
			if (delivery.sent) toast.success(`Re-sent to ${delivery.to}`);
			else toast.error(delivery.reason ?? "Could not send the invoice.");
			invalidate();
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const deleteMutation = useMutation({
		mutationFn: (invoiceId: string) => invoiceService.remove(invoiceId),
		onSuccess: () => {
			toast.success("Draft deleted");
			setConfirmDelete(null);
			invalidate();
		},
		onError: (err) => {
			toast.error((err as Error).message);
			setConfirmDelete(null);
		},
	});

	const paymentMutation = useMutation({
		mutationFn: ({
			invoiceId,
			amount,
			paymentDate,
			method,
			reference,
			note,
		}: {
			invoiceId: string;
			amount: number;
			paymentDate: string;
			method: string;
			reference: string;
			note: string;
		}) =>
			invoiceService.recordPayment(invoiceId, {
				amount,
				payment_date: paymentDate,
				payment_method: method || undefined,
				reference: reference || undefined,
				note: note || undefined,
			}),
		onSuccess: () => {
			toast.success("Payment recorded");
			setPaymentInvoice(null);
			invalidate();
			void qc.invalidateQueries({ queryKey: ["finance"] });
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const voidMutation = useMutation({
		mutationFn: ({
			invoiceId,
			reason,
		}: {
			invoiceId: string;
			reason: string;
		}) => invoiceService.voidAndReplace(invoiceId, reason),
		onSuccess: ({ replacement }) => {
			toast.success("Invoice voided; replacement draft created");
			setVoidInvoice(null);
			invalidate();
			void qc.invalidateQueries({ queryKey: ["finance"] });
			void navigate({
				to: "/finance/invoices/$invoiceId/edit",
				params: { invoiceId: replacement.id },
				search: { projectId },
			});
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const reverseMutation = useMutation({
		mutationFn: ({
			invoiceId,
			paymentId,
			reason,
		}: {
			invoiceId: string;
			paymentId: string;
			reason: string;
		}) => invoiceService.reversePayment(invoiceId, paymentId, reason),
		onSuccess: () => {
			toast.success("Payment reversed");
			setReverseRequest(null);
			invalidate();
			void qc.invalidateQueries({ queryKey: ["finance"] });
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const generateMutation = useMutation({
		mutationFn: () => invoiceService.generateScheduled(projectId),
		onSuccess: (result) => {
			if (result.created > 0) {
				toast.success(
					`Drafted ${result.created} invoice${result.created === 1 ? "" : "s"}.`,
				);
			} else if (result.skipped > 0) {
				toast.success("Already up to date — every closed period is billed.");
			} else {
				toast.success("No billing period has closed yet.");
			}
			invalidate();
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const pdfMutation = useMutation({
		mutationFn: (invoiceId: string) => invoiceService.generatePdf(invoiceId),
		onSuccess: () => {
			toast.success("Invoice PDF generated");
			invalidate();
		},
		onError: (err) => toast.error((err as Error).message),
	});

	// Invoice PDFs live in the private bucket, so opening one needs a
	// short-lived presigned URL rather than a stored public link.
	const openPdfMutation = useMutation({
		mutationFn: (invoiceId: string) => invoiceService.getPdfUrl(invoiceId),
		onSuccess: ({ url }) => {
			window.open(url, "_blank", "noopener,noreferrer");
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const invoices = invoicesQuery.data?.items ?? [];

	/**
	 * Three groups, ordered by what needs attention:
	 *   Sent — with the client, waiting on payment (issued / sent / paid / void)
	 *   Scheduled — auto-drafted from the contract, awaiting review
	 *   Drafts — hand-made, still being written
	 */
	const groups = useMemo(() => {
		const sent = invoices.filter((i) => i.status !== "draft");
		const scheduled = invoices.filter(
			(i) => i.status === "draft" && i.origin === "scheduled",
		);
		const drafts = invoices.filter(
			(i) => i.status === "draft" && i.origin === "manual",
		);
		return { sent, scheduled, drafts };
	}, [invoices]);

	const outstanding = useMemo(() => {
		const byCurrency = new Map<string, number>();
		for (const invoice of invoices) {
			if (invoice.status !== "issued" && invoice.status !== "partially_paid")
				continue;
			byCurrency.set(
				invoice.currency,
				(byCurrency.get(invoice.currency) ?? 0) +
					Number(invoice.balance_due ?? invoice.total ?? 0),
			);
		}
		return Array.from(byCurrency.entries());
	}, [invoices]);

	const rowProps = (invoice: Invoice) => ({
		invoice,
		projectId,
		canIssue: invoiceHasClient({
			recipientUserId: invoice.recipient_user_id,
			billToEmail: invoice.bill_to?.email,
		}),
		onIssue: () => setConfirmIssue(invoice),
		onResend: () => resendMutation.mutate(invoice.id),
		onDelete: () => setConfirmDelete(invoice),
		onPdf: () => pdfMutation.mutate(invoice.id),
		onOpenPdf: () => openPdfMutation.mutate(invoice.id),
		onRecordPayment: () => setPaymentInvoice(invoice),
		onVoidAndReplace: () => setVoidInvoice(invoice),
		onReversePayment: (paymentId: string) =>
			setReverseRequest({ invoice, paymentId }),
		isBusy:
			issueMutation.isPending ||
			resendMutation.isPending ||
			pdfMutation.isPending ||
			openPdfMutation.isPending,
	});

	return (
		<div className="w-full">
			<div className="w-full py-6">
				<AppSurfaceCard strong className="mb-6 p-6">
					<AppSectionHeader
						kicker="Finance"
						title="Invoices"
						subtitle="Draft, issue, and send invoices to your client. Issued invoices are emailed with the PDF attached."
						rightSlot={
							<div className="flex flex-wrap items-center gap-2">
								<button
									type="button"
									onClick={() => generateMutation.mutate()}
									disabled={!signedContract || generateMutation.isPending}
									title={
										signedContract
											? "Draft an invoice for every closed billing period the contract hasn't been billed for"
											: "Sign the contract first — scheduled invoices bill against its terms."
									}
									className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
								>
									{generateMutation.isPending ? (
										<Loader2 className="h-4 w-4 animate-spin" />
									) : (
										<Sparkles className="h-4 w-4" />
									)}
									Generate from contract
								</button>
								<button
									type="button"
									onClick={() =>
										void navigate({
											to: "/finance/invoices/new",
											search: { projectId },
										})
									}
									className="app-cta rounded-lg px-4 py-2.5 text-sm font-semibold text-white"
								>
									+ New Invoice
								</button>
							</div>
						}
					/>
					{outstanding.length > 0 && (
						<div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border pt-4">
							<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								Outstanding
							</span>
							{outstanding.map(([currency, total]) => (
								<span
									key={currency}
									className="text-sm font-bold tabular-nums text-foreground"
								>
									{formatMoney(currency, total)}
								</span>
							))}
						</div>
					)}
				</AppSurfaceCard>

				{invoicesQuery.isPending ? (
					<div className="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 className="mr-2 h-5 w-5 animate-spin" />
						Loading invoices…
					</div>
				) : invoices.length === 0 ? (
					<AppEmptyState
						icon={ReceiptText}
						title="No invoices yet"
						description={
							signedContract
								? "Generate them from the contract's billing schedule, or write one by hand."
								: "Create one by hand, or sign the contract to bill from its schedule automatically."
						}
						className="app-surface-card-strong border-dashed py-16"
					/>
				) : (
					<div className="space-y-6">
						<InvoiceGroup
							title="Sent to client"
							hint="Issued and emailed. Waiting on payment."
							icon={Send}
							invoices={groups.sent}
							renderRow={(invoice) => (
								<InvoiceRow key={invoice.id} {...rowProps(invoice)} />
							)}
						/>
						<InvoiceGroup
							title="Scheduled drafts"
							hint="Auto-drafted from the contract's billing schedule. Review, then issue."
							icon={CalendarClock}
							invoices={groups.scheduled}
							renderRow={(invoice) => (
								<InvoiceRow key={invoice.id} {...rowProps(invoice)} />
							)}
						/>
						<InvoiceGroup
							title="Drafts"
							hint="Written by hand. Not visible to the client until issued."
							icon={Pencil}
							invoices={groups.drafts}
							renderRow={(invoice) => (
								<InvoiceRow key={invoice.id} {...rowProps(invoice)} />
							)}
						/>
					</div>
				)}
			</div>

			{confirmDelete && (
				<DeleteInvoiceModal
					invoice={confirmDelete}
					isDeleting={deleteMutation.isPending}
					onCancel={() => setConfirmDelete(null)}
					onConfirm={() => deleteMutation.mutate(confirmDelete.id)}
				/>
			)}

			{confirmIssue && (
				<ConfirmIssueInvoiceModal
					invoice={confirmIssue}
					isPending={issueMutation.isPending}
					onCancel={() => setConfirmIssue(null)}
					onConfirm={() => issueMutation.mutate(confirmIssue.id)}
				/>
			)}
			{paymentInvoice && (
				<PaymentModal
					invoice={paymentInvoice}
					isSaving={paymentMutation.isPending}
					onCancel={() => setPaymentInvoice(null)}
					onConfirm={(data) =>
						paymentMutation.mutate({ invoiceId: paymentInvoice.id, ...data })
					}
				/>
			)}
			{voidInvoice && (
				<VoidReplaceModal
					invoice={voidInvoice}
					isSaving={voidMutation.isPending}
					onCancel={() => setVoidInvoice(null)}
					onConfirm={(reason) =>
						voidMutation.mutate({ invoiceId: voidInvoice.id, reason })
					}
				/>
			)}
			{reverseRequest && (
				<ReversePaymentModal
					isSaving={reverseMutation.isPending}
					onCancel={() => setReverseRequest(null)}
					onConfirm={(reason) =>
						reverseMutation.mutate({
							invoiceId: reverseRequest.invoice.id,
							paymentId: reverseRequest.paymentId,
							reason,
						})
					}
				/>
			)}
		</div>
	);
}

/** One titled band of invoices. Renders nothing when the group is empty. */
function InvoiceGroup({
	title,
	hint,
	icon: Icon,
	invoices,
	renderRow,
}: {
	title: string;
	hint: string;
	icon: typeof Send;
	invoices: Invoice[];
	renderRow: (invoice: Invoice) => React.ReactNode;
}) {
	if (invoices.length === 0) return null;
	return (
		<section>
			<div className="mb-2 flex items-baseline gap-2 px-1">
				<Icon className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-muted-foreground" />
				<h2 className="text-sm font-semibold text-foreground">{title}</h2>
				<span className="rounded-full bg-muted px-1.5 text-xs font-semibold text-muted-foreground">
					{invoices.length}
				</span>
				<p className="hidden text-xs text-muted-foreground sm:block">{hint}</p>
			</div>
			<div className="space-y-2">{invoices.map(renderRow)}</div>
		</section>
	);
}

function InvoiceRow({
	invoice,
	projectId,
	canIssue,
	onIssue,
	onResend,
	onDelete,
	onPdf,
	onOpenPdf,
	onRecordPayment,
	onVoidAndReplace,
	onReversePayment,
	isBusy,
}: {
	invoice: Invoice;
	projectId: string;
	canIssue: boolean;
	onIssue: () => void;
	onResend: () => void;
	onDelete: () => void;
	onPdf: () => void;
	onOpenPdf: () => void;
	onRecordPayment: () => void;
	onVoidAndReplace: () => void;
	onReversePayment: (paymentId: string) => void;
	isBusy: boolean;
}) {
	const navigate = useNavigate();
	const isDraft = invoice.status === "draft";
	const canRecordPayment =
		invoice.status === "issued" || invoice.status === "partially_paid";

	return (
		<div className="app-surface-card flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
			<div className="min-w-0">
				<div className="flex flex-wrap items-center gap-2">
					<p className="text-sm font-semibold text-foreground">
						{invoice.number}
					</p>
					<StatusChip status={invoice.status} />
					{invoice.origin === "scheduled" && (
						<span className="rounded-full border border-sky-200 bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
							auto
						</span>
					)}
					{invoice.sent_at && (
						<span
							className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600"
							title={`Emailed ${invoice.sent_at.slice(0, 10)}`}
						>
							<Mail className="h-3 w-3" />
							emailed
						</span>
					)}
				</div>
				{invoice.period_start && invoice.period_end && (
					<p className="mt-1 text-xs font-medium text-muted-foreground">
						Covers {invoice.period_start} – {invoice.period_end}
					</p>
				)}
				<p className="mt-0.5 text-xs text-muted-foreground">
					{invoice.issue_date ? `Issued ${invoice.issue_date}` : "Not issued"} ·{" "}
					{invoice.due_date ? `Due ${invoice.due_date}` : "No due date"} ·{" "}
					{hoursDetailLabel(invoice.hours_detail_level)}
				</p>
				<p className="mt-1.5 text-base font-bold tabular-nums text-foreground">
					{formatMoney(invoice.currency, Number(invoice.total ?? 0))}
				</p>
				{!isDraft && invoice.status !== "void" && (
					<p
						className={`mt-0.5 text-xs font-medium ${invoice.is_overdue ? "text-destructive" : "text-muted-foreground"}`}
					>
						{invoice.is_overdue ? "Overdue" : "Balance due"}:{" "}
						{formatMoney(
							invoice.currency,
							Number(invoice.balance_due ?? invoice.total ?? 0),
						)}
					</p>
				)}
				{invoice.payments.filter((payment) => !payment.reverses_payment_id)
					.length > 0 && (
					<div className="mt-2 flex flex-wrap gap-1.5">
						{invoice.payments
							.filter((payment) => !payment.reverses_payment_id)
							.map((payment) => {
								const reversed = invoice.payments.some(
									(entry) => entry.reverses_payment_id === payment.id,
								);
								return (
									<span
										key={payment.id}
										className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground"
									>
										{formatMoney(invoice.currency, payment.amount)} ·{" "}
										{payment.payment_date}
										{reversed ? (
											" · reversed"
										) : (
											<button
												type="button"
												onClick={() => onReversePayment(payment.id)}
												className="font-semibold text-primary hover:underline"
											>
												Reverse
											</button>
										)}
									</span>
								);
							})}
					</div>
				)}
			</div>

			<div className="flex flex-wrap items-center gap-2">
				{isDraft && (
					<button
						type="button"
						onClick={() =>
							void navigate({
								to: "/finance/invoices/$invoiceId/edit",
								params: { invoiceId: invoice.id },
								search: { projectId },
							})
						}
						disabled={isBusy}
						className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-60"
					>
						<Pencil className="h-3.5 w-3.5" />
						Edit
					</button>
				)}
				<button
					type="button"
					onClick={onPdf}
					disabled={isBusy}
					className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-60"
				>
					<FileText className="h-3.5 w-3.5" />
					{invoice.pdf_path
						? isDraft
							? "Regenerate"
							: "Final PDF"
						: "Generate PDF"}
				</button>
				{invoice.pdf_path && (
					<button
						type="button"
						onClick={onOpenPdf}
						disabled={isBusy}
						className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-60"
					>
						<Download className="h-3.5 w-3.5" />
						Open
					</button>
				)}
				{isDraft ? (
					<>
						<button
							type="button"
							onClick={onDelete}
							disabled={isBusy}
							title="Delete this draft"
							aria-label={`Delete draft ${invoice.number}`}
							className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-2 text-xs font-semibold text-muted-foreground transition hover:border-destructive hover:text-destructive disabled:opacity-60"
						>
							<Trash2 className="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							onClick={onIssue}
							disabled={isBusy || !canIssue}
							title={
								canIssue ? "Issue and email to the client" : NO_CLIENT_HINT
							}
							className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
						>
							<Send className="h-3.5 w-3.5" />
							Issue &amp; send
						</button>
					</>
				) : (
					<>
						{canRecordPayment && (
							<button
								type="button"
								onClick={onRecordPayment}
								disabled={isBusy}
								className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-60"
							>
								<CircleDollarSign className="h-3.5 w-3.5" /> Record payment
							</button>
						)}
						{invoice.status === "issued" && invoice.amount_paid === 0 && (
							<button
								type="button"
								onClick={onVoidAndReplace}
								disabled={isBusy}
								className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-60"
							>
								<Undo2 className="h-3.5 w-3.5" /> Void &amp; replace
							</button>
						)}
						{invoice.status !== "void" && invoice.status !== "paid" && (
							<button
								type="button"
								onClick={onResend}
								disabled={isBusy}
								title="Email this invoice to the client again"
								className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-60"
							>
								<Mail className="h-3.5 w-3.5" />
								Re-send
							</button>
						)}
					</>
				)}
			</div>
		</div>
	);
}

function DeleteInvoiceModal({
	invoice,
	isDeleting,
	onCancel,
	onConfirm,
}: {
	invoice: Invoice;
	isDeleting: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	return (
		<div className="fixed inset-0 z-100 flex items-center justify-center bg-black/40 p-4">
			<div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl">
				<h2 className="text-sm font-bold text-card-foreground">
					Delete draft {invoice.number}?
				</h2>
				<p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
					This removes the draft and its lines for good. The client has never
					seen it, so nothing is lost on their side.
					{invoice.origin === "scheduled" && (
						<>
							{" "}
							It was drafted from the contract schedule — "Generate from
							contract" will recreate it for this period.
						</>
					)}
				</p>
				<div className="mt-5 flex justify-end gap-2">
					<button
						type="button"
						onClick={onCancel}
						disabled={isDeleting}
						className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={onConfirm}
						disabled={isDeleting}
						className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3.5 py-2 text-xs font-semibold text-white hover:bg-destructive/90 disabled:opacity-50"
					>
						{isDeleting ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Trash2 className="h-3.5 w-3.5" />
						)}
						Delete draft
					</button>
				</div>
			</div>
		</div>
	);
}

function PaymentModal({
	invoice,
	isSaving,
	onCancel,
	onConfirm,
}: {
	invoice: Invoice;
	isSaving: boolean;
	onCancel: () => void;
	onConfirm: (data: {
		amount: number;
		paymentDate: string;
		method: string;
		reference: string;
		note: string;
	}) => void;
}) {
	const [amount, setAmount] = useState(String(invoice.balance_due));
	const [paymentDate, setPaymentDate] = useState(
		new Date().toISOString().slice(0, 10),
	);
	const [method, setMethod] = useState("");
	const [reference, setReference] = useState("");
	const [note, setNote] = useState("");
	return (
		<div className="fixed inset-0 z-100 flex items-center justify-center bg-black/40 p-4">
			<form
				onSubmit={(event) => {
					event.preventDefault();
					onConfirm({
						amount: Number(amount),
						paymentDate,
						method,
						reference,
						note,
					});
				}}
				className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl"
			>
				<h2 className="text-base font-bold text-card-foreground">
					Record payment
				</h2>
				<p className="mt-1 text-xs text-muted-foreground">
					{invoice.number} has{" "}
					{formatMoney(invoice.currency, invoice.balance_due)} remaining.
				</p>
				<div className="mt-4 grid gap-3">
					<label className="text-xs font-semibold text-muted-foreground">
						Amount
						<input
							required
							min="0.01"
							max={invoice.balance_due}
							step="0.01"
							type="number"
							value={amount}
							onChange={(event) => setAmount(event.target.value)}
							className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
						/>
					</label>
					<label className="text-xs font-semibold text-muted-foreground">
						Payment date
						<input
							required
							type="date"
							value={paymentDate}
							onChange={(event) => setPaymentDate(event.target.value)}
							className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
						/>
					</label>
					<label className="text-xs font-semibold text-muted-foreground">
						Method
						<input
							value={method}
							onChange={(event) => setMethod(event.target.value)}
							placeholder="Bank transfer, GCash…"
							className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
						/>
					</label>
					<label className="text-xs font-semibold text-muted-foreground">
						Reference
						<input
							value={reference}
							onChange={(event) => setReference(event.target.value)}
							className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
						/>
					</label>
					<label className="text-xs font-semibold text-muted-foreground">
						Note
						<textarea
							value={note}
							onChange={(event) => setNote(event.target.value)}
							className="mt-1.5 min-h-18 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
						/>
					</label>
				</div>
				<div className="mt-5 flex justify-end gap-2">
					<button
						type="button"
						onClick={onCancel}
						disabled={isSaving}
						className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={isSaving || !(Number(amount) > 0)}
						className="app-cta rounded-lg px-3.5 py-2 text-xs font-semibold text-white"
					>
						{isSaving ? "Saving…" : "Record payment"}
					</button>
				</div>
			</form>
		</div>
	);
}

function VoidReplaceModal({
	invoice,
	isSaving,
	onCancel,
	onConfirm,
}: {
	invoice: Invoice;
	isSaving: boolean;
	onCancel: () => void;
	onConfirm: (reason: string) => void;
}) {
	const [reason, setReason] = useState("");
	return (
		<div className="fixed inset-0 z-100 flex items-center justify-center bg-black/40 p-4">
			<form
				onSubmit={(event) => {
					event.preventDefault();
					onConfirm(reason);
				}}
				className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl"
			>
				<h2 className="text-base font-bold text-card-foreground">
					Void and replace {invoice.number}?
				</h2>
				<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
					This preserves the issued invoice for audit purposes and creates a new
					editable draft with copied client-facing details.
				</p>
				<label className="mt-4 block text-xs font-semibold text-muted-foreground">
					Reason
					<textarea
						required
						value={reason}
						onChange={(event) => setReason(event.target.value)}
						className="mt-1.5 min-h-22 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
					/>
				</label>
				<div className="mt-5 flex justify-end gap-2">
					<button
						type="button"
						onClick={onCancel}
						disabled={isSaving}
						className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={isSaving || !reason.trim()}
						className="rounded-lg bg-destructive px-3.5 py-2 text-xs font-semibold text-white"
					>
						{isSaving ? "Voiding…" : "Void & create draft"}
					</button>
				</div>
			</form>
		</div>
	);
}

function ReversePaymentModal({
	isSaving,
	onCancel,
	onConfirm,
}: {
	isSaving: boolean;
	onCancel: () => void;
	onConfirm: (reason: string) => void;
}) {
	const [reason, setReason] = useState("");
	return (
		<div className="fixed inset-0 z-100 flex items-center justify-center bg-black/40 p-4">
			<form
				onSubmit={(event) => {
					event.preventDefault();
					onConfirm(reason);
				}}
				className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl"
			>
				<h2 className="text-base font-bold text-card-foreground">
					Reverse payment?
				</h2>
				<p className="mt-1 text-xs text-muted-foreground">
					The original payment stays in the audit trail and the invoice balance
					will be recalculated.
				</p>
				<label className="mt-4 block text-xs font-semibold text-muted-foreground">
					Reason
					<textarea
						required
						value={reason}
						onChange={(event) => setReason(event.target.value)}
						className="mt-1.5 min-h-22 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
					/>
				</label>
				<div className="mt-5 flex justify-end gap-2">
					<button
						type="button"
						onClick={onCancel}
						disabled={isSaving}
						className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={isSaving || !reason.trim()}
						className="rounded-lg bg-destructive px-3.5 py-2 text-xs font-semibold text-white"
					>
						{isSaving ? "Reversing…" : "Reverse payment"}
					</button>
				</div>
			</form>
		</div>
	);
}

/** What the client will see about time on this invoice. */
function hoursDetailLabel(level: Invoice["hours_detail_level"]): string {
	if (level === "none") return "No hours shown";
	if (level === "detailed") return "Hours itemised by task";
	return "Hours summarised";
}

function StatusChip({ status }: { status: InvoiceStatus }) {
	const classes: Record<InvoiceStatus, string> = {
		draft: "bg-slate-100 text-slate-700 border-slate-200",
		issued: "bg-amber-100 text-amber-700 border-amber-200",
		partially_paid: "bg-sky-100 text-sky-700 border-sky-200",
		paid: "bg-emerald-100 text-emerald-700 border-emerald-200",
		void: "bg-rose-100 text-rose-700 border-rose-200",
	};
	return (
		<span
			className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${classes[status]}`}
		>
			{status}
		</span>
	);
}
