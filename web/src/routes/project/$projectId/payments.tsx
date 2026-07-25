import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Download, FileText, Loader2, Pencil, ReceiptText } from "lucide-react";
import {
	AppEmptyState,
	AppSectionHeader,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { useToast } from "@/hooks/useToast";
import { invoiceHasClient, NO_CLIENT_HINT } from "@/lib/invoiceClient";
import {
	type Invoice,
	type InvoiceStatus,
	invoiceService,
} from "@/services/invoice.service";
import { projectService } from "@/services/project.service";

export const Route = createFileRoute("/project/$projectId/payments")({
	component: PaymentsPage,
});

function PaymentsPage() {
	const { projectId } = Route.useParams();
	const qc = useQueryClient();
	const toast = useToast();
	const navigate = useNavigate();

	const invoicesQuery = useQuery({
		queryKey: ["invoices", "project", projectId],
		queryFn: () => invoiceService.listByProject(projectId, { limit: 100 }),
	});

	// Needed to know whether the project has a real client, which gates issuing.
	const projectQuery = useQuery({
		queryKey: ["project", projectId],
		queryFn: () => projectService.get(projectId),
	});

	const issueMutation = useMutation({
		mutationFn: (invoiceId: string) => invoiceService.issue(invoiceId),
		onSuccess: () => {
			toast.success("Invoice issued");
			void qc.invalidateQueries({
				queryKey: ["invoices", "project", projectId],
			});
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const pdfMutation = useMutation({
		mutationFn: (invoiceId: string) => invoiceService.generatePdf(invoiceId),
		onSuccess: () => {
			toast.success("Invoice PDF generated");
			void qc.invalidateQueries({
				queryKey: ["invoices", "project", projectId],
			});
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
								onClick={() =>
									void navigate({
										to: "/project/$projectId/invoices/new",
										params: { projectId },
									})
								}
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
								projectId={projectId}
								canIssue={invoiceHasClient({
									recipientUserId: invoice.recipient_user_id,
									billToEmail: invoice.bill_to?.email,
									projectClientId: projectQuery.data?.client_id,
									projectConsultantId: projectQuery.data?.consultant_id,
								})}
								onIssue={() => issueMutation.mutate(invoice.id)}
								onPdf={() => pdfMutation.mutate(invoice.id)}
								onOpenPdf={() => openPdfMutation.mutate(invoice.id)}
								isBusy={
									issueMutation.isPending ||
									pdfMutation.isPending ||
									openPdfMutation.isPending
								}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

function InvoiceRow({
	invoice,
	projectId,
	canIssue,
	onIssue,
	onPdf,
	onOpenPdf,
	isBusy,
}: {
	invoice: Invoice;
	projectId: string;
	canIssue: boolean;
	onIssue: () => void;
	onPdf: () => void;
	onOpenPdf: () => void;
	isBusy: boolean;
}) {
	const navigate = useNavigate();
	return (
		<div className="app-surface-card flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
			<div>
				<div className="flex flex-wrap items-center gap-2">
					<p className="text-sm font-semibold text-slate-900">
						{invoice.number}
					</p>
					<StatusChip status={invoice.status} />
					{invoice.origin === "scheduled" && (
						<span className="rounded-full border border-sky-200 bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
							auto
						</span>
					)}
				</div>
				{invoice.period_start && invoice.period_end && (
					<p className="mt-1 text-xs font-medium text-slate-600">
						Covers {invoice.period_start} – {invoice.period_end}
					</p>
				)}
				<p className="mt-1 text-xs text-slate-500">
					{invoice.issue_date ? `Issued ${invoice.issue_date}` : "Not issued"} ·{" "}
					{invoice.due_date ? `Due ${invoice.due_date}` : "No due date"} ·{" "}
					{hoursDetailLabel(invoice.hours_detail_level)}
				</p>
				<p className="mt-1 text-sm text-slate-700">
					{invoice.currency} {Number(invoice.total ?? 0).toFixed(2)}
				</p>
			</div>
			<div className="flex items-center gap-2">
				{invoice.status === "draft" && (
					<button
						type="button"
						onClick={() =>
							void navigate({
								to: "/project/$projectId/invoices/$invoiceId/edit",
								params: { projectId, invoiceId: invoice.id },
							})
						}
						disabled={isBusy}
						className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
					>
						<Pencil className="h-3.5 w-3.5" />
						Edit
					</button>
				)}
				<button
					type="button"
					onClick={onPdf}
					disabled={isBusy}
					className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
				>
					<FileText className="h-3.5 w-3.5" />
					{invoice.pdf_path ? "Regenerate" : "Generate PDF"}
				</button>
				{invoice.pdf_path && (
					<button
						type="button"
						onClick={onOpenPdf}
						disabled={isBusy}
						className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
					>
						<Download className="h-3.5 w-3.5" />
						Open
					</button>
				)}
				{invoice.status === "draft" ? (
					<button
						type="button"
						onClick={onIssue}
						disabled={isBusy || !canIssue}
						title={canIssue ? undefined : NO_CLIENT_HINT}
						className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
					>
						Issue
					</button>
				) : null}
			</div>
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
		sent: "bg-sky-100 text-sky-700 border-sky-200",
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
