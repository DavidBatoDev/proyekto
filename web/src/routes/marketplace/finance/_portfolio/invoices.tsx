import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ProjectInvoices } from "@/components/finance/ProjectInvoices";
import {
	type FinanceInvoicesSearch,
	stringValue,
	validateFinanceSharedSearch,
} from "@/components/finance/portfolio/financeSearch";
import { InvoicePortfolio } from "@/components/finance/portfolio/InvoicePortfolio";
import { isActiveConsultant } from "@/lib/auth-utils";
import { financeService } from "@/services/finance.service";
import { useProfile } from "@/stores/authStore";

/**
 * The invoice portfolio, and the project-scoped invoice workspace.
 *
 * Selecting a project swaps the cross-project list for that project's own
 * invoice management, which is where issuing and editing happen — the list
 * itself is read-only by design.
 */
export const Route = createFileRoute(
	"/marketplace/finance/_portfolio/invoices",
)({
	validateSearch: (search: Record<string, unknown>): FinanceInvoicesSearch => ({
		...validateFinanceSharedSearch(search),
		invoiceStatus: stringValue(search.invoiceStatus),
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
	const invoicesQuery = useQuery({
		queryKey: ["finance", "invoices", filters, search.invoiceStatus],
		queryFn: () =>
			financeService.invoices({
				...filters,
				invoice_status: search.invoiceStatus,
			}),
		enabled: isConsultant && !search.projectId,
	});

	if (search.projectId) {
		return <ProjectInvoices projectId={search.projectId} />;
	}

	return (
		<InvoicePortfolio
			loading={invoicesQuery.isPending}
			items={invoicesQuery.data?.items ?? []}
			onOpen={(projectId) =>
				void navigate({
					to: "/marketplace/finance/invoices",
					search: { ...search, projectId },
					replace: true,
				})
			}
		/>
	);
}
