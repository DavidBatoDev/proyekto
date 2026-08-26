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
import { TeamFinanceChrome } from "@/components/finance/team/TeamFinanceChrome";
import { useTeamFinanceProjectOptions } from "@/components/finance/team/useTeamFinanceProjectOptions";
import { useToast } from "@/hooks/useToast";
import { type CsvColumn, downloadCsv, toCsv } from "@/lib/csv-export";
import {
	effectiveInvoiceStatus,
	financeStatusMeta,
} from "@/lib/finance-status";
import type { FinanceInvoiceSummary } from "@/services/finance.service";
import { teamFinanceService } from "@/services/teamFinance.service";

/**
 * One team's invoices. Selecting a project swaps in the full project invoice
 * workspace — issuing, editing, and payments included: the "HR" tier holds
 * `finance.manage_invoices`, and the invoice endpoints honour it.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/team/$teamId/invoices",
)({
	validateSearch: (search: Record<string, unknown>): FinanceInvoicesSearch => ({
		...validateFinanceSharedSearch(search),
		invoiceStatus: stringValue(search.invoiceStatus),
		page: pageValue(search.page),
	}),
	component: TeamFinanceInvoicesPage,
});

function TeamFinanceInvoicesPage() {
	const { teamId } = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate();
	const toast = useToast();

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
		queryKey: [
			"team-finance",
			"invoices",
			teamId,
			filters,
			search.invoiceStatus,
			page,
		],
		queryFn: () =>
			teamFinanceService.invoices(teamId, {
				...filters,
				invoice_status: search.invoiceStatus,
				page,
				limit: FINANCE_PAGE_SIZE,
			}),
		enabled: !search.projectId,
	});
	const projectOptionsQuery = useTeamFinanceProjectOptions(teamId, search);

	const updateSearch = (patch: Partial<FinanceInvoicesSearch>) =>
		void navigate({
			to: "/engagements/finance/team/$teamId/invoices",
			params: { teamId },
			search: { ...search, ...patch },
			replace: true,
		});

	const exportInvoices = () => {
		const rows = invoicesQuery.data?.items ?? [];
		if (rows.length === 0) {
			toast.error("Nothing to export on this page");
			return;
		}
		downloadCsv(
			`proyekto-team-invoices-${new Date().toISOString().slice(0, 10)}.csv`,
			toCsv(rows, INVOICE_CSV_COLUMNS),
		);
	};

	return (
		<TeamFinanceChrome
			teamId={teamId}
			section="invoices"
			search={search}
			projects={projectOptionsQuery.data?.projects ?? []}
			onChange={updateSearch}
		>
			{search.projectId ? (
				<ProjectInvoices projectId={search.projectId} />
			) : (
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
			)}
		</TeamFinanceChrome>
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
