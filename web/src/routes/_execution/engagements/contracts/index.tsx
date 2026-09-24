import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	FileSignature,
	type LucideIcon,
	PenLine,
	Plus,
	UserRound,
	Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
	AppEmptyState,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { AppTabs } from "@/components/common/AppTabs";
import { Dropdown } from "@/components/common/Dropdown";
import { AgreementRow } from "@/components/engagements/AgreementRow";
import { useFinanceHub } from "@/components/finance/nav/useManagedTeams";
import type { StepKey } from "@/components/finance/ProjectContract";
import { ContractPortfolio } from "@/components/finance/portfolio/ContractPortfolio";
import { CreateContractDialog } from "@/components/finance/portfolio/CreateContractDialog";
import {
	FINANCE_CRUMB_LINK_CLASS,
	FinanceBreadcrumbs,
	FinanceCurrentCrumb,
} from "@/components/finance/portfolio/FinanceBreadcrumbs";
import { FinanceLoading } from "@/components/finance/portfolio/FinancePrimitives";
import {
	FINANCE_PAGE_SIZE,
	pageValue,
	stringValue,
	validateContractStep,
} from "@/components/finance/portfolio/financeSearch";
import { useFinanceProjectOptions } from "@/components/finance/portfolio/useFinanceProjectOptions";
import { useToast } from "@/hooks/useToast";
import { isActiveConsultant } from "@/lib/auth-utils";
import {
	type ContractRelationshipKind,
	type ContractScopeMode,
	contractService,
} from "@/services/contract.service";
import { engagementService } from "@/services/engagement.service";
import {
	type FinanceContractSummary,
	financeService,
} from "@/services/finance.service";
import { teamFinanceService } from "@/services/teamFinance.service";
import { useProfile } from "@/stores/authStore";

type ContractsView = "mine" | "authored" | "team";
type ContractKind = "client_services" | "talent_services";

interface ContractsSearch {
	view?: ContractsView;
	teamId?: string;
	kind?: ContractKind;
	contractStatus?: string;
	projectId?: string;
	step?: StepKey;
	page?: number;
}

/**
 * Every contract, in one place. Finance pages never list contracts — they
 * link here.
 *
 * Three views, by how the caller relates to the paper:
 * - Mine: every contract the caller is a party to, in any seat (client,
 *   consultant, talent) — including ones waiting for their signature.
 * - Drafted by me: contracts a verified consultant authored (drafts, sent,
 *   signed, amended). The only view that can create one.
 * - Team: the client and talent contracts of a team the caller runs.
 */
export const Route = createFileRoute("/_execution/engagements/contracts/")({
	validateSearch: (search: Record<string, unknown>): ContractsSearch => ({
		view: (["mine", "authored", "team"] as const).includes(
			search.view as ContractsView,
		)
			? (search.view as ContractsView)
			: undefined,
		teamId: stringValue(search.teamId),
		kind:
			search.kind === "client_services" || search.kind === "talent_services"
				? search.kind
				: undefined,
		contractStatus: stringValue(search.contractStatus),
		projectId: stringValue(search.projectId),
		step: validateContractStep(search.step),
		page: pageValue(search.page),
	}),
	component: ContractsPage,
});

const KIND_OPTIONS = [
	{ value: "", label: "Client & talent" },
	{ value: "client_services", label: "Client contracts" },
	{ value: "talent_services", label: "Talent contracts" },
];

const STATUS_OPTIONS = [
	{ value: "", label: "Any status" },
	{ value: "draft", label: "Draft" },
	{ value: "sent", label: "Sent" },
	{ value: "signed", label: "Signed" },
	{ value: "active", label: "Active" },
	{ value: "ended", label: "Ended" },
];

