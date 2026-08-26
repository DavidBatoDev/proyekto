import { useQuery } from "@tanstack/react-query";
import type { FinanceSearchState } from "@/components/finance/portfolio/financeSearch";
import { teamFinanceService } from "@/services/teamFinance.service";

/**
 * The project list backing the team pages' Project facet.
 *
 * Mirrors `useFinanceProjectOptions`: keyed on only the filters that narrow
 * the list itself, and NOT on `projectId` — picking a project must not refetch
 * the very list you picked it from, or the facet empties while its own
 * selection loads.
 */
export function useTeamFinanceProjectOptions(
	teamId: string,
	search: FinanceSearchState,
) {
	return useQuery({
		queryKey: [
			"team-finance",
			"project-options",
			teamId,
			search.q,
			search.projectStatus,
			search.currency,
		],
		queryFn: () =>
			teamFinanceService.portfolio(teamId, {
				q: search.q,
				project_status: search.projectStatus,
				currency: search.currency,
			}),
	});
}
