import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ProjectContract } from "@/components/finance/ProjectContract";
import {
	FINANCE_CRUMB_LINK_CLASS,
	FinanceBreadcrumbs,
	FinanceCurrentCrumb,
} from "@/components/finance/portfolio/FinanceBreadcrumbs";
import {
	type ContractEditorSearch,
	validateContractStep,
} from "@/components/finance/portfolio/financeSearch";

/**
 * The contract document editor.
 *
 * Deliberately a sibling of the `_portfolio` layout rather than a child: this
 * is a full-page document, and inheriting the section tab bar and filter
 * toolbar would frame an agreement as a filtered list view. Auth and the
 * marketplace shell still come from `finance/route.tsx` above it.
 *
 * Its URL keeps the bare `/marketplace/finance/<id>` shape even though the
 * sections now sit beside it, because `contracts.service.ts` writes exactly
 * that string into `notifications.link_url` and rows already exist with it.
 * Static section names win over the dynamic segment in the router's ranking, so
 * `/marketplace/finance/contracts` still resolves to the list.
 */
export const Route = createFileRoute("/marketplace/finance/$contractId")({
	validateSearch: (search: Record<string, unknown>): ContractEditorSearch => ({
		section: validateContractStep(search.section),
	}),
	component: ContractEditorPage,
});

function ContractEditorPage() {
	const { contractId } = Route.useParams();
	const { section } = Route.useSearch();
	const navigate = useNavigate();

	return (
		<div className="app-shell-bg min-h-full">
			<div className="px-5 pt-4 md:px-8 md:pt-5">
				<FinanceBreadcrumbs
					items={[
						<Link
							key="marketplace"
							to="/marketplace"
							className={FINANCE_CRUMB_LINK_CLASS}
						>
							Marketplace
						</Link>,
						<Link
							key="finance"
							to="/marketplace/finance"
							className={FINANCE_CRUMB_LINK_CLASS}
						>
							Finance
						</Link>,
						<Link
							key="contracts"
							to="/marketplace/finance/contracts"
							className={FINANCE_CRUMB_LINK_CLASS}
						>
							Contracts
						</Link>,
						<FinanceCurrentCrumb key="contract">Contract</FinanceCurrentCrumb>,
					]}
				/>
			</div>
			<ProjectContract
				contractId={contractId}
				initialStep={section}
				onBack={() => void navigate({ to: "/marketplace/finance/contracts" })}
				onOpenContract={(nextContractId) =>
					void navigate({
						to: "/marketplace/finance/$contractId",
						params: { contractId: nextContractId },
						search: { section: "terms" },
						replace: true,
					})
				}
			/>
		</div>
	);
}
