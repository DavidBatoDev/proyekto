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
import { NotFoundRoute } from "@/components/layout/NotFoundRoute";

/**
 * The contract document editor.
 *
 * Deliberately a sibling of the `_portfolio` layout rather than a child: this
 * is a full-page document, and inheriting the section tab bar and filter
 * toolbar would frame an agreement as a filtered list view. Auth and the
 * finance shell still come from `finance/route.tsx` above it.
 *
 * Keeps the bare `/engagements/finance/<id>` shape (mirroring the old
 * `/marketplace/finance/<id>`, which now redirects here — rows in
 * `notifications.link_url` still carry the old string). Static section names
 * win over the dynamic segment in the router's ranking, so
 * `/engagements/finance/contracts` still resolves to the list.
 */
const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute(
	"/_execution/engagements/finance/$contractId",
)({
	validateSearch: (search: Record<string, unknown>): ContractEditorSearch => ({
		section: validateContractStep(search.section),
	}),
	component: ContractEditorPage,
});

function ContractEditorPage() {
	const { contractId } = Route.useParams();
	const { section } = Route.useSearch();
	const navigate = useNavigate();

	// The dynamic segment is the router's last resort under /engagements/finance,
	// so any junk path lands here. A param that is not shaped like an id is a
	// 404, not a contract — without this, the contract query would hold a
	// spinner forever retrying an id that can never exist.
	if (!UUID_RE.test(contractId)) return <NotFoundRoute />;

	return (
		<div className="app-shell-bg min-h-full">
			<div className="px-5 pt-4 md:px-8 md:pt-5">
				<FinanceBreadcrumbs
					items={[
						<Link
							key="engagements"
							to="/engagements"
							className={FINANCE_CRUMB_LINK_CLASS}
						>
							Engagements
						</Link>,
						<Link
							key="finance"
							to="/engagements/finance"
							className={FINANCE_CRUMB_LINK_CLASS}
						>
							Finance
						</Link>,
						<Link
							key="contracts"
							to="/engagements/finance/contracts"
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
				onBack={() => void navigate({ to: "/engagements/finance/contracts" })}
				onOpenContract={(nextContractId) =>
					void navigate({
						to: "/engagements/finance/$contractId",
						params: { contractId: nextContractId },
						search: { section: "terms" },
						replace: true,
					})
				}
			/>
		</div>
	);
}
