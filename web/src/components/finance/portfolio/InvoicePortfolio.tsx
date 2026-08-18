import { ChevronRight, ReceiptText } from "lucide-react";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import { formatCurrency } from "@/lib/currency";
import type { FinanceInvoiceSummary } from "@/services/finance.service";
import {
	FinanceLoading,
	FinanceSectionHeading,
	FinanceStatusBadge,
	NoFinanceData,
} from "./FinancePrimitives";

export function InvoicePortfolio({
	loading,
	items,
	onOpen,
}: {
	loading: boolean;
	items: FinanceInvoiceSummary[];
	onOpen: (id: string) => void;
}) {
	if (loading) return <FinanceLoading />;
	if (!items.length) return <NoFinanceData />;
	return (
		<div className="space-y-5 pb-8">
			<FinanceSectionHeading
				eyebrow="Invoice portfolio"
				title="Client billing"
				description="Track invoices across projects, then open a project to issue or manage them."
				count={`${items.length} ${items.length === 1 ? "invoice" : "invoices"}`}
			/>
			<AppSurfaceCard className="divide-y divide-border overflow-hidden">
				{items.map((item) => (
					<button
						type="button"
						key={item.id}
						onClick={() => item.project_id && onOpen(item.project_id)}
						disabled={!item.project_id}
						className="group flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-muted/40 disabled:cursor-default disabled:hover:bg-transparent md:px-5 md:py-4"
					>
						<span className="flex min-w-0 items-center gap-3">
							<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
								<ReceiptText className="h-5 w-5" />
							</span>
							<span className="min-w-0">
								<span className="block truncate font-semibold text-foreground">
									{item.number} ·{" "}
									{item.project?.title ??
										item.project_title_snapshot ??
										"Project removed"}
								</span>
								<span className="mt-1 block truncate text-xs text-muted-foreground">
									{item.due_date ? `Due ${item.due_date}` : "No due date"} ·{" "}
									{item.origin}
								</span>
							</span>
						</span>
						<span className="flex shrink-0 items-center gap-3">
							<span className="text-right">
								<span className="block font-semibold text-foreground tabular-nums">
									{formatCurrency(item.total, item.currency)}
								</span>
								<span className="mt-1 hidden sm:block">
									<FinanceStatusBadge status={item.status} />
								</span>
							</span>
							<ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
						</span>
					</button>
				))}
			</AppSurfaceCard>
		</div>
	);
}
