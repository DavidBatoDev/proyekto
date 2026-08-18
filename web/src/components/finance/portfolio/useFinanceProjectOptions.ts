import { useQuery } from "@tanstack/react-query";
import { financeService } from "@/services/finance.service";
import type { FinanceSearchState } from "./financeSearch";

/**
 * The project list backing the Project facet and the contract dialog.
 *
 * Deliberately keyed on only the filters that narrow the list itself, and NOT
 * on `projectId` — picking a project must not refetch the very list you picked
 * it from, or the facet empties while its own selection loads.
 *
 * Both the portfolio layout and the Contracts section call this. They share one
 * request because the query key is identical; splitting the sections into
 * separate routes did not split the fetch.
 */
export function useFinanceProjectOptions(
	search: FinanceSearchState,
	enabled: boolean,
) {
	return useQuery({
		queryKey: [
			"finance",
			"project-options",
			search.q,
			search.projectStatus,
			search.currency,
		],
		queryFn: () =>
			financeService.portfolio({
				q: search.q,
				project_status: search.projectStatus,
				currency: search.currency,
			}),
		enabled,
	});
}
