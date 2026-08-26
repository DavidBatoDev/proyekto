import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	type ContractEditorSearch,
	validateContractStep,
} from "@/components/finance/portfolio/financeSearch";

/**
 * Redirect stub: `/marketplace/finance/<id>` → `/engagements/finance/<id>`.
 *
 * `contracts.service.ts` wrote exactly this URL shape into
 * `notifications.link_url` before the move, and rows already exist with it.
 */
export const Route = createFileRoute("/marketplace/finance/$contractId")({
	validateSearch: (search: Record<string, unknown>): ContractEditorSearch => ({
		section: validateContractStep(search.section),
	}),
	beforeLoad: ({ params, search }) => {
		throw redirect({
			to: "/engagements/finance/$contractId",
			params: { contractId: params.contractId },
			search,
		});
	},
});
