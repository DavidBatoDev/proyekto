import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, HandCoins, ReceiptText } from "lucide-react";
import { useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import {
	FinanceLoading,
	FinanceStatusBadge,
} from "@/components/finance/portfolio/FinancePrimitives";
import { InvoicePreview } from "@/components/invoices/InvoicePreview";
import {
	invoiceService,
	type ReceivedInvoiceSummary,
} from "@/services/invoice.service";
import { profileService } from "@/services/profile.service";
import { useProfile } from "@/stores/authStore";

/**
 * The caller's marketplace rate card, when they keep one. A client account
 * has no rate settings and simply does not meet this card.
 */
export function MyRateCard() {
	const profile = useProfile();
	const fullProfileQuery = useQuery({
		queryKey: ["profile", "full", profile?.id],
		queryFn: () => profileService.getProfile(profile?.id as string),
		enabled: Boolean(profile?.id),
		staleTime: 60_000,
	});
	const rate = fullProfileQuery.data?.rate_settings;
	if (!rate || rate.hourly_rate == null) return null;

	return (
		<section className="mt-8">
			<h2 className="text-base font-semibold text-foreground">Your rate</h2>
			<p className="mb-3 mt-0.5 text-sm text-muted-foreground">
				Your marketplace rate card. Team rates are set by each team.
			</p>
			<AppSurfaceCard className="overflow-hidden">
				<div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5">
					<div className="flex min-w-0 items-center gap-3">
						<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
							<HandCoins className="h-5 w-5" />
						</span>
						<div className="min-w-0">
							<p className="text-sm font-semibold text-foreground">
								Default rate · {rate.hourly_rate.toLocaleString()}{" "}
								{rate.currency}
								/hr
							</p>
							<p className="text-xs text-muted-foreground">
								Shown on your marketplace profile
								{rate.availability
									? ` · ${rate.availability.replace(/_/g, " ")}`
									: ""}
							</p>
						</div>
					</div>
					<Link
						to="/profile/$profileId"
						params={{ profileId: profile?.id as string }}
						className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
					>
						Edit
					</Link>
				</div>
			</AppSurfaceCard>
		</section>
	);
}

/**
 * Money out — every invoice billed TO the caller. The payer's side of the
 * ledger, which used to reach them only as email. A row opens the same
 * document facsimile the issuer works against, plus the PDF when one exists.
 */
export function InvoicesToPaySection() {
	const [openInvoice, setOpenInvoice] = useState<ReceivedInvoiceSummary | null>(
		null,
	);
	const receivedQuery = useQuery({
		queryKey: ["invoices", "received"],
		queryFn: () => invoiceService.listReceived(),
	});
	const items = receivedQuery.data ?? [];
	if (items.length === 0) return null;

	const outstanding = items.reduce(
		(sum, invoice) => sum + invoice.balance_due,
		0,
	);
	const currency = items[0]?.currency ?? "";
	const overdueCount = items.filter((invoice) => invoice.is_overdue).length;

	return (
		<>
			<h2 className="mt-8 text-base font-semibold text-foreground">
				Invoices to pay
			</h2>
			<p className="mt-0.5 text-sm text-muted-foreground">
				{outstanding > 0
					? `${outstanding.toLocaleString()} ${currency} outstanding${overdueCount > 0 ? ` · ${overdueCount} past due` : ""}.`
					: "Everything billed to you is settled."}
			</p>
			<AppSurfaceCard className="mt-3 divide-y divide-border overflow-hidden">
				{items.map((invoice) => (
					<button
						key={invoice.id}
						type="button"
						onClick={() => setOpenInvoice(invoice)}
						className="group flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-muted/40 md:px-5"
					>
						<span className="flex min-w-0 items-center gap-3">
							<span
								className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
									invoice.is_overdue
										? "bg-destructive/10 text-destructive"
										: "bg-muted text-muted-foreground"
								}`}
							>
								<ReceiptText className="h-5 w-5" />
							</span>
							<span className="min-w-0">
								<span className="block truncate text-sm font-semibold text-foreground">
									{invoice.number} · {invoice.total.toLocaleString()}{" "}
									{invoice.currency}
								</span>
								<span className="mt-0.5 block truncate text-xs text-muted-foreground">
									{invoice.issued_by_name ?? "—"}
									{invoice.project_title ? ` · ${invoice.project_title}` : ""}
									{invoice.is_overdue
										? ` · ${invoice.days_overdue} days late`
										: invoice.due_date
											? ` · due ${new Date(`${invoice.due_date}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
											: ""}
									{invoice.balance_due > 0 && invoice.amount_paid > 0
										? ` · ${invoice.balance_due.toLocaleString()} ${invoice.currency} open`
										: ""}
								</span>
							</span>
						</span>
						<FinanceStatusBadge
							status={invoice.is_overdue ? "overdue" : invoice.status}
							className="shrink-0"
						/>
					</button>
				))}
			</AppSurfaceCard>

			<ReceivedInvoiceDialog
				invoice={openInvoice}
				onClose={() => setOpenInvoice(null)}
			/>
		</>
	);
}

function ReceivedInvoiceDialog({
	invoice,
	onClose,
}: {
	invoice: ReceivedInvoiceSummary | null;
	onClose: () => void;
}) {
	const detailQuery = useQuery({
		queryKey: ["invoices", "received", invoice?.id],
		queryFn: () => invoiceService.getReceived(invoice?.id as string),
		enabled: Boolean(invoice),
	});
	const [pdfBusy, setPdfBusy] = useState(false);
	const detail = detailQuery.data;

	const openPdf = async () => {
		if (!invoice) return;
		setPdfBusy(true);
		try {
			const { url } = await invoiceService.getPdfUrl(invoice.id);
			window.open(url, "_blank", "noopener");
		} finally {
			setPdfBusy(false);
		}
	};

	return (
		<AppDialog
			open={Boolean(invoice)}
			onClose={onClose}
			title={invoice ? `Invoice ${invoice.number}` : ""}
			size="lg"
			footer={
				<div className="flex w-full items-center justify-between gap-4">
					<span className="text-xs text-muted-foreground">
						Questions about this invoice go to the consultant who issued it.
					</span>
					<div className="flex items-center gap-2">
						{invoice?.has_pdf && (
							<button
								type="button"
								disabled={pdfBusy}
								onClick={() => void openPdf()}
								className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-60"
							>
								<Download className="h-4 w-4" />
								{pdfBusy ? "Opening…" : "PDF"}
							</button>
						)}
						<button
							type="button"
							onClick={onClose}
							className="app-cta inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold text-white"
						>
							Done
						</button>
					</div>
				</div>
			}
		>
			{detailQuery.isPending ? (
				<FinanceLoading />
			) : detailQuery.isError || !detail ? (
				<p className="py-6 text-sm text-muted-foreground">
					Could not load this invoice.
				</p>
			) : (
				<div className="max-h-[60vh] overflow-y-auto rounded-xl border border-border">
					<InvoicePreview
						number={detail.number}
						currency={detail.currency}
						issueDate={detail.issue_date}
						dueDate={detail.due_date}
						periodStart={detail.period_start}
						periodEnd={detail.period_end}
						issuedBy={detail.issued_by}
						billTo={detail.bill_to}
						paymentMethod={detail.payment_method}
						notes={detail.notes}
						lines={detail.line_items.map((line) => ({
							description: line.description,
							quantity: line.quantity,
							unit_rate: line.unit_rate,
							isHours: line.is_hours,
						}))}
						status={detail.status}
						amountPaid={detail.amount_paid}
						isOverdue={detail.is_overdue}
					/>
				</div>
			)}
		</AppDialog>
	);
}
