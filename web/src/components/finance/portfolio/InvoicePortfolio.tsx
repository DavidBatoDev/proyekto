import { ChevronRight, Download, ReceiptText, Unlink } from "lucide-react";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import { formatCurrency } from "@/lib/currency";
import { effectiveInvoiceStatus } from "@/lib/finance-status";
import type { FinanceInvoiceSummary } from "@/services/finance.service";
import {
	countLabel,
	FinanceLoading,
	FinancePager,
	FinanceSectionHeading,
	FinanceStatusBadge,
	formatFinanceDate,
	NoFinanceData,
} from "./FinancePrimitives";

export function InvoicePortfolio({
	loading,
	items,
	total,
	page,
	limit,
	onPageChange,
	onOpenProject,
	onExport,
}: {
	loading: boolean;
	items: FinanceInvoiceSummary[];
	total: number;
	page: number;
	limit: number;
	onPageChange: (page: number) => void;
	onOpenProject: (projectId: string) => void;
	onExport: () => void;
}) {
	if (loading) return <FinanceLoading />;
	if (!items.length) return <NoFinanceData />;

	const outstanding = new Map<string, number>();
	for (const item of items) {
		if (item.balance_due > 0) {
			outstanding.set(
				item.currency,
				(outstanding.get(item.currency) ?? 0) + item.balance_due,
			);
		}
	}

	return (
		<div className="space-y-4 pb-8">
			<FinanceSectionHeading
				eyebrow="Invoice portfolio"
				title="Client billing"
				description="Every invoice across your projects. Open a project to issue or settle them."
				count={countLabel(total, "invoice")}
				actions={
					<button
						type="button"
						onClick={onExport}
						title="Download the invoices on this page as CSV"
						className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
					>
						<Download className="h-3.5 w-3.5" /> Export CSV
					</button>
				}
			/>

			{outstanding.size > 0 && (
				<div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
					<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Outstanding on this page
					</span>
					{[...outstanding.entries()].map(([currency, amount]) => (
						<span
							key={currency}
							className="text-sm font-bold text-foreground tabular-nums"
						>
							{formatCurrency(amount, currency)}
						</span>
					))}
				</div>
			)}

			<AppSurfaceCard className="divide-y divide-border overflow-hidden">
				{items.map((item) => (
					<InvoiceRow key={item.id} item={item} onOpenProject={onOpenProject} />
				))}
			</AppSurfaceCard>

			<FinancePager
				page={page}
				limit={limit}
				total={total}
				onChange={onPageChange}
			/>
		</div>
	);
}

function InvoiceRow({
	item,
	onOpenProject,
}: {
	item: FinanceInvoiceSummary;
	onOpenProject: (projectId: string) => void;
}) {
	const severed = !item.project_id;
	const status = effectiveInvoiceStatus(item);
	const title = `${item.number} · ${item.project?.title ?? item.project_title_snapshot ?? "Project removed"}`;

	const body = (
		<>
			<span className="flex min-w-0 items-center gap-3">
				<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
					<ReceiptText className="h-5 w-5" />
				</span>
				<span className="min-w-0">
					<span className="flex min-w-0 items-center gap-2">
						<span className="truncate font-semibold text-foreground">
							{title}
						</span>
						{severed && (
							<span
								title="This invoice's project has been deleted, so there is no project workspace to open. The invoice itself is intact."
								className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground"
							>
								<Unlink className="h-2.5 w-2.5" /> Detached
							</span>
						)}
					</span>
					<span className="mt-1 block truncate text-xs text-muted-foreground">
						{describeDates(item)} · {item.origin}
					</span>
				</span>
			</span>
			<span className="flex shrink-0 items-center gap-3">
				<span className="text-right">
					<span className="block font-semibold text-foreground tabular-nums">
						{formatCurrency(item.total, item.currency)}
					</span>
					{item.balance_due > 0 && item.balance_due !== item.total && (
						<span className="block text-[11px] text-muted-foreground tabular-nums">
							{formatCurrency(item.balance_due, item.currency)} due
						</span>
					)}
				</span>
				<FinanceStatusBadge status={status} />
				{!severed && (
					<ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
				)}
			</span>
		</>
	);

	// A severed invoice has no project workspace to open, so it renders as a
	// plain row with an explanation rather than a dead disabled button — which
	// is what it used to be, with nothing to say why it would not respond.
	if (severed) {
		return (
			<div className="flex w-full items-center justify-between gap-4 p-4 text-left md:px-5 md:py-4">
				{body}
			</div>
		);
	}

	return (
		<button
			type="button"
			onClick={() => onOpenProject(item.project_id as string)}
			className="group flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-muted/40 md:px-5 md:py-4"
		>
			{body}
		</button>
	);
}

function describeDates(item: FinanceInvoiceSummary): string {
	if (item.status === "draft") {
		return item.due_date
			? `Draft · due ${formatFinanceDate(item.due_date)}`
			: "Draft";
	}
	if (item.is_overdue) {
		return `${item.days_overdue} ${item.days_overdue === 1 ? "day" : "days"} overdue`;
	}
	const due = formatFinanceDate(item.due_date);
	if (due) return `Due ${due}`;
	const issued = formatFinanceDate(item.issue_date);
	return issued ? `Issued ${issued}` : "No due date";
}
