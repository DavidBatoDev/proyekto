import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	type FinanceOverviewSearch,
	legacyTabRoute,
	stringValue,
	validateFinanceSharedSearch,
} from "@/components/finance/portfolio/financeSearch";

/**
 * Redirect stub: `/marketplace/finance` → `/engagements/finance`.
 *
 * Also the landing point for the even older `?tab=` URLs: the invoice
 * scheduler wrote `/marketplace/finance?tab=invoices&projectId=…` into
 * notification rows that cannot be rewritten, so the tab is translated to its
 * section route here before the bounce.
 */
export const Route = createFileRoute("/marketplace/finance/_portfolio/")({
	validateSearch: (search: Record<string, unknown>): FinanceOverviewSearch => ({
		...validateFinanceSharedSearch(search),
		tab: stringValue(search.tab),
	}),
	beforeLoad: ({ search }) => {
		const shared = {
			q: search.q,
			projectId: search.projectId,
			projectStatus: search.projectStatus,
			currency: search.currency,
			from: search.from,
			to: search.to,
		};
		const to = legacyTabRoute(search.tab);
		if (to) {
			throw redirect({ to, search: shared });
		}
		throw redirect({ to: "/engagements/finance", search: shared });
	},
});
