import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ContractPortfolio } from "@/components/finance/portfolio/ContractPortfolio";
import {
	activeFilterCount,
	FINANCE_PAGE_SIZE,
	type FinanceContractsSearch,
	pageValue,
	stringValue,
	validateContractStep,
	validateFinanceSharedSearch,
} from "@/components/finance/portfolio/financeSearch";
import { TeamFinanceChrome } from "@/components/finance/team/TeamFinanceChrome";
import { useTeamFinanceProjectOptions } from "@/components/finance/team/useTeamFinanceProjectOptions";
import { teamFinanceService } from "@/services/teamFinance.service";

/**
 * One team's contracts — read-only for the team administrator. There is no
 * "Add contract" CTA here: authoring an agreement is consultant control, and
 * the backend rejects contract writes from this tier regardless.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/team/$teamId/contracts",
)({
	validateSearch: (
		search: Record<string, unknown>,
	): FinanceContractsSearch => ({
		...validateFinanceSharedSearch(search),
		contractStatus: stringValue(search.contractStatus),
		step: validateContractStep(search.step),
		page: pageValue(search.page),
	}),
	component: TeamFinanceContractsPage,
});

function TeamFinanceContractsPage() {
	const { teamId } = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate();

	const filters = {
		q: search.q,
		project_id: search.projectId,
		project_status: search.projectStatus,
		currency: search.currency,
		from: search.from,
		to: search.to,
	};
	const page = search.page ?? 1;
	const contractsQuery = useQuery({
		queryKey: [
			"team-finance",
			"contracts",
			teamId,
			filters,
			search.contractStatus,
			page,
		],
		queryFn: () =>
			teamFinanceService.contracts(teamId, {
				...filters,
				contract_status: search.contractStatus,
				page,
				limit: FINANCE_PAGE_SIZE,
			}),
	});
	const projectOptionsQuery = useTeamFinanceProjectOptions(teamId, search);

	const updateSearch = (patch: Partial<FinanceContractsSearch>) =>
		void navigate({
			to: "/engagements/finance/team/$teamId/contracts",
			params: { teamId },
			search: { ...search, ...patch },
			replace: true,
		});

	return (
		<TeamFinanceChrome
			teamId={teamId}
			section="contracts"
			search={search}
			projects={projectOptionsQuery.data?.projects ?? []}
			onChange={updateSearch}
		>
			<ContractPortfolio
				loading={contractsQuery.isPending}
				items={contractsQuery.data?.items ?? []}
				total={contractsQuery.data?.total ?? 0}
				page={page}
				limit={FINANCE_PAGE_SIZE}
				onPageChange={(next) => updateSearch({ page: next })}
				onOpen={(contractId) =>
					void navigate({
						to: "/engagements/finance/$contractId",
						params: { contractId },
						search: {},
					})
				}
				projectId={search.projectId}
				filtered={activeFilterCount(search, "contracts") > 0}
				onClearProject={() => updateSearch({ projectId: undefined })}
			/>
		</TeamFinanceChrome>
	);
}
