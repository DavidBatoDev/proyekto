import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import {
	ArrowLeft,
	BarChart3,
	CircleDollarSign,
	FileSignature,
	Handshake,
	ReceiptText,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AppEmptyState } from "@/components/common/AppPrimitives";
import { AppTabs } from "@/components/common/AppTabs";
import type { StepKey } from "@/components/finance/ProjectContract";
import { ProjectFinancials } from "@/components/finance/ProjectFinancials";
import { ProjectInvoices } from "@/components/finance/ProjectInvoices";
import { ContractPortfolio } from "@/components/finance/portfolio/ContractPortfolio";
import { CreateContractDialog } from "@/components/finance/portfolio/CreateContractDialog";
import { EngagementPortfolio } from "@/components/finance/portfolio/EngagementPortfolio";
import { countLabel } from "@/components/finance/portfolio/FinancePrimitives";
import { FinanceFiltersBar } from "@/components/finance/portfolio/financeFilters";
import {
	activeFilterCount,
	CONTRACT_STEPS,
	FINANCE_PAGE_SIZE,
	type FinanceSearch,
	type FinanceTab,
} from "@/components/finance/portfolio/financeSearch";
import { InvoicePortfolio } from "@/components/finance/portfolio/InvoicePortfolio";
import { PortfolioOverview } from "@/components/finance/portfolio/PortfolioOverview";
import { MarketplaceShell } from "@/components/layout/MarketplaceShell";
import { useToast } from "@/hooks/useToast";
import { isActiveConsultant } from "@/lib/auth-utils";
import { type CsvColumn, downloadCsv, toCsv } from "@/lib/csv-export";
import {
	effectiveInvoiceStatus,
	financeStatusMeta,
} from "@/lib/finance-status";
import {
	type ContractRelationshipKind,
	type ContractScopeMode,
	contractService,
} from "@/services/contract.service";
import { engagementService } from "@/services/engagement.service";
import {
	type FinanceFilters,
	type FinanceInvoiceSummary,
	financeService,
} from "@/services/finance.service";
import { useAuthStore, useProfile } from "@/stores/authStore";

const FINANCE_TABS = [
	{ key: "overview" as const, label: "Overview", icon: BarChart3 },
	{ key: "contracts" as const, label: "Contracts", icon: FileSignature },
	{ key: "engagements" as const, label: "Engagements", icon: Handshake },
	{ key: "invoices" as const, label: "Invoices", icon: ReceiptText },
];

