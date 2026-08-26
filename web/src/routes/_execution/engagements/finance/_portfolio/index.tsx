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
 * Portfolio overview.
 *
 * The legacy `?tab=` URLs (and every other `/marketplace/finance` shape) land
 * on the redirect stubs left behind at the old paths, which translate the tab
 * before bouncing here — so this route no longer declares `tab` at all.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/_portfolio/",
)({
	validateSearch: (search: Record<string, unknown>): FinanceSharedSearch =>
		validateFinanceSharedSearch(search),
	component: FinanceOverviewPage,
});

function FinanceOverviewPage() {
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

	if (search.projectId) {
		return <ProjectFinancials projectId={search.projectId} />;
	}

	return (
		<PortfolioOverview
			loading={portfolioQuery.isPending}
			portfolio={portfolioQuery.data}
			onOpen={(projectId) =>
				void navigate({
					to: "/engagements/finance",
					search: { ...search, projectId },
					replace: true,
				})
			}
		/>
	);
}
