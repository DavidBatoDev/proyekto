import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	type FinanceContractsSearch,
	pageValue,
	stringValue,
	validateContractStep,
	validateFinanceSharedSearch,
} from "@/components/finance/portfolio/financeSearch";

/**
 * Redirect stub: contracts are listed only in Engagements → Contracts. The
 * `?projectId&step` notification deep link is forwarded intact.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/contracts",
)({
	validateSearch: (
		search: Record<string, unknown>,
	): FinanceContractsSearch => ({
		...validateFinanceSharedSearch(search),
		contractStatus: stringValue(search.contractStatus),
		step: validateContractStep(search.step),
		page: pageValue(search.page),
	}),
	beforeLoad: ({ search }) => {
		throw redirect({
			to: "/engagements/contracts",
			search: {
				view: search.step ? "authored" : undefined,
				projectId: search.projectId,
				contractStatus: search.contractStatus,
				step: search.step,
			},
			replace: true,
		});
	},
});