export const Route = createFileRoute("/marketplace/finance/")({
	beforeLoad: () => {
		if (!useAuthStore.getState().isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
	},
	validateSearch: (search: Record<string, unknown>): FinanceSearch => ({
		tab:
			search.tab === "contracts" ||
			search.tab === "engagements" ||
			search.tab === "invoices"
				? search.tab
				: "overview",
		q: stringValue(search.q),
		projectId: stringValue(search.projectId),
		projectStatus: stringValue(search.projectStatus),
		currency: stringValue(search.currency),
		from: stringValue(search.from),
		to: stringValue(search.to),
		contractStatus: stringValue(search.contractStatus),
		invoiceStatus: stringValue(search.invoiceStatus),
		step:
			typeof search.step === "string" &&
			CONTRACT_STEPS.includes(search.step as StepKey)
				? (search.step as StepKey)
				: undefined,
		page: pageValue(search.page),
	}),
	component: FinancePage,
});

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function pageValue(value: unknown): number | undefined {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 1 ? parsed : undefined;
}

function FinancePage() {
	const search = Route.useSearch();
	const navigate = useNavigate();
	const [createOpen, setCreateOpen] = useState(false);
	const qc = useQueryClient();
	const toast = useToast();
	const profile = useProfile();
	const isConsultant = isActiveConsultant(profile);
	const page = search.page ?? 1;

	const filters: FinanceFilters = {
		q: search.q,
		project_id: search.projectId,
		project_status: search.projectStatus,
		currency: search.currency,
		from: search.from,
		to: search.to,
	};

	/**
	 * One portfolio call, deliberately keyed WITHOUT `project_id`.
	 *
	 * There used to be two queries against `/api/finance/portfolio` — one for the
	 * facet's project list and one for the totals — which fired on every load of
	 * every tab and recomputed the same figures twice. They can be a single query
	 * because the project filter never affects what this call needs to return:
	 * picking a project swaps the overview tab over to <ProjectFinancials/>, so
	 * the filtered totals were computed and then thrown away, while the facet
	 * list must stay unfiltered or choosing a project would empty its own menu.
	 */
	const portfolioQuery = useQuery({
		queryKey: [
			"finance",
			"portfolio",
			search.q,
			search.projectStatus,
			search.currency,
			search.from,
			search.to,
		],
		queryFn: () =>
			financeService.portfolio({ ...filters, project_id: undefined }),
		enabled: isConsultant,
	});
	const projects = portfolioQuery.data?.projects ?? [];

	const contractsQuery = useQuery({
		queryKey: ["finance", "contracts", filters, search.contractStatus, page],
		queryFn: () =>
			financeService.contracts({
				...filters,
				contract_status: search.contractStatus,
				page,
				limit: FINANCE_PAGE_SIZE,
			}),
		enabled: isConsultant && search.tab === "contracts",
	});
	const engagementsQuery = useQuery({
		queryKey: ["finance", "engagements", search.projectId],
		queryFn: () =>
			engagementService.list(
				search.projectId ? { project_id: search.projectId } : {},
			),
		enabled: isConsultant && search.tab === "engagements",
	});
	const invoicesQuery = useQuery({
		queryKey: ["finance", "invoices", filters, search.invoiceStatus, page],
		queryFn: () =>
			financeService.invoices({
				...filters,
				invoice_status: search.invoiceStatus,
				page,
				limit: FINANCE_PAGE_SIZE,
			}),
		enabled: isConsultant && search.tab === "invoices" && !search.projectId,
	});

	const updateSearch = (patch: Partial<FinanceSearch>) =>
		void navigate({
			to: "/marketplace/finance",
			search: { ...search, ...patch },
			replace: true,
		});
	const selectedProject = projects.find(
		(project) => project.id === search.projectId,
	);
	const openContract = (contractId: string, section?: StepKey) =>
		void navigate({
			to: "/marketplace/finance/$contractId",
			params: { contractId },
			search: { section },
		});
	const openEngagement = (engagementId: string) =>
		void navigate({
			to: "/marketplace/finance/engagements/$engagementId",
			params: { engagementId },
		});

	const createContractMutation = useMutation({
		mutationFn: (input: {
			project_id?: string | null;
			relationship_kind: ContractRelationshipKind;
			scope_mode: ContractScopeMode;
			counterparty_user_id?: string;
		}) => contractService.create(input),
		onSuccess: (created) => {
			setCreateOpen(false);
			void qc.invalidateQueries({ queryKey: ["finance", "contracts"] });
			void qc.invalidateQueries({ queryKey: ["finance", "portfolio"] });
			toast.success("Draft contract created");
			openContract(created.id, "parties");
		},
		onError: (error: Error) => toast.error(error.message),
	});

	useEffect(() => {
		if (
			search.tab !== "contracts" ||
			!search.projectId ||
			!search.step ||
			contractsQuery.isPending
		) {
			return;
		}
		const latest = contractsQuery.data?.items.reduce<
			{ id: string; version: number } | undefined
		>(
			(current, item) =>
				!current || item.version > current.version ? item : current,
			undefined,
		);
		if (latest) openContract(latest.id, search.step);
	}, [
		search.tab,
		search.projectId,
		search.step,
		contractsQuery.isPending,
		contractsQuery.data,
	]);

	if (profile && !isConsultant) {
		return (
			<MarketplaceShell>
				<div className="mx-auto max-w-4xl px-5 py-10">
					<AppEmptyState
						icon={CircleDollarSign}
						title="Finance is for active consultants"
						description="Once your consultant profile is verified, contracts, client invoices, and portfolio financials will appear here."
					/>
				</div>
			</MarketplaceShell>
		);
	}

	const exportInvoices = () => {
		const rows = invoicesQuery.data?.items ?? [];
		if (rows.length === 0) {
			toast.error("Nothing to export on this page");
			return;
		}
		downloadCsv(
			`proyekto-invoices-${new Date().toISOString().slice(0, 10)}.csv`,
			toCsv(rows, INVOICE_CSV_COLUMNS),
		);
	};

	return (
		<MarketplaceShell>
			<div className="app-shell-bg min-h-full px-5 py-4 md:px-8 md:py-5">
				<div className="mx-auto w-full max-w-7xl">
					<header>
						<div className="flex items-center justify-between gap-4">
							<div className="flex min-w-0 items-center gap-2.5">
								<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/10 text-foreground">
									<CircleDollarSign className="h-4 w-4" />
								</span>
								<div className="min-w-0 leading-tight">
									<h1 className="text-sm font-semibold text-foreground">
										Finance
									</h1>
									<p className="truncate text-[11px] text-muted-foreground">
										Contracts, invoices, revenue, and delivery costs across your
										projects
									</p>
								</div>
							</div>
							<span className="hidden shrink-0 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground sm:inline-flex">
								{portfolioQuery.isPending
									? "Loading projects…"
									: countLabel(projects.length, "project")}
							</span>
						</div>

						{/*
						 * The page-level tab strip, from the shared primitive rather than
						 * the hand-rolled copy that used to live here — which meant this
						 * page alone had no arrow-key navigation.
						 *
						 * Switching tabs KEEPS `projectId`. It used to clear it, so
						 * drilling into a project's financials and then clicking Invoices
						 * silently threw you back out to the portfolio.
						 */}
						<div className="mt-3">
							<AppTabs
								items={FINANCE_TABS.map((tab) => ({
									key: tab.key,
									label: (
										<span className="inline-flex items-center gap-2">
											<tab.icon className="h-4 w-4" />
											{tab.label}
										</span>
									),
								}))}
								active={search.tab}
								variant="underline"
								onChange={(tab: FinanceTab) =>
									updateSearch({ tab, step: undefined, page: undefined })
								}
							/>
						</div>
					</header>

					<div
						id="finance-tab-panel"
						role="tabpanel"
						aria-label={`${search.tab} panel`}
						className="outline-none"
					>
						<FinanceFiltersBar
							search={search}
							projects={projects}
							onChange={updateSearch}
						/>

						{search.projectId && (
							<div className="my-3 flex min-w-0 items-center gap-2 text-sm">
								<button
									type="button"
									onClick={() =>
										updateSearch({
											projectId: undefined,
											step: undefined,
											page: undefined,
										})
									}
									className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-primary hover:underline"
								>
									<ArrowLeft className="h-4 w-4" /> All projects
								</button>
								<span className="text-border">/</span>
								<span className="truncate font-medium text-foreground">
									{selectedProject?.title ?? "Selected project"}
								</span>
							</div>
						)}

						{search.tab === "overview" &&
							(search.projectId ? (
								<ProjectFinancials projectId={search.projectId} />
							) : (
								<PortfolioOverview
									loading={portfolioQuery.isPending}
									portfolio={portfolioQuery.data}
									onOpen={(projectId) => updateSearch({ projectId })}
								/>
							))}

						{search.tab === "contracts" && (
							<ContractPortfolio
								loading={contractsQuery.isPending}
								items={contractsQuery.data?.items ?? []}
								total={contractsQuery.data?.total ?? 0}
								page={page}
								limit={FINANCE_PAGE_SIZE}
								onPageChange={(next) => updateSearch({ page: next })}
								onOpen={(contractId) => openContract(contractId)}
								onAddContract={() => setCreateOpen(true)}
								projectId={search.projectId}
								filtered={activeFilterCount(search) > 0}
								onClearProject={() => updateSearch({ projectId: undefined })}
							/>
						)}

						{search.tab === "engagements" && (
							<EngagementPortfolio
								loading={engagementsQuery.isPending}
								error={engagementsQuery.error as Error | null}
								items={engagementsQuery.data ?? []}
								filtered={Boolean(search.projectId)}
								onClearProject={() => updateSearch({ projectId: undefined })}
								onOpen={openEngagement}
							/>
						)}

						{search.tab === "invoices" &&
							(search.projectId ? (
								<ProjectInvoices projectId={search.projectId} />
							) : (
								<InvoicePortfolio
									loading={invoicesQuery.isPending}
									items={invoicesQuery.data?.items ?? []}
									total={invoicesQuery.data?.total ?? 0}
									page={page}
									limit={FINANCE_PAGE_SIZE}
									onPageChange={(next) => updateSearch({ page: next })}
									onOpenProject={(projectId) => updateSearch({ projectId })}
									onExport={exportInvoices}
								/>
							))}
					</div>
				</div>

				<CreateContractDialog
					open={createOpen}
					projects={projects}
					loading={portfolioQuery.isPending}
					creating={createContractMutation.isPending}
					initialProjectId={search.projectId}
					onClose={() => setCreateOpen(false)}
					onCreate={(input) => createContractMutation.mutate(input)}
				/>
			</div>
		</MarketplaceShell>
	);
}

const INVOICE_CSV_COLUMNS: CsvColumn<FinanceInvoiceSummary>[] = [
	{ header: "Number", value: (row) => row.number },
	{
		header: "Project",
		value: (row) => row.project?.title ?? row.project_title_snapshot ?? "",
	},
	{
		header: "Status",
		value: (row) => financeStatusMeta(effectiveInvoiceStatus(row)).label,
	},
	{ header: "Currency", value: (row) => row.currency },
	{ header: "Total", value: (row) => row.total.toFixed(2) },
	{ header: "Paid", value: (row) => row.amount_paid.toFixed(2) },
	{ header: "Balance due", value: (row) => row.balance_due.toFixed(2) },
	{ header: "Issue date", value: (row) => row.issue_date ?? "" },
	{ header: "Due date", value: (row) => row.due_date ?? "" },
	{ header: "Days overdue", value: (row) => row.days_overdue },
	{ header: "Period start", value: (row) => row.period_start ?? "" },
	{ header: "Period end", value: (row) => row.period_end ?? "" },
	{ header: "Origin", value: (row) => row.origin },
];
