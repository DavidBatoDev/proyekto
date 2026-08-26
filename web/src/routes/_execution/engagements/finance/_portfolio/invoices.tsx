import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ProjectInvoices } from "@/components/finance/ProjectInvoices";
import {
	FINANCE_PAGE_SIZE,
	type FinanceInvoicesSearch,
	pageValue,
	stringValue,
	validateFinanceSharedSearch,
} from "@/components/finance/portfolio/financeSearch";
import { InvoicePortfolio } from "@/components/finance/portfolio/InvoicePortfolio";
import { useToast } from "@/hooks/useToast";
import { isActiveConsultant } from "@/lib/auth-utils";
import { type CsvColumn, downloadCsv, toCsv } from "@/lib/csv-export";
import {
	effectiveInvoiceStatus,
	financeStatusMeta,
} from "@/lib/finance-status";
import {
	type FinanceInvoiceSummary,
	financeService,
} from "@/services/finance.service";
import { useProfile } from "@/stores/authStore";

/**
 * The invoice portfolio, and the project-scoped invoice workspace.
 *
 * Selecting a project swaps the cross-project list for that project's own
 * invoice management, which is where issuing and editing happen — the list
 * itself is read-only by design.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/_portfolio/invoices",
)({
	validateSearch: (search: Record<string, unknown>): FinanceInvoicesSearch => ({
		...validateFinanceSharedSearch(search),
		invoiceStatus: stringValue(search.invoiceStatus),
		page: pageValue(search.page),
	}),
	component: FinanceInvoicesPage,
});

function FinanceInvoicesPage() {
	const search = Route.useSearch();
	const navigate = useNavigate();
	const profile = useProfile();
	const isConsultant = isActiveConsultant(profile);

	const filters = {
		q: search.q,
		project_id: search.projectId,
		project_status: search.projectStatus,
		currency: search.currency,
		from: search.from,
		to: search.to,
	};
	const page = search.page ?? 1;
	const invoicesQuery = useQuery({
		queryKey: ["finance", "invoices", filters, search.invoiceStatus, page],
		queryFn: () =>
			financeService.invoices({
				...filters,
				invoice_status: search.invoiceStatus,
				page,
				limit: FINANCE_PAGE_SIZE,
			}),
		enabled: isConsultant && !search.projectId,
	});
	const toast = useToast();

	const updateSearch = (patch: Partial<FinanceInvoicesSearch>) =>
		void navigate({
			to: "/engagements/finance/invoices",
			search: { ...search, ...patch },
			replace: true,
		});

	// Exports the page in front of the reader rather than refetching every match:
	// the rows are already here, and a silent second query would export a set the
	// filters on screen do not describe.
	const exportInvoices = () => {
		const rows = invoicesQuery.data?.items ?? [];
		if (rows.length === 0) {
			toast.error("Nothing to export on this page");
			return;
		}
		downloadCsv(
			`proyekto-invoices-${new Date().toISOString().slice(0, 10)}.csv`,
			toCsv(rows, INVOICE_CSV_COLUMNS),
		);
	};

	if (search.projectId) {
		return <ProjectInvoices projectId={search.projectId} />;
	}

	return (
		<InvoicePortfolio
			loading={invoicesQuery.isPending}
			items={invoicesQuery.data?.items ?? []}
			total={invoicesQuery.data?.total ?? 0}
			page={page}
			limit={FINANCE_PAGE_SIZE}
			onPageChange={(next) => updateSearch({ page: next })}
			onOpenProject={(projectId) => updateSearch({ projectId })}
			onExport={exportInvoices}
		/>
	);
}

const INVOICE_CSV_COLUMNS: CsvColumn<FinanceInvoiceSummary>[] = [
	{ header: "Number", value: (row) => row.number },
	{
		header: "Project",
		value: (row) => row.project?.title ?? row.project_title_snapshot ?? "",
	},
	{
		header: "Status",
		value: (row) => financeStatusMeta(effectiveInvoiceStatus(row)).label,
	},
	{ header: "Currency", value: (row) => row.currency },
	{ header: "Total", value: (row) => row.total.toFixed(2) },
	{ header: "Paid", value: (row) => row.amount_paid.toFixed(2) },
	{ header: "Balance due", value: (row) => row.balance_due.toFixed(2) },
	{ header: "Issue date", value: (row) => row.issue_date ?? "" },
	{ header: "Due date", value: (row) => row.due_date ?? "" },
	{ header: "Days overdue", value: (row) => row.days_overdue },
	{ header: "Period start", value: (row) => row.period_start ?? "" },
	{ header: "Period end", value: (row) => row.period_end ?? "" },
	{ header: "Origin", value: (row) => row.origin },
];
