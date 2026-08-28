import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { ProjectFinancials } from "@/components/finance/ProjectFinancials";
import {
	type FinanceOverviewSearch,
	legacyTabRoute,
	stringValue,
	validateFinanceSharedSearch,
} from "@/components/finance/portfolio/financeSearch";
import { PortfolioOverview } from "@/components/finance/portfolio/PortfolioOverview";
import { useFinanceProjectOptions } from "@/components/finance/portfolio/useFinanceProjectOptions";
import { isActiveConsultant } from "@/lib/auth-utils";
import { financeService } from "@/services/finance.service";
import { useProfile } from "@/stores/authStore";

/**
 * Portfolio overview, and the landing point for the legacy `?tab=` URLs.
 *
 * The four sections were `?tab=` values on this one route until they became
 * addressable. `tab` therefore stays declared here purely so `beforeLoad` can
 * see it and forward: the invoice scheduler wrote
 * `/marketplace/finance?tab=invoices&projectId=…` into notification rows that
 * cannot be rewritten, and users have the old URLs bookmarked. Rendering the
 * overview for those would silently show the wrong section, which is worse than
 * a redirect.
 */
export const Route = createFileRoute("/marketplace/finance/_portfolio/")({
	validateSearch: (search: Record<string, unknown>): FinanceOverviewSearch => ({
		...validateFinanceSharedSearch(search),
		tab: stringValue(search.tab),
	}),
	beforeLoad: ({ search }) => {
		const to = legacyTabRoute(search.tab);
		if (to) {
			throw redirect({
				to,
				search: {
					q: search.q,
					projectId: search.projectId,
					projectStatus: search.projectStatus,
					currency: search.currency,
					from: search.from,
					to: search.to,
				},
			});
		}
	},
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
					to: "/marketplace/finance",
					search: { ...search, projectId },
					replace: true,
				})
			}
		/>
	);
}
