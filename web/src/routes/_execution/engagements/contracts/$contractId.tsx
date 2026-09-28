import { useQuery } from "@tanstack/react-query";
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
import { type Contract, contractService } from "@/services/contract.service";
import { useUser } from "@/stores/authStore";

/**
 * The contract document editor — parties, terms, services, agreement,
 * signatures, and amendments. Lives under Engagements → Contracts, the one
 * place contracts are listed; finance pages link here.
 */
const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute(
	"/_execution/engagements/contracts/$contractId",
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
	const user = useUser();
	const isContractId = UUID_RE.test(contractId);
	// Same key the editor uses, so this shares its request rather than adding one.
	const contractQuery = useQuery({
		queryKey: ["contract", contractId],
		queryFn: () => contractService.getById(contractId),
		enabled: isContractId,
	});

	// The dynamic segment is the router's last resort under /engagements/finance,
	// so any junk path lands here. A param that is not shaped like an id is a
	// 404, not a contract — without this, the contract query would hold a
	// spinner forever retrying an id that can never exist.
	if (!isContractId) return <NotFoundRoute />;

	return (
		// One column exactly the height below the app bar: the breadcrumb takes
		// what it needs and the editor fills the rest, so its footer stays on
		// screen.
		<div className="app-shell-bg flex h-[calc(100dvh-3.5rem-var(--safe-top))] flex-col">
			{/* White like the editor header below it, so the two read as one bar. */}
			<div className="shrink-0 bg-card px-5 pt-3 md:px-8">
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
							key="contracts"
							to="/engagements/contracts"
							className={FINANCE_CRUMB_LINK_CLASS}
						>
							Contracts
						</Link>,
						<FinanceCurrentCrumb key="contract">
							<span className="inline-block max-w-[28rem] truncate align-bottom">
								{contractQuery.data
									? contractCrumbLabel(contractQuery.data, user?.id)
									: "Contract"}
							</span>
						</FinanceCurrentCrumb>,
					]}
				/>
			</div>
			<ProjectContract
				contractId={contractId}
				initialStep={section}
				onBack={() => void navigate({ to: "/engagements/contracts" })}
				onOpenContract={(nextContractId) =>
					void navigate({
						to: "/engagements/contracts/$contractId",
						params: { contractId: nextContractId },
						search: { section: "terms" },
						replace: true,
					})
				}
			/>
		</div>
	);
}

/**
 * The contract's name as the viewer would say it: its number (or document
 * title when it has none) and who it is with, from the viewer's side.
 */
function contractCrumbLabel(
	contract: Contract,
	viewerId: string | undefined,
): string {
	const title =
		contract.contract_number ?? contract.document_title ?? "Service Agreement";
	const viewerIsProvider = contract.positions.some(
		(seat) => seat.user_id === viewerId && seat.position === "provider",
	);
	const counterparty = viewerIsProvider
		? contract.client_name
		: contract.provider_name;
	const version = contract.version > 1 ? ` · v${contract.version}` : "";
	return counterparty
		? `${title} with ${counterparty}${version}`
		: `${title}${version}`;
}
