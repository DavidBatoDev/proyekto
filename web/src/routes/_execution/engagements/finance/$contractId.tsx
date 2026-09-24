import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	type ContractEditorSearch,
	validateContractStep,
} from "@/components/finance/portfolio/financeSearch";

/**
 * Redirect stub: the contract editor moved to `/engagements/contracts/<id>`.
 * Notification rows (`notifications.link_url`) and emails still carry this
 * shape, so it forwards — keeping `?section=`.
 *
 * Static finance paths (`/finance/teams`, `/finance/shared`, …) outrank this
 * dynamic segment, so only unknown segments land here.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/$contractId",
)({
	validateSearch: (search: Record<string, unknown>): ContractEditorSearch => ({
		section: validateContractStep(search.section),
	}),
	beforeLoad: ({ params, search }) => {
		throw redirect({
			to: "/engagements/contracts/$contractId",
			params: { contractId: params.contractId },
			search: { section: search.section },
			replace: true,
		});
	},
});
