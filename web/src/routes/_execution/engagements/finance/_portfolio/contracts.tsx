import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { StepKey } from "@/components/finance/ProjectContract";
import { ContractPortfolio } from "@/components/finance/portfolio/ContractPortfolio";
import { CreateContractDialog } from "@/components/finance/portfolio/CreateContractDialog";
import {
	activeFilterCount,
	FINANCE_PAGE_SIZE,
	type FinanceContractsSearch,
	pageValue,
	stringValue,
	validateContractStep,
	validateFinanceSharedSearch,
} from "@/components/finance/portfolio/financeSearch";
import { useFinanceProjectOptions } from "@/components/finance/portfolio/useFinanceProjectOptions";
import { useToast } from "@/hooks/useToast";
import { isActiveConsultant } from "@/lib/auth-utils";
import {
	type ContractRelationshipKind,
	type ContractScopeMode,
	contractService,
} from "@/services/contract.service";
import {
	type FinanceContractSummary,
	financeService,
} from "@/services/finance.service";
import { useProfile } from "@/stores/authStore";

/**
 * The contract portfolio.
 *
 * `contractStatus` and `step` are declared here and nowhere else: they mean
 * nothing on the other three sections, and leaving them on a shared validator
 * would let them survive in URLs that ignore them.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/_portfolio/contracts",
)({
	validateSearch: (
		search: Record<string, unknown>,
	): FinanceContractsSearch => ({
		...validateFinanceSharedSearch(search),
		contractStatus: stringValue(search.contractStatus),
		step: validateContractStep(search.step),
		page: pageValue(search.page),
	}),
	component: FinanceContractsPage,
});

function FinanceContractsPage() {
	const search = Route.useSearch();
	const navigate = useNavigate();
	const qc = useQueryClient();
	const toast = useToast();
	const profile = useProfile();
	const isConsultant = isActiveConsultant(profile);
	const [createContractOpen, setCreateContractOpen] = useState(false);

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
		queryKey: ["finance", "contracts", filters, search.contractStatus, page],
		queryFn: () =>
			financeService.contracts({
				...filters,
				contract_status: search.contractStatus,
				page,
				limit: FINANCE_PAGE_SIZE,
			}),
		enabled: isConsultant,
	});
	const projectOptionsQuery = useFinanceProjectOptions(search, isConsultant);

	const openContract = (contractId: string, section?: StepKey) =>
		void navigate({
			to: "/engagements/finance/$contractId",
			params: { contractId },
			search: { section },
		});
	const updateSearch = (patch: Partial<FinanceContractsSearch>) =>
		void navigate({
			to: "/engagements/finance/contracts",
			search: { ...search, ...patch },
			replace: true,
		});

	const createContractMutation = useMutation({
		mutationFn: (input: {
			project_id?: string | null;
			relationship_kind: ContractRelationshipKind;
			scope_mode: ContractScopeMode;
			counterparty_user_id?: string;
		}) => contractService.create(input),
		onSuccess: (created) => {
			setCreateContractOpen(false);
			void qc.invalidateQueries({ queryKey: ["finance", "contracts"] });
			void qc.invalidateQueries({ queryKey: ["finance", "portfolio"] });
			toast.success("Draft contract created");
			openContract(created.id, "parties");
		},
		onError: (error: Error) => toast.error(error.message),
	});

	// `?projectId=…&step=…` is a deep link into a project's newest contract at a
	// particular document section — the shape a notification uses. It resolves
	// to a contract id only once the list has loaded, so it forwards here rather
	// than in `beforeLoad`.
	useEffect(() => {
		if (!search.projectId || !search.step || contractsQuery.isPending) return;
		const latest = contractsQuery.data?.items.reduce<
			FinanceContractSummary | undefined
		>(
			(current, item) =>
				!current || item.version > current.version ? item : current,
			undefined,
		);
		if (latest) openContract(latest.id, search.step);
	}, [
		search.projectId,
		search.step,
		contractsQuery.isPending,
		contractsQuery.data,
	]);

	return (
		<>
			<ContractPortfolio
				loading={contractsQuery.isPending}
				items={contractsQuery.data?.items ?? []}
				total={contractsQuery.data?.total ?? 0}
				page={page}
				limit={FINANCE_PAGE_SIZE}
				onPageChange={(next) => updateSearch({ page: next })}
				onOpen={(contractId) => openContract(contractId)}
				onAddContract={() => setCreateContractOpen(true)}
				projectId={search.projectId}
				filtered={activeFilterCount(search, "contracts") > 0}
				onClearProject={() => updateSearch({ projectId: undefined })}
			/>
			<CreateContractDialog
				open={createContractOpen}
				projects={projectOptionsQuery.data?.projects ?? []}
				loading={projectOptionsQuery.isPending}
				creating={createContractMutation.isPending}
				initialProjectId={search.projectId}
				onClose={() => setCreateContractOpen(false)}
				onCreate={(input) => createContractMutation.mutate(input)}
			/>
		</>
	);
}
