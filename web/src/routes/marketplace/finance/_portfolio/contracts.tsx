import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	type FinanceContractsSearch,
	pageValue,
	stringValue,
	validateContractStep,
	validateFinanceSharedSearch,
} from "@/components/finance/portfolio/financeSearch";

/** Redirect stub: `/marketplace/finance/contracts` → `/engagements/finance/contracts`. */
export const Route = createFileRoute(
	"/marketplace/finance/_portfolio/contracts",
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
		throw redirect({ to: "/engagements/finance/contracts", search });
	},
});
