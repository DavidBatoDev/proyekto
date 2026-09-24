import { createFileRoute } from "@tanstack/react-router";
import { FinanceTrail } from "@/components/finance/nav/FinanceTrail";
import { ProjectHomeRedirect } from "@/components/finance/nav/ProjectHomeRedirect";
import { ProjectInvoices } from "@/components/finance/ProjectInvoices";
import { stringValue } from "@/components/finance/portfolio/financeSearch";

interface InvoicesSearch {
	projectId?: string;
}

/**
 * Legacy entry point (`/engagements/finance/invoices?projectId=…`, still
 * written by the invoice scheduler's notifications and the invoice builder's
 * back link). Forwards to the project's Invoices tab under its team; a project
 * without project finance yet keeps a plain invoice workspace here.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/invoices/",
)({
	validateSearch: (search: Record<string, unknown>): InvoicesSearch => ({
		projectId: stringValue(search.projectId),
	}),
	component: InvoicesEntry,
});

function InvoicesEntry() {
	const { projectId } = Route.useSearch();
	return (
		<ProjectHomeRedirect
			projectId={projectId}
			tab="invoices"
			teamTab="invoices"
			fallback={
				<div className="app-shell-bg min-h-full px-5 py-4 md:px-8 md:py-5">
					<div className="mx-auto w-full max-w-7xl pb-10">
						<FinanceTrail current="Project invoices" />
						<div className="mt-4">
							<ProjectInvoices projectId={projectId as string} />
						</div>
					</div>
				</div>
			}
		/>
	);
}
