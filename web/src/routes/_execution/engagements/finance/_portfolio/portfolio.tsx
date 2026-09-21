import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ProjectFinancials } from "@/components/finance/ProjectFinancials";
import {
	type FinanceSharedSearch,
	validateFinanceSharedSearch,
} from "@/components/finance/portfolio/financeSearch";
import { PortfolioOverview } from "@/components/finance/portfolio/PortfolioOverview";
import { useFinanceProjectOptions } from "@/components/finance/portfolio/useFinanceProjectOptions";
import { isActiveConsultant } from "@/lib/auth-utils";
import { financeService } from "@/services/finance.service";
import { useProfile } from "@/stores/authStore";

/**
 * The consultant portfolio — the cross-project rollup.
 *
 * This used to be the finance landing page, with the book hub stacked above
 * it; the landing page is now the launcher at `/engagements/finance`, and the
 * rollup lives here as a destination of its own. Picking a project drills
 * into that project's financials in place of the rollup.
 *
 * Consultant-only by content, not by guard: the numbers come from
 * `/api/finance/portfolio`, which requires active consultant capability, so a
 * non-consultant reaching this URL simply sees the empty portfolio state.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/_portfolio/portfolio",
)({
	validateSearch: (search: Record<string, unknown>): FinanceSharedSearch =>
		validateFinanceSharedSearch(search),
	component: PortfolioPage,
});

function PortfolioPage() {
	const search = Route.useSearch();
	const navigate = useNavigate();
	const profile = useProfile();
	const isConsultant = isActiveConsultant(profile);

	const portfolioQuery = useQuery({
		queryKey: [
			"finance",
			"portfolio",
			{
				q: search.q,
				project_id: search.projectId,
				project_status: search.projectStatus,
				currency: search.currency,
				from: search.from,
				to: search.to,
			},
		],
		queryFn: () =>
			financeService.portfolio({
				q: search.q,
				project_id: search.projectId,
				project_status: search.projectStatus,
				currency: search.currency,
				from: search.from,
				to: search.to,
			}),
		enabled: isConsultant,
	});
	// Keeps the layout's project facet warm on a direct hit to this URL.
	useFinanceProjectOptions(search, isConsultant);

	// A picked project drills into that project's financials in place of the
	// rollup — the layout renders the back affordance.
	if (isConsultant && search.projectId) {
		return <ProjectFinancials projectId={search.projectId} />;
	}

	return (
		<div className="pb-8">
			<PortfolioOverview
				loading={portfolioQuery.isPending}
				portfolio={portfolioQuery.data}
				onOpen={(projectId) =>
					void navigate({
						to: "/engagements/finance/portfolio",
						search: { ...search, projectId },
						replace: true,
					})
				}
			/>
		</div>
	);
}