function ContractsPage() {
	const search = Route.useSearch();
	const navigate = useNavigate();
	const profile = useProfile();
	const isConsultant = isActiveConsultant(profile);
	const hubQuery = useFinanceHub();
	const adminTeams = (hubQuery.data?.teams ?? []).filter(
		(team) => team.my_team_role === "owner" || team.my_team_role === "admin",
	);

	// A `?projectId&step` deep link (notifications) targets a drafted contract.
	const view: ContractsView =
		search.view ??
		(search.teamId
			? "team"
			: search.step && isConsultant
				? "authored"
				: "mine");

	const views: Array<{ key: ContractsView; label: string; icon: LucideIcon }> =
		[
			{ key: "mine", label: "My contracts", icon: UserRound },
			...(isConsultant
				? [{ key: "authored" as const, label: "Drafted by me", icon: PenLine }]
				: []),
			...(adminTeams.length > 0
				? [{ key: "team" as const, label: "Team contracts", icon: Users }]
				: []),
		];

	const setSearch = (patch: Partial<ContractsSearch>) =>
		void navigate({
			to: "/engagements/contracts",
			search: { ...search, ...patch },
			replace: true,
		});

	return (
		<div className="min-h-full px-5 pb-10 md:px-8">
			<div className="mx-auto w-full max-w-7xl pt-4 md:pt-5">
				<FinanceBreadcrumbs
					items={[
						<Link
							key="engagements"
							to="/engagements"
							className={FINANCE_CRUMB_LINK_CLASS}
						>
							Engagements
						</Link>,
						<FinanceCurrentCrumb key="contracts">
							Contracts
						</FinanceCurrentCrumb>,
					]}
				/>
				<div className="mt-2 flex flex-wrap items-center justify-between gap-3">
					<h1 className="text-2xl font-bold tracking-tight text-foreground">
						Contracts
					</h1>
				</div>
				<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
					Every agreement you are part of — to sign, to review, or to amend.
					Signing one opens an engagement.
				</p>

				<div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-b border-border">
					<AppTabs
						variant="underline"
						size="sm"
						className="border-b-0"
						items={views.map((entry) => ({
							key: entry.key,
							label: (
								<>
									<entry.icon className="h-4 w-4" />
									{entry.label}
								</>
							),
						}))}
						active={view}
						linkFor={(key) => ({
							to: "/engagements/contracts",
							search: { view: key },
						})}
					/>
				</div>

				<div className="mt-6">
					{view === "mine" ? <MyContracts /> : null}
					{view === "authored" && isConsultant ? (
						<AuthoredContracts search={search} setSearch={setSearch} />
					) : null}
					{view === "team" ? (
						<TeamContracts
							teams={adminTeams.map((team) => ({
								id: team.team_id,
								name: team.team_name,
							}))}
							search={search}
							setSearch={setSearch}
						/>
					) : null}
				</div>
			</div>
		</div>
	);
}

function useOpenContract() {
	const navigate = useNavigate();
	return (contractId: string, section?: StepKey) =>
		void navigate({
			to: "/engagements/contracts/$contractId",
			params: { contractId },
			search: { section },
		});
}

/** Every seat of the caller's, waiting-for-signature first. */
function MyContracts() {
	const openContract = useOpenContract();
	const agreementsQuery = useQuery({
		queryKey: ["engagements", "agreements"],
		queryFn: () => engagementService.agreements(),
	});
	if (agreementsQuery.isPending) return <FinanceLoading />;
	const agreements = agreementsQuery.data ?? [];
	const waiting = agreements.filter(
		(agreement) => agreement.status === "sent" && !agreement.signed_at,
	);
	const rest = agreements.filter((agreement) => !waiting.includes(agreement));

	if (agreements.length === 0) {
		return (
			<AppEmptyState
				icon={FileSignature}
				title="No contracts yet"
				description="When you sign a contract — as a client, consultant, or talent — it appears here."
			/>
		);
	}

	return (
		<div className="space-y-8">
			{waiting.length > 0 ? (
				<section>
					<h2 className="text-base font-semibold text-foreground">
						Waiting for your signature
					</h2>
					<AppSurfaceCard className="mt-3 divide-y divide-border overflow-hidden border-warning/40">
						{waiting.map((agreement) => (
							<AgreementRow
								key={agreement.contract_id}
								agreement={agreement}
								onOpen={openContract}
							/>
						))}
					</AppSurfaceCard>
				</section>
			) : null}
			{rest.length > 0 ? (
				<section>
					<h2 className="text-base font-semibold text-foreground">
						All my contracts
					</h2>
					<p className="mt-0.5 text-sm text-muted-foreground">
						Your seat on each contract is shown per row.
					</p>
					<AppSurfaceCard className="mt-3 divide-y divide-border overflow-hidden">
						{rest.map((agreement) => (
							<AgreementRow
								key={agreement.contract_id}
								agreement={agreement}
								onOpen={openContract}
							/>
						))}
					</AppSurfaceCard>
				</section>
			) : null}
		</div>
	);
}

