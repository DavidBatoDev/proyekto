import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, ReceiptText } from "lucide-react";
import { useState } from "react";
import {
	AppEmptyState,
	AppSectionHeader,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import {
	invoiceService,
	type Invoice,
	type InvoiceLineItemInput,
	type InvoiceStatus,
} from "@/services/invoice.service";
import { useToast } from "@/hooks/useToast";
import { ModalPortal } from "@/components/common/ModalPortal";

export const Route = createFileRoute("/project/$projectId/payments")({
	component: PaymentsPage,
});

function PaymentsPage() {
	const { projectId } = Route.useParams();
	const qc = useQueryClient();
	const toast = useToast();
	const [createOpen, setCreateOpen] = useState(false);

	const invoicesQuery = useQuery({
		queryKey: ["invoices", "project", projectId],
		queryFn: () => invoiceService.listByProject(projectId, { limit: 100 }),
	});

	const createMutation = useMutation({
		mutationFn: (payload: {
			notes?: string;
			due_date?: string;
			attach_hours: boolean;
			line_items?: InvoiceLineItemInput[];
		}) =>
			invoiceService.create({
				project_id: projectId,
				notes: payload.notes,
				due_date: payload.due_date,
				attach_hours: payload.attach_hours,
				line_items: payload.line_items,
			}),
		onSuccess: () => {
			toast.success("Invoice created");
			setCreateOpen(false);
			void qc.invalidateQueries({ queryKey: ["invoices", "project", projectId] });
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const issueMutation = useMutation({
		mutationFn: (invoiceId: string) => invoiceService.issue(invoiceId),
		onSuccess: () => {
			toast.success("Invoice issued");
			void qc.invalidateQueries({ queryKey: ["invoices", "project", projectId] });
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const pdfMutation = useMutation({
		mutationFn: (invoiceId: string) => invoiceService.generatePdf(invoiceId),
		onSuccess: () => {
			toast.success("Invoice PDF generated");
			void qc.invalidateQueries({ queryKey: ["invoices", "project", projectId] });
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const invoices = invoicesQuery.data?.items ?? [];

	return (
		<div className="app-shell-bg h-full w-full overflow-y-auto">
			<div className="mx-auto w-full max-w-5xl px-5 py-6 md:px-8 md:py-8">
				<AppSurfaceCard strong className="mb-6 p-6">
					<AppSectionHeader
						kicker="Finance"
						title="Invoices"
						subtitle="Dedicated invoice lifecycle with optional attached approved hours."
						rightSlot={
							<button
								type="button"
								onClick={() => setCreateOpen(true)}
								className="app-cta rounded-lg px-4 py-2.5 text-sm font-semibold text-white"
							>
								+ New Invoice
							</button>
						}
					/>
				</AppSurfaceCard>

				{invoicesQuery.isPending ? (
					<div className="flex items-center justify-center py-16 text-slate-500">
						<Loader2 className="mr-2 h-5 w-5 animate-spin" />
						Loading invoices...
					</div>
				) : invoices.length === 0 ? (
					<AppEmptyState
						icon={ReceiptText}
						title="No invoices yet"
						description="Create your first invoice from this project. You can include manual lines and optionally attach approved time logs."
						className="app-surface-card-strong border-dashed py-16"
					/>
				) : (
					<div className="space-y-3">
						{invoices.map((invoice) => (
							<InvoiceRow
								key={invoice.id}
								invoice={invoice}
								onIssue={() => issueMutation.mutate(invoice.id)}
								onPdf={() => pdfMutation.mutate(invoice.id)}
								isBusy={
									issueMutation.isPending || pdfMutation.isPending
								}
							/>
						))}
					</div>
				)}
			</div>

			{createOpen ? (
				<CreateInvoiceModal
					onClose={() => setCreateOpen(false)}
					onSubmit={(payload) => createMutation.mutate(payload)}
					isPending={createMutation.isPending}
				/>
			) : null}
		</div>
	);
}

function InvoiceRow({
	invoice,
	onIssue,
	onPdf,
	isBusy,
}: {
	invoice: Invoice;
	onIssue: () => void;
	onPdf: () => void;
	isBusy: boolean;
}) {
	return (
		<div className="app-surface-card flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
			<div>
				<div className="flex flex-wrap items-center gap-2">
					<p className="text-sm font-semibold text-slate-900">{invoice.number}</p>
					<StatusChip status={invoice.status} />
				</div>
				<p className="mt-1 text-xs text-slate-500">
					{invoice.issue_date ? `Issued ${invoice.issue_date}` : "Not issued"} ·{" "}
					{invoice.due_date ? `Due ${invoice.due_date}` : "No due date"}
				</p>
				<p className="mt-1 text-sm text-slate-700">
					{invoice.currency} {Number(invoice.total ?? 0).toFixed(2)}
				</p>
			</div>
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={onPdf}
					disabled={isBusy}
					className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
				>
					<FileText className="h-3.5 w-3.5" />
					PDF
				</button>
				{invoice.status === "draft" ? (
					<button
						type="button"
						onClick={onIssue}
						disabled={isBusy}
						className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
					>
						Issue
					</button>
				) : null}
			</div>
		</div>
	);
}

function StatusChip({ status }: { status: InvoiceStatus }) {
	const classes: Record<InvoiceStatus, string> = {
		draft: "bg-slate-100 text-slate-700 border-slate-200",
		issued: "bg-amber-100 text-amber-700 border-amber-200",
		sent: "bg-sky-100 text-sky-700 border-sky-200",
		paid: "bg-emerald-100 text-emerald-700 border-emerald-200",
		void: "bg-rose-100 text-rose-700 border-rose-200",
	};
	return (
		<span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${classes[status]}`}>
			{status}
		</span>
	);
}

function CreateInvoiceModal({
	onClose,
	onSubmit,
	isPending,
}: {
	onClose: () => void;
	onSubmit: (payload: {
		notes?: string;
		due_date?: string;
		attach_hours: boolean;
		line_items?: InvoiceLineItemInput[];
	}) => void;
	isPending: boolean;
}) {
	const [notes, setNotes] = useState("");
	const [dueDate, setDueDate] = useState("");
	const [description, setDescription] = useState("");
	const [quantity, setQuantity] = useState("1");
	const [rate, setRate] = useState("0");
	const [attachHours, setAttachHours] = useState(false);

	return (
		<ModalPortal>
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
			onClick={onClose}
		>
			<div
				className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				<h2 className="text-lg font-semibold text-slate-900">Create Invoice</h2>
				<form
					className="mt-4 space-y-3"
					onSubmit={(e) => {
						e.preventDefault();
						const quantityValue = Number(quantity || 0);
						const rateValue = Number(rate || 0);
						const hasManualLine =
							description.trim().length > 0 &&
							quantityValue > 0 &&
							rateValue >= 0;
						onSubmit({
							notes: notes.trim() || undefined,
							due_date: dueDate || undefined,
							attach_hours: attachHours,
							line_items: hasManualLine
								? [
										{
											description: description.trim(),
											quantity: quantityValue,
											unit_rate: rateValue,
										},
									]
								: undefined,
						});
					}}
				>
					<label className="block">
						<span className="text-xs font-semibold text-slate-600">Due date</span>
						<input
							type="date"
							value={dueDate}
							onChange={(e) => setDueDate(e.target.value)}
							className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="block">
						<span className="text-xs font-semibold text-slate-600">Notes</span>
						<textarea
							value={notes}
							onChange={(e) => setNotes(e.target.value)}
							rows={2}
							className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
						/>
					</label>
					<div className="rounded-lg border border-slate-200 p-3">
						<p className="text-xs font-semibold text-slate-700">Manual line item</p>
						<div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
							<input
								placeholder="Description"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-3"
							/>
							<input
								type="number"
								min={0}
								step="0.01"
								value={quantity}
								onChange={(e) => setQuantity(e.target.value)}
								placeholder="Qty"
								className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
							/>
							<input
								type="number"
								min={0}
								step="0.01"
								value={rate}
								onChange={(e) => setRate(e.target.value)}
								placeholder="Rate"
								className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
							/>
						</div>
					</div>
					<label className="flex items-center gap-2 text-sm text-slate-700">
						<input
							type="checkbox"
							checked={attachHours}
							onChange={(e) => setAttachHours(e.target.checked)}
						/>
						Attach approved hours
					</label>
					<div className="flex justify-end gap-2 pt-1">
						<button
							type="button"
							onClick={onClose}
							className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={isPending}
							className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
						>
							{isPending ? "Creating..." : "Create"}
						</button>
					</div>
				</form>
			</div>
		</div>
		</ModalPortal>
	);
}
