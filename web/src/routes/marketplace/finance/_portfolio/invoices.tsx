import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	type FinanceInvoicesSearch,
	pageValue,
	stringValue,
	validateFinanceSharedSearch,
} from "@/components/finance/portfolio/financeSearch";

/** Redirect stub: `/marketplace/finance/invoices` → `/engagements/finance/invoices`. */
export const Route = createFileRoute(
	"/marketplace/finance/_portfolio/invoices",
)({
	validateSearch: (search: Record<string, unknown>): FinanceInvoicesSearch => ({
		...validateFinanceSharedSearch(search),
		invoiceStatus: stringValue(search.invoiceStatus),
		page: pageValue(search.page),
	}),
	beforeLoad: ({ search }) => {
		throw redirect({ to: "/engagements/finance/invoices", search });
	},
});