/** A verified consultant's authored contracts — the only place to create one. */
function AuthoredContracts({
	search,
	setSearch,
}: {
	search: ContractsSearch;
	setSearch: (patch: Partial<ContractsSearch>) => void;
}) {
	const openContract = useOpenContract();
	const qc = useQueryClient();
	const toast = useToast();
	const [createOpen, setCreateOpen] = useState(false);
	const page = search.page ?? 1;

	const contractsQuery = useQuery({
		queryKey: [
			"finance",
			"contracts",
			{ project_id: search.projectId },
			search.contractStatus,
			page,
		],
		queryFn: () =>
			financeService.contracts({
				project_id: search.projectId,
				contract_status: search.contractStatus,
				page,
				limit: FINANCE_PAGE_SIZE,
			}),
	});
	const projectOptionsQuery = useFinanceProjectOptions(
		{ projectId: search.projectId },
		true,
	);

	// `?projectId=…&step=…` deep-links into the project's newest contract at a
	// document section — the shape a notification uses.
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

	const createMutation = useMutation({
		mutationFn: (input: {
			project_id?: string | null;
			relationship_kind: ContractRelationshipKind;
			scope_mode: ContractScopeMode;
			counterparty_user_id?: string;
		}) => contractService.create(input),
		onSuccess: (created) => {
			setCreateOpen(false);
			void qc.invalidateQueries({ queryKey: ["finance", "contracts"] });
			void qc.invalidateQueries({
				queryKey: ["engagements", "contract-pipeline"],
			});
			toast.success("Draft contract created");
			openContract(created.id, "parties");
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const items = (contractsQuery.data?.items ?? []).filter(
		(item) => !search.kind || item.relationship_kind === search.kind,
	);

	return (
		<>
			<Filters
				search={search}
				setSearch={setSearch}
				action={
					<button
						type="button"
						onClick={() => setCreateOpen(true)}
						className="app-cta inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white"
					>
						<Plus className="h-4 w-4" /> New contract
					</button>
				}
			/>
			<ContractPortfolio
				loading={contractsQuery.isPending}
				items={items}
				total={contractsQuery.data?.total ?? 0}
				page={page}
				limit={FINANCE_PAGE_SIZE}
				onPageChange={(next) => setSearch({ page: next })}
				onOpen={(contractId) => openContract(contractId)}
				onAddContract={() => setCreateOpen(true)}
				projectId={search.projectId}
				filtered={Boolean(
					search.projectId || search.contractStatus || search.kind,
				)}
				onClearProject={() => setSearch({ projectId: undefined })}
			/>
			<CreateContractDialog
				open={createOpen}
				projects={projectOptionsQuery.data?.projects ?? []}
				loading={projectOptionsQuery.isPending}
				creating={createMutation.isPending}
				initialProjectId={search.projectId}
				onClose={() => setCreateOpen(false)}
				onCreate={(input) => createMutation.mutate(input)}
			/>
		</>
	);
}

/** The client and talent contracts of a team the caller runs. Read-only. */
function TeamContracts({
	teams,
	search,
	setSearch,
}: {
	teams: Array<{ id: string; name: string }>;
	search: ContractsSearch;
	setSearch: (patch: Partial<ContractsSearch>) => void;
}) {
	const openContract = useOpenContract();
	const teamId =
		teams.find((team) => team.id === search.teamId)?.id ?? teams[0]?.id;
	const page = search.page ?? 1;

	const contractsQuery = useQuery({
		queryKey: [
			"team-finance",
			"contracts",
			teamId,
			search.contractStatus,
			page,
		],
		queryFn: () =>
			teamFinanceService.contracts(teamId as string, {
				contract_status: search.contractStatus,
				page,
				limit: FINANCE_PAGE_SIZE,
			}),
		enabled: Boolean(teamId),
	});

	if (!teamId) {
		return (
			<AppEmptyState
				icon={Users}
				title="No team contracts"
				description="Team contracts show for teams you own or administer."
			/>
		);
	}

	const items = (contractsQuery.data?.items ?? []).filter(
		(item) => !search.kind || item.relationship_kind === search.kind,
	);

	return (
		<>
			<Filters
				search={search}
				setSearch={setSearch}
				teamPicker={
					teams.length > 1 ? (
						<Dropdown
							value={teamId}
							onChange={(value) =>
								setSearch({ teamId: value || undefined, page: undefined })
							}
							options={teams.map((team) => ({
								value: team.id,
								label: team.name,
							}))}
							ariaLabel="Team"
							className="w-48"
						/>
					) : null
				}
			/>
			<ContractPortfolio
				loading={contractsQuery.isPending}
				items={items}
				total={contractsQuery.data?.total ?? 0}
				page={page}
				limit={FINANCE_PAGE_SIZE}
				onPageChange={(next) => setSearch({ page: next })}
				onOpen={(contractId) => openContract(contractId)}
				filtered={Boolean(search.contractStatus || search.kind)}
				onClearProject={() => setSearch({ projectId: undefined })}
			/>
		</>
	);
}

function Filters({
	search,
	setSearch,
	teamPicker,
	action,
}: {
	search: ContractsSearch;
	setSearch: (patch: Partial<ContractsSearch>) => void;
	teamPicker?: React.ReactNode;
	action?: React.ReactNode;
}) {
	return (
		<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
			<div className="flex flex-wrap items-center gap-2">
				{teamPicker}
				<Dropdown
					value={search.kind ?? ""}
					onChange={(value) =>
						setSearch({
							kind: (value || undefined) as ContractKind | undefined,
							page: undefined,
						})
					}
					options={KIND_OPTIONS}
					ariaLabel="Contract kind"
					className="w-44"
				/>
				<Dropdown
					value={search.contractStatus ?? ""}
					onChange={(value) =>
						setSearch({ contractStatus: value || undefined, page: undefined })
					}
					options={STATUS_OPTIONS}
					ariaLabel="Contract status"
					className="w-40"
				/>
			</div>
			{action}
		</div>
	);
}
