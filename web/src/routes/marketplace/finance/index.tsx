import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import {
	addMonths,
	eachDayOfInterval,
	endOfMonth,
	endOfWeek,
	format,
	isBefore,
	isSameDay,
	isSameMonth,
	isWithinInterval,
	startOfDay,
	startOfMonth,
	startOfWeek,
} from "date-fns";
import type { LucideIcon } from "lucide-react";
import {
	Activity,
	ArrowLeft,
	BarChart3,
	CalendarRange,
	Check,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	CircleDollarSign,
	FileSignature,
	FolderKanban,
	Handshake,
	Loader2,
	Plus,
	ReceiptText,
	RotateCcw,
	Search,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnchoredPopover } from "@/components/common/AnchoredPopover";
import {
	AppEmptyState,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { ModalPortal } from "@/components/common/ModalPortal";
import type { StepKey } from "@/components/finance/ProjectContract";
import { ProjectFinancials } from "@/components/finance/ProjectFinancials";
import { ProjectInvoices } from "@/components/finance/ProjectInvoices";
import { MarketplaceShell } from "@/components/layout/MarketplaceShell";
import { useToast } from "@/hooks/useToast";
import { isActiveConsultant } from "@/lib/auth-utils";
import { CURRENCY_CODE_OPTIONS, formatCurrency } from "@/lib/currency";
import {
	type ContractRelationshipKind,
	type ContractScopeMode,
	contractService,
} from "@/services/contract.service";
import {
	type Engagement,
	type EngagementTimeRate,
	engagementService,
} from "@/services/engagement.service";
import {
	type FinanceContractSummary,
	type FinanceFilters,
	type FinanceInvoiceSummary,
	type FinancePortfolio,
	financeService,
} from "@/services/finance.service";
import { useAuthStore, useProfile } from "@/stores/authStore";

type FinanceTab = "overview" | "contracts" | "engagements" | "invoices";

const FINANCE_TABS = [
	{ id: "overview", label: "Overview", icon: BarChart3 },
	{ id: "contracts", label: "Contracts", icon: FileSignature },
	{ id: "engagements", label: "Engagements", icon: Handshake },
	{ id: "invoices", label: "Invoices", icon: ReceiptText },
] as const;

const PROJECT_STATUS_OPTIONS = [
	"draft",
	"bidding",
	"active",
	"paused",
	"completed",
	"archived",
].map(toFilterOption);

const CONTRACT_STATUS_OPTIONS = [
	"draft",
	"sent",
	"signed",
	"active",
	"ended",
	"cancelled",
].map(toFilterOption);

const INVOICE_STATUS_OPTIONS = ["draft", "issued", "sent", "paid", "void"].map(
	toFilterOption,
);

function toFilterOption(value: string) {
	return {
		value,
		label: value.charAt(0).toUpperCase() + value.slice(1),
	};
}

interface FinanceSearch {
	tab: FinanceTab;
	q?: string;
	projectId?: string;
	projectStatus?: string;
	currency?: string;
	from?: string;
	to?: string;
	contractStatus?: string;
	invoiceStatus?: string;
	step?: StepKey;
}

const CONTRACT_STEPS: StepKey[] = [
	"parties",
	"terms",
	"services",
	"agreement",
	"signatures",
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
	}),
	component: FinancePage,
});

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function FinancePage() {
	const search = Route.useSearch();
	const navigate = useNavigate();
	const qc = useQueryClient();
	const toast = useToast();
	const profile = useProfile();
	const isConsultant = isActiveConsultant(profile);
	const [createContractOpen, setCreateContractOpen] = useState(false);
	const filters: FinanceFilters = {
		q: search.q,
		project_id: search.projectId,
		project_status: search.projectStatus,
		currency: search.currency,
		from: search.from,
		to: search.to,
	};
	const projectOptionsQuery = useQuery({
		queryKey: [
			"finance",
			"project-options",
			search.q,
			search.projectStatus,
			search.currency,
		],
		queryFn: () =>
			financeService.portfolio({
				q: search.q,
				project_status: search.projectStatus,
				currency: search.currency,
			}),
		enabled: isConsultant,
	});
	const portfolioQuery = useQuery({
		queryKey: ["finance", "portfolio", filters],
		queryFn: () => financeService.portfolio(filters),
		enabled: isConsultant,
	});
	const contractsQuery = useQuery({
		queryKey: ["finance", "contracts", filters, search.contractStatus],
		queryFn: () =>
			financeService.contracts({
				...filters,
				contract_status: search.contractStatus,
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
		queryKey: ["finance", "invoices", filters, search.invoiceStatus],
		queryFn: () =>
			financeService.invoices({
				...filters,
				invoice_status: search.invoiceStatus,
			}),
		enabled: isConsultant && search.tab === "invoices" && !search.projectId,
	});

	const updateSearch = (patch: Partial<FinanceSearch>) =>
		void navigate({
			to: "/marketplace/finance",
			search: { ...search, ...patch },
			replace: true,
		});
	const selectedProject = projectOptionsQuery.data?.projects.find(
		(project) => project.id === search.projectId,
	);
	const openContract = (contractId: string, section?: StepKey) =>
		void navigate({
			to: "/marketplace/finance/$contractId",
			params: { contractId },
			search: { section },
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
			FinanceContractSummary | undefined
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
								{projectOptionsQuery.isPending
									? "Loading projects…"
									: `${projectOptionsQuery.data?.projects.length ?? 0} projects`}
							</span>
						</div>

						<div className="mt-3 border-b border-border">
							<nav
								role="tablist"
								aria-label="Finance sections"
								className="-mb-px flex min-w-max gap-6 overflow-x-auto"
							>
								{FINANCE_TABS.map((tab) => {
									const Icon = tab.icon;
									const active = search.tab === tab.id;
									return (
										<button
											type="button"
											role="tab"
											id={`finance-tab-${tab.id}`}
											aria-selected={active}
											aria-controls="finance-tab-panel"
											key={tab.id}
											onClick={() =>
												updateSearch({
													tab: tab.id,
													projectId: undefined,
													step: undefined,
												})
											}
											className={`inline-flex h-10 items-center gap-2 border-b-2 px-1 text-xs font-semibold transition-colors ${
												active
													? "border-primary text-primary"
													: "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
											}`}
										>
											<Icon className="h-4 w-4" />
											{tab.label}
										</button>
									);
								})}
							</nav>
						</div>
					</header>

					<div
						id="finance-tab-panel"
						role="tabpanel"
						aria-labelledby={`finance-tab-${search.tab}`}
						className="outline-none"
					>
						<FinanceFiltersBar
							search={search}
							projects={projectOptionsQuery.data?.projects ?? []}
							onChange={updateSearch}
						/>

						{search.projectId && (
							<div className="mb-1 flex min-w-0 items-center gap-2 text-sm">
								<button
									type="button"
									onClick={() =>
										updateSearch({ projectId: undefined, step: undefined })
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
								onOpen={(contractId) => openContract(contractId)}
								onAddContract={() => setCreateContractOpen(true)}
								projectId={search.projectId}
								onCreate={
									search.projectId
										? () =>
												createContractMutation.mutate({
													project_id: search.projectId as string,
													relationship_kind: "client_services",
													scope_mode: "project_specific",
												})
										: undefined
								}
								creating={createContractMutation.isPending}
							/>
						)}
						{search.tab === "engagements" && (
							<EngagementPortfolio
								loading={engagementsQuery.isPending}
								error={engagementsQuery.error as Error | null}
								items={engagementsQuery.data ?? []}
								onOpenContract={(contractId) => openContract(contractId)}
							/>
						)}
						{search.tab === "invoices" &&
							(search.projectId ? (
								<ProjectInvoices projectId={search.projectId} />
							) : (
								<InvoicePortfolio
									loading={invoicesQuery.isPending}
									items={invoicesQuery.data?.items ?? []}
									onOpen={(projectId) => updateSearch({ projectId })}
								/>
							))}
					</div>
				</div>
				<CreateContractDialog
					open={createContractOpen}
					projects={projectOptionsQuery.data?.projects ?? []}
					loading={projectOptionsQuery.isPending}
					creating={createContractMutation.isPending}
					onClose={() => setCreateContractOpen(false)}
					onCreate={(input) => createContractMutation.mutate(input)}
				/>
			</div>
		</MarketplaceShell>
	);
}

function CreateContractDialog({
	open,
	projects,
	loading,
	creating,
	onClose,
	onCreate,
}: {
	open: boolean;
	projects: Array<{ id: string; title: string }>;
	loading: boolean;
	creating: boolean;
	onClose: () => void;
	onCreate: (input: {
		project_id?: string | null;
		relationship_kind: ContractRelationshipKind;
		scope_mode: ContractScopeMode;
		counterparty_user_id?: string;
	}) => void;
}) {
	const [query, setQuery] = useState("");
	const [selectedProjectId, setSelectedProjectId] = useState<string>();
	const [relationshipKind, setRelationshipKind] =
		useState<ContractRelationshipKind>("client_services");
	const [scopeMode, setScopeMode] =
		useState<ContractScopeMode>("project_specific");
	const [counterpartyEmail, setCounterpartyEmail] = useState("");
	const [counterparty, setCounterparty] = useState<{
		id: string;
		display_name: string | null;
		email: string | null;
	} | null>(null);
	const resolveCounterpartyMutation = useMutation({
		mutationFn: (email: string) => contractService.resolveCounterparty(email),
		onSuccess: (resolved) => setCounterparty(resolved),
	});
	useEffect(() => {
		if (!open) return;
		setQuery("");
		setSelectedProjectId(undefined);
		setRelationshipKind("client_services");
		setScopeMode("project_specific");
		setCounterpartyEmail("");
		setCounterparty(null);
	}, [open]);
	if (!open) return null;
	const visibleProjects = projects.filter((project) =>
		project.title.toLowerCase().includes(query.trim().toLowerCase()),
	);
	const requiresCounterparty =
		relationshipKind === "talent_services" || scopeMode === "flexible";
	const canCreate =
		(scopeMode === "flexible" || Boolean(selectedProjectId)) &&
		(!requiresCounterparty || Boolean(counterparty));

	return (
		<ModalPortal>
			<div className="fixed inset-0 z-80 flex items-center justify-center p-4">
				<button
					type="button"
					aria-label="Close add contract dialog"
					onClick={onClose}
					className="absolute inset-0 bg-foreground/30 backdrop-blur-[1px]"
				/>
				<div
					role="dialog"
					aria-modal="true"
					aria-labelledby="create-contract-title"
					className="relative w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl"
				>
					<div className="flex items-start justify-between gap-4">
						<div>
							<h2
								id="create-contract-title"
								className="text-base font-semibold text-foreground"
							>
								Create a contract
							</h2>
							<p className="mt-1 text-xs leading-5 text-muted-foreground">
								Set up the relationship and scope. You will add the terms in the
								draft.
							</p>
						</div>
						<button
							type="button"
							onClick={onClose}
							className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
							aria-label="Close"
						>
							<X className="h-4 w-4" />
						</button>
					</div>
					<div className="mt-4 grid grid-cols-2 gap-2">
						{(
							[
								["client_services", "Client hires Consultant"],
								["talent_services", "Consultant hires Talent"],
							] as const
						).map(([value, label]) => (
							<button
								type="button"
								key={value}
								onClick={() => setRelationshipKind(value)}
								className={`rounded-lg border px-3 py-2 text-left text-xs font-medium ${
									relationshipKind === value
										? "border-primary bg-primary/10 text-foreground"
										: "border-border text-muted-foreground hover:bg-muted"
								}`}
							>
								{label}
							</button>
						))}
					</div>
					<div className="mt-2 flex gap-2">
						{(
							[
								["project_specific", "One project"],
								["flexible", "Flexible"],
							] as const
						).map(([value, label]) => (
							<button
								type="button"
								key={value}
								onClick={() => setScopeMode(value)}
								className={`rounded-md px-2.5 py-1 text-xs font-medium ${
									scopeMode === value
										? "bg-foreground text-background"
										: "bg-muted text-muted-foreground hover:text-foreground"
								}`}
							>
								{label}
							</button>
						))}
					</div>
					{scopeMode === "project_specific" && (
						<>
							<div className="relative mt-4">
								<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
								<input
									autoFocus
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									placeholder="Search projects…"
									className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
								/>
							</div>
							<div className="mt-3 max-h-44 overflow-y-auto rounded-lg border border-border p-1">
								{loading ? (
									<div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
										<Loader2 className="h-4 w-4 animate-spin" /> Loading
										projects…
									</div>
								) : visibleProjects.length ? (
									visibleProjects.map((project) => {
										const selected = project.id === selectedProjectId;
										return (
											<button
												type="button"
												key={project.id}
												onClick={() => setSelectedProjectId(project.id)}
												className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
													selected
														? "bg-primary/10 text-foreground"
														: "hover:bg-muted"
												}`}
											>
												<span className="truncate">{project.title}</span>
												{selected && (
													<Check className="h-4 w-4 shrink-0 text-primary" />
												)}
											</button>
										);
									})
								) : (
									<p className="px-3 py-8 text-center text-xs text-muted-foreground">
										No matching projects.
									</p>
								)}
							</div>
						</>
					)}
					{requiresCounterparty && (
						<div className="mt-4 rounded-lg border border-border p-3">
							<p className="text-xs font-medium text-foreground">
								Counterparty account
							</p>
							<p className="mt-1 text-[11px] text-muted-foreground">
								Enter their exact Proyekto email. Private Talent contracts do
								not require a public freelancer listing.
							</p>
							<div className="mt-2 flex gap-2">
								<input
									value={counterpartyEmail}
									onChange={(event) => {
										setCounterpartyEmail(event.target.value);
										setCounterparty(null);
									}}
									placeholder="person@example.com"
									className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary"
								/>
								<button
									type="button"
									disabled={
										!counterpartyEmail.trim() ||
										resolveCounterpartyMutation.isPending
									}
									onClick={() =>
										resolveCounterpartyMutation.mutate(counterpartyEmail)
									}
									className="rounded-md bg-muted px-2.5 text-xs font-medium text-foreground disabled:opacity-50"
								>
									{resolveCounterpartyMutation.isPending
										? "Checking…"
										: "Confirm"}
								</button>
							</div>
							{counterparty && (
								<p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
									{counterparty.display_name || counterparty.email} confirmed
								</p>
							)}
							{resolveCounterpartyMutation.isError && (
								<p className="mt-2 text-xs text-destructive">
									{resolveCounterpartyMutation.error.message}
								</p>
							)}
						</div>
					)}
					<div className="mt-4 flex justify-end gap-2">
						<button
							type="button"
							onClick={onClose}
							disabled={creating}
							className="h-9 rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
						>
							Cancel
						</button>
						<button
							type="button"
							disabled={!canCreate || creating}
							onClick={() =>
								onCreate({
									project_id:
										scopeMode === "project_specific" ? selectedProjectId : null,
									relationship_kind: relationshipKind,
									scope_mode: scopeMode,
									...(counterparty
										? { counterparty_user_id: counterparty.id }
										: {}),
								})
							}
							className="app-cta inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
						>
							{creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
							Create draft
						</button>
					</div>
				</div>
			</div>
		</ModalPortal>
	);
}

function FinanceFiltersBar({
	search,
	projects,
	onChange,
}: {
	search: FinanceSearch;
	projects: Array<{ id: string; title: string }>;
	onChange: (patch: Partial<FinanceSearch>) => void;
}) {
	const activeFilterCount = [
		search.q,
		search.projectId,
		search.projectStatus,
		search.currency,
		search.from || search.to,
		search.tab === "contracts" ? search.contractStatus : undefined,
		search.tab === "invoices" ? search.invoiceStatus : undefined,
	].filter(Boolean).length;
	const clearFilters = () =>
		onChange({
			q: undefined,
			projectId: undefined,
			projectStatus: undefined,
			currency: undefined,
			from: undefined,
			to: undefined,
			contractStatus: undefined,
			invoiceStatus: undefined,
			step: undefined,
		});

	return (
		<div className="relative my-4 rounded-xl border border-border bg-card p-3 shadow-sm">
			<div
				role="toolbar"
				aria-label="Finance filters"
				className="flex flex-col gap-3 lg:flex-row lg:items-center"
			>
				<div className="relative min-w-0 flex-1 lg:max-w-sm">
					<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<input
						aria-label="Search projects"
						value={search.q ?? ""}
						onChange={(event) =>
							onChange({ q: event.target.value || undefined })
						}
						placeholder="Search projects…"
						className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-9 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
					/>
					{search.q && (
						<button
							type="button"
							aria-label="Clear project search"
							onClick={() => onChange({ q: undefined })}
							className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					)}
				</div>

				<div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-0.5">
					<FinanceFacetFilter
						icon={FolderKanban}
						label="Project"
						emptyLabel="All projects"
						value={search.projectId}
						onChange={(projectId) => onChange({ projectId })}
						searchable
						options={projects.map((project) => ({
							value: project.id,
							label: project.title,
						}))}
					/>
					<FinanceFacetFilter
						icon={Activity}
						label="Status"
						emptyLabel="Any project status"
						value={search.projectStatus}
						onChange={(projectStatus) => onChange({ projectStatus })}
						options={PROJECT_STATUS_OPTIONS}
					/>
					<FinanceFacetFilter
						icon={CircleDollarSign}
						label="Currency"
						emptyLabel="All currencies"
						value={search.currency}
						onChange={(currency) => onChange({ currency })}
						options={CURRENCY_CODE_OPTIONS.map((value) => ({
							value,
							label: value,
						}))}
					/>
					<FinanceDateFilter
						from={search.from}
						to={search.to}
						onChange={onChange}
					/>
					{search.tab === "contracts" && (
						<FinanceFacetFilter
							icon={FileSignature}
							label="Contract"
							emptyLabel="Any contract status"
							value={search.contractStatus}
							onChange={(contractStatus) => onChange({ contractStatus })}
							options={CONTRACT_STATUS_OPTIONS}
						/>
					)}
					{search.tab === "invoices" && (
						<FinanceFacetFilter
							icon={ReceiptText}
							label="Invoice"
							emptyLabel="Any invoice status"
							value={search.invoiceStatus}
							onChange={(invoiceStatus) => onChange({ invoiceStatus })}
							options={INVOICE_STATUS_OPTIONS}
						/>
					)}
				</div>
			</div>
			{activeFilterCount > 0 && (
				<button
					type="button"
					onClick={clearFilters}
					className="absolute -top-3 right-3 inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-[11px] font-medium text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
				>
					<RotateCcw className="h-3.5 w-3.5" />
					Reset
				</button>
			)}
		</div>
	);
}

interface FinanceFilterOption {
	value: string;
	label: string;
}

function FinanceFacetFilter({
	icon: Icon,
	label,
	emptyLabel,
	value,
	onChange,
	options,
	searchable = false,
}: {
	icon: LucideIcon;
	label: string;
	emptyLabel: string;
	value?: string;
	onChange: (value: string | undefined) => void;
	options: FinanceFilterOption[];
	searchable?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const triggerRef = useRef<HTMLButtonElement>(null);
	const selected = options.find((option) => option.value === value);
	const visibleOptions = query
		? options.filter((option) =>
				option.label.toLowerCase().includes(query.toLowerCase()),
			)
		: options;
	const close = () => {
		setOpen(false);
		setQuery("");
	};
	const select = (nextValue?: string) => {
		onChange(nextValue);
		close();
	};

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				aria-haspopup="listbox"
				aria-expanded={open}
				onClick={() => setOpen((current) => !current)}
				className={`inline-flex h-9 max-w-full items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium shadow-sm outline-none transition-colors focus:ring-2 focus:ring-primary/20 ${
					selected
						? "border-primary/30 bg-primary/5 text-foreground"
						: "border-dashed border-input bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground"
				}`}
			>
				<Icon className="h-3.5 w-3.5 shrink-0" />
				<span>{label}</span>
				{selected && (
					<>
						<span className="mx-0.5 h-4 w-px bg-border" />
						<span className="max-w-32 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-foreground">
							{selected.label}
						</span>
					</>
				)}
				<ChevronDown
					className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
				/>
			</button>

			<AnchoredPopover
				anchorRef={triggerRef}
				open={open}
				onClose={close}
				width={searchable ? 280 : 240}
				maxHeight={360}
				ariaLabel={`${label} filter`}
				className="overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
			>
				{searchable && (
					<div className="border-b border-border p-2">
						<div className="relative">
							<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
							<input
								autoFocus
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder={`Search ${label.toLowerCase()}s…`}
								className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
							/>
						</div>
					</div>
				)}
				<div role="listbox" className="max-h-72 overflow-y-auto p-1">
					<FinanceFilterOptionRow
						label={emptyLabel}
						selected={!value}
						onClick={() => select(undefined)}
					/>
					{visibleOptions.map((option) => (
						<FinanceFilterOptionRow
							key={option.value}
							label={option.label}
							selected={option.value === value}
							onClick={() => select(option.value)}
						/>
					))}
					{visibleOptions.length === 0 && (
						<p className="px-3 py-6 text-center text-xs text-muted-foreground">
							No matches found
						</p>
					)}
				</div>
			</AnchoredPopover>
		</>
	);
}

function FinanceFilterOptionRow({
	label,
	selected,
	onClick,
}: {
	label: string;
	selected: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			role="option"
			aria-selected={selected}
			onClick={onClick}
			className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-foreground transition-colors hover:bg-muted"
		>
			<span
				className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
					selected
						? "border-primary bg-primary text-primary-foreground"
						: "border-input bg-background"
				}`}
			>
				{selected && <Check className="h-3 w-3" />}
			</span>
			<span className="truncate">{label}</span>
		</button>
	);
}

function FinanceDateFilter({
	from,
	to,
	onChange,
}: {
	from?: string;
	to?: string;
	onChange: (patch: Partial<FinanceSearch>) => void;
}) {
	const [open, setOpen] = useState(false);
	const [draftStart, setDraftStart] = useState<Date | null>(null);
	const [draftEnd, setDraftEnd] = useState<Date | null>(null);
	const [hoveredDay, setHoveredDay] = useState<Date | null>(null);
	const [viewMonth, setViewMonth] = useState(() =>
		startOfMonth(parseYmd(from) ?? new Date()),
	);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const active = Boolean(from || to);
	const rangeLabel = formatDateRange(from, to);

	useEffect(() => {
		if (!open) return;
		const start = parseYmd(from);
		setDraftStart(start);
		setDraftEnd(parseYmd(to));
		setHoveredDay(null);
		setViewMonth(startOfMonth(start ?? new Date()));
	}, [open, from, to]);

	const pickDay = (day: Date) => {
		if (!draftStart || draftEnd) {
			setDraftStart(day);
			setDraftEnd(null);
			return;
		}
		if (isBefore(day, draftStart)) {
			setDraftEnd(draftStart);
			setDraftStart(day);
			return;
		}
		setDraftEnd(day);
	};

	const applyDraft = () => {
		if (!draftStart || !draftEnd) return;
		onChange({ from: toIsoDate(draftStart), to: toIsoDate(draftEnd) });
		setOpen(false);
	};

	const applyPreset = (preset: "month" | "30-days" | "year") => {
		const today = new Date();
		let start: Date;
		if (preset === "month") {
			start = new Date(today.getFullYear(), today.getMonth(), 1);
		} else if (preset === "year") {
			start = new Date(today.getFullYear(), 0, 1);
		} else {
			start = new Date(today);
			start.setDate(today.getDate() - 29);
		}
		onChange({ from: toIsoDate(start), to: toIsoDate(today) });
		setOpen(false);
	};

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				aria-haspopup="dialog"
				aria-expanded={open}
				onClick={() => setOpen((current) => !current)}
				className={`inline-flex h-9 max-w-full items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium shadow-sm outline-none transition-colors focus:ring-2 focus:ring-primary/20 ${
					active
						? "border-primary/30 bg-primary/5 text-foreground"
						: "border-dashed border-input bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground"
				}`}
			>
				<CalendarRange className="h-3.5 w-3.5 shrink-0" />
				<span>Date</span>
				{active && (
					<>
						<span className="mx-0.5 h-4 w-px bg-border" />
						<span className="truncate rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-foreground">
							{rangeLabel}
						</span>
					</>
				)}
				<ChevronDown
					className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
				/>
			</button>

			<AnchoredPopover
				anchorRef={triggerRef}
				open={open}
				onClose={() => setOpen(false)}
				width={
					typeof window !== "undefined" && window.innerWidth < 640
						? Math.min(336, window.innerWidth - 16)
						: 620
				}
				maxHeight={520}
				ariaLabel="Date range filter"
				className="overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
			>
				<div className="flex items-center justify-between border-b border-border px-4 py-3">
					<div>
						<p className="text-sm font-semibold text-foreground">
							Select range
						</p>
						<p className="mt-0.5 text-xs text-muted-foreground">
							Choose a start and end date
						</p>
					</div>
					{active && (
						<button
							type="button"
							onClick={() => {
								onChange({ from: undefined, to: undefined });
								setOpen(false);
							}}
							className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
						>
							Clear
						</button>
					)}
				</div>

				<div className="grid gap-5 p-4 sm:grid-cols-2">
					<div className="relative">
						<button
							type="button"
							onClick={() => setViewMonth((month) => addMonths(month, -1))}
							aria-label="Previous month"
							className="absolute left-0 top-0 z-10 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
						>
							<ChevronLeft className="h-4 w-4" />
						</button>
						<button
							type="button"
							onClick={() => setViewMonth((month) => addMonths(month, 1))}
							aria-label="Next month"
							className="absolute right-0 top-0 z-10 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground sm:hidden"
						>
							<ChevronRight className="h-4 w-4" />
						</button>
						<FinanceMonthGrid
							month={viewMonth}
							draftStart={draftStart}
							draftEnd={draftEnd}
							hoveredDay={hoveredDay}
							onHover={setHoveredDay}
							onPick={pickDay}
						/>
					</div>
					<div className="relative hidden sm:block">
						<button
							type="button"
							onClick={() => setViewMonth((month) => addMonths(month, 1))}
							aria-label="Next month"
							className="absolute right-0 top-0 z-10 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
						>
							<ChevronRight className="h-4 w-4" />
						</button>
						<FinanceMonthGrid
							month={addMonths(viewMonth, 1)}
							draftStart={draftStart}
							draftEnd={draftEnd}
							hoveredDay={hoveredDay}
							onHover={setHoveredDay}
							onPick={pickDay}
						/>
					</div>
				</div>

				<div className="border-t border-border bg-muted/20 px-4 py-3">
					<div className="flex flex-wrap items-center gap-1.5">
						<span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
							Quick ranges
						</span>
						{[
							{ value: "30-days" as const, label: "Last 30 days" },
							{ value: "month" as const, label: "This month" },
							{ value: "year" as const, label: "This year" },
						].map((preset) => (
							<button
								type="button"
								key={preset.value}
								onClick={() => applyPreset(preset.value)}
								className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
							>
								{preset.label}
							</button>
						))}
					</div>
					<div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
						<p className="min-w-0 truncate text-xs text-muted-foreground">
							{draftStart
								? `${format(draftStart, "MMM d, yyyy")} – ${draftEnd ? format(draftEnd, "MMM d, yyyy") : "Select end date"}`
								: "Select a start date"}
						</p>
						<div className="flex shrink-0 items-center gap-2">
							<button
								type="button"
								onClick={() => setOpen(false)}
								className="rounded-md px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={applyDraft}
								disabled={!draftStart || !draftEnd}
								className="rounded-md bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
							>
								Apply range
							</button>
						</div>
					</div>
				</div>
			</AnchoredPopover>
		</>
	);
}

const FINANCE_WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function FinanceMonthGrid({
	month,
	draftStart,
	draftEnd,
	hoveredDay,
	onHover,
	onPick,
}: {
	month: Date;
	draftStart: Date | null;
	draftEnd: Date | null;
	hoveredDay: Date | null;
	onHover: (day: Date | null) => void;
	onPick: (day: Date) => void;
}) {
	const days = useMemo(() => {
		const firstDay = startOfWeek(startOfMonth(month));
		return eachDayOfInterval({
			start: firstDay,
			end: endOfWeek(endOfMonth(month)),
		});
	}, [month]);
	const previewEnd = draftEnd ?? (draftStart ? hoveredDay : null);
	let rangeStart = draftStart;
	let rangeEnd = previewEnd;
	if (rangeStart && rangeEnd && isBefore(rangeEnd, rangeStart)) {
		[rangeStart, rangeEnd] = [rangeEnd, rangeStart];
	}

	return (
		<div>
			<h3 className="flex h-8 items-center justify-center px-9 text-sm font-semibold text-foreground">
				{format(month, "MMMM yyyy")}
			</h3>
			<div className="mt-2 grid grid-cols-7">
				{FINANCE_WEEKDAYS.map((weekday) => (
					<div
						key={weekday}
						className="flex h-8 items-center justify-center text-[11px] font-medium text-muted-foreground"
					>
						{weekday}
					</div>
				))}
				{days.map((day) => {
					const isStart = Boolean(draftStart && isSameDay(day, draftStart));
					const isEnd = Boolean(draftEnd && isSameDay(day, draftEnd));
					const isEndpoint = isStart || isEnd;
					const inRange = Boolean(
						rangeStart &&
							rangeEnd &&
							isWithinInterval(day, {
								start: startOfDay(rangeStart),
								end: startOfDay(rangeEnd),
							}),
					);
					const inMonth = isSameMonth(day, month);
					const today = isSameDay(day, new Date());
					return (
						<button
							type="button"
							key={toIsoDate(day)}
							onMouseEnter={() => onHover(day)}
							onMouseLeave={() => onHover(null)}
							onFocus={() => onHover(day)}
							onClick={() => onPick(day)}
							aria-label={format(day, "MMMM d, yyyy")}
							aria-pressed={isEndpoint}
							className={`relative flex h-9 items-center justify-center text-xs transition-colors ${
								isEndpoint
									? "z-10 rounded-md bg-primary font-semibold text-primary-foreground shadow-sm"
									: inRange
										? "bg-primary/10 font-medium text-foreground"
										: inMonth
											? "rounded-md text-foreground hover:bg-muted"
											: "rounded-md text-muted-foreground/45 hover:bg-muted/60"
							} ${today && !isEndpoint ? "font-semibold ring-1 ring-inset ring-primary/40" : ""}`}
						>
							{format(day, "d")}
						</button>
					);
				})}
			</div>
		</div>
	);
}

function parseYmd(value?: string): Date | null {
	if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const date = new Date(`${value}T00:00:00`);
	return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function formatDateRange(from?: string, to?: string): string {
	const format = (value: string) =>
		new Intl.DateTimeFormat(undefined, {
			month: "short",
			day: "numeric",
		}).format(new Date(`${value}T00:00:00`));
	if (from && to) return `${format(from)} – ${format(to)}`;
	if (from) return `From ${format(from)}`;
	if (to) return `Until ${format(to)}`;
	return "Any date";
}

function PortfolioOverview({
	loading,
	portfolio,
	onOpen,
}: {
	loading: boolean;
	portfolio?: FinancePortfolio;
	onOpen: (projectId: string) => void;
}) {
	if (loading) return <Loading />;
	if (!portfolio?.projects.length) return <NoFinanceData />;
	return (
		<div className="space-y-5 pb-8">
			<FinanceSectionHeading
				eyebrow="Portfolio overview"
				title="Project performance"
				description="Compare billed revenue, delivery cost, and margin without mixing currencies."
				count={`${portfolio.projects.length} ${portfolio.projects.length === 1 ? "project" : "projects"}`}
			/>
			<div className="grid gap-4 lg:grid-cols-2">
				{portfolio.totals_by_currency.map((total) => (
					<AppSurfaceCard key={total.currency} className="overflow-hidden p-5">
						<div className="flex items-start justify-between gap-4">
							<div>
								<p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
									{total.currency} portfolio margin
								</p>
								<p className="mt-2 text-2xl font-bold tracking-tight text-foreground tabular-nums">
									{formatCurrency(total.margin, total.currency)}
								</p>
							</div>
							<span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
								<CircleDollarSign className="h-5 w-5" />
							</span>
						</div>
						<div className="mt-5 grid grid-cols-2 gap-4 border-t border-border/70 pt-4 sm:grid-cols-4">
							<div>
								<p className="text-xs text-muted-foreground">Billed</p>
								<p className="mt-1 font-semibold text-foreground tabular-nums">
									{formatCurrency(total.revenue, total.currency)}
								</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">Collected</p>
								<p className="mt-1 font-semibold text-foreground tabular-nums">
									{formatCurrency(total.collected, total.currency)}
								</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">Outstanding</p>
								<p className="mt-1 font-semibold text-foreground tabular-nums">
									{formatCurrency(total.outstanding, total.currency)}
								</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">Delivery cost</p>
								<p className="mt-1 font-semibold text-foreground tabular-nums">
									{formatCurrency(total.cost, total.currency)}
								</p>
							</div>
						</div>
						<p className="mt-4 text-xs text-muted-foreground">
							{total.project_count}{" "}
							{total.project_count === 1 ? "project" : "projects"} ·{" "}
							{total.invoice_count}{" "}
							{total.invoice_count === 1 ? "invoice" : "invoices"}
						</p>
					</AppSurfaceCard>
				))}
			</div>
			<AppSurfaceCard className="overflow-hidden">
				<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-4">
					<div>
						<h3 className="font-semibold text-foreground">Projects</h3>
						<p className="mt-0.5 text-xs text-muted-foreground">
							Select a row to open its financial workspace
						</p>
					</div>
					<span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
						{portfolio.projects.length} total
					</span>
				</div>
				<div className="overflow-x-auto">
					<table className="w-full text-left text-sm">
						<thead className="border-b border-border bg-muted/50 text-xs uppercase text-muted-foreground">
							<tr>
								<th className="px-4 py-3">Project</th>
								<th className="px-4 py-3">Revenue</th>
								<th className="px-4 py-3">Cost</th>
								<th className="px-4 py-3">Margin</th>
								<th className="px-4 py-3">Contract</th>
							</tr>
						</thead>
						<tbody>
							{portfolio.projects.map((project) => (
								<tr
									key={project.id}
									className="cursor-pointer border-b border-border/70 hover:bg-muted/40"
									onClick={() => onOpen(project.id)}
								>
									<td className="px-4 py-3">
										<p className="font-semibold text-foreground">
											{project.title}
										</p>
										<p className="text-xs capitalize text-muted-foreground">
											{project.status}
										</p>
									</td>
									<td className="px-4 py-3 tabular-nums">
										{formatCurrency(project.revenue, project.currency)}
									</td>
									<td className="px-4 py-3 tabular-nums">
										{formatCurrency(project.cost, project.currency)}
									</td>
									<td className="px-4 py-3 font-semibold tabular-nums">
										{formatCurrency(project.margin, project.currency)}
									</td>
									<td className="px-4 py-3">
										{project.latest_contract ? (
											<FinanceStatusBadge
												status={project.latest_contract.status}
											/>
										) : (
											<span className="text-muted-foreground">Not created</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</AppSurfaceCard>
		</div>
	);
}

function ContractPortfolio({
	loading,
	items,
	onOpen,
	onAddContract,
	projectId,
	onCreate,
	creating = false,
}: {
	loading: boolean;
	items: FinanceContractSummary[];
	onOpen: (id: string) => void;
	onAddContract: () => void;
	projectId?: string;
	onCreate?: () => void;
	creating?: boolean;
}) {
	if (loading) return <Loading />;
	if (!items.length) {
		if (!projectId || !onCreate) {
			return (
				<AppEmptyState
					icon={FileSignature}
					title="No contracts yet"
					description="Create a draft agreement for any project, then complete its terms in the document editor."
					action={
						<button
							type="button"
							onClick={onAddContract}
							className="app-cta inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white"
						>
							<Plus className="h-4 w-4" /> Add contract
						</button>
					}
				/>
			);
		}
		return (
			<AppEmptyState
				icon={FileSignature}
				title="No contract for this project"
				description="Create a draft agreement, then complete its terms in the document editor."
				action={
					<button
						type="button"
						onClick={onCreate}
						disabled={creating}
						className="app-cta rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
					>
						{creating ? "Creating…" : "Create draft contract"}
					</button>
				}
			/>
		);
	}
	return (
		<div className="space-y-5 pb-8">
			<div className="flex items-end justify-between gap-4">
				<FinanceSectionHeading
					eyebrow={projectId ? "Project contracts" : "Contract portfolio"}
					title="Client agreements"
					description="Review every agreement version and open it in the document editor."
					count={`${items.length} ${items.length === 1 ? "contract" : "contracts"}`}
				/>
				<button
					type="button"
					onClick={onAddContract}
					className="app-cta mb-1 ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white"
				>
					<Plus className="h-3.5 w-3.5" /> Add contract
				</button>
				{projectId && onCreate && (
					<button
						type="button"
						onClick={onCreate}
						disabled={creating}
						className="app-cta mb-1 shrink-0 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
					>
						{creating ? "Creating…" : "+ New version"}
					</button>
				)}
			</div>
			<AppSurfaceCard className="divide-y divide-border overflow-hidden">
				{items.map((item) => (
					<button
						type="button"
						key={item.id}
						onClick={() => onOpen(item.id)}
						className="group flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-muted/40 md:px-5 md:py-4"
					>
						<span className="flex min-w-0 items-center gap-3">
							<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
								<FileSignature className="h-5 w-5" />
							</span>
							<span className="min-w-0">
								<span className="block truncate font-semibold text-foreground">
									{item.project?.title ??
										item.project_title_snapshot ??
										(item.scope_mode === "flexible"
											? "Flexible engagement"
											: "Project removed")}
								</span>
								<span className="mt-1 block truncate text-xs text-muted-foreground">
									{item.contract_number ?? `Version ${item.version}`} ·{" "}
									{item.relationship_kind === "talent_services"
										? (item.provider_name ?? "Talent not set")
										: (item.client_name ?? "Client not set")}
								</span>
							</span>
						</span>
						<span className="flex shrink-0 items-center gap-3">
							<FinanceStatusBadge status={item.status} />
							<ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
						</span>
					</button>
				))}
			</AppSurfaceCard>
		</div>
	);
}

const RATE_UNIT_SUFFIX: Record<string, string> = {
	hour: "/hr",
	month: "/mo",
	fixed: " fixed",
};

function describeRate(rate: EngagementTimeRate): string {
	const amount = formatCurrency(rate.amount, rate.currency ?? "USD");
	return `${amount}${RATE_UNIT_SUFFIX[rate.unit] ?? ""}`;
}

function describeScope(engagement: Engagement): string {
	const active = engagement.project_links.filter(
		(link) => link.status !== "ended",
	);
	if (engagement.scope_mode === "flexible" && active.length === 0) {
		return "Flexible · no projects placed yet";
	}
	if (active.length === 0) return "No linked project";
	if (active.length === 1) return active[0].project_title_snapshot;
	return `${active.length} projects`;
}

function EngagementPortfolio({
	loading,
	error,
	items,
	onOpenContract,
}: {
	loading: boolean;
	error: Error | null;
	items: Engagement[];
	onOpenContract: (contractId: string) => void;
}) {
	if (loading) return <Loading />;
	if (error) {
		return (
			<AppEmptyState
				icon={Handshake}
				title="Could not load engagements"
				description={error.message}
			/>
		);
	}
	if (!items.length) {
		return (
			<AppEmptyState
				icon={Handshake}
				title="No engagements yet"
				description="An engagement is created when both parties finish signing a contract. Sign a contract to start one."
			/>
		);
	}
	return (
		<div className="space-y-5 pb-8">
			<FinanceSectionHeading
				eyebrow="Commercial relationships"
				title="Engagements"
				description="Who hired whom, the projects each relationship covers, and the signed terms in effect today."
				count={`${items.length} ${items.length === 1 ? "engagement" : "engagements"}`}
			/>
			<AppSurfaceCard className="divide-y divide-border overflow-hidden">
				{items.map((engagement) => {
					const counterpartyName =
						engagement.counterparty?.display_name_snapshot ??
						engagement.counterparty?.email_snapshot ??
						"Counterparty removed";
					const isClientSide = engagement.kind === "client_services";
					const relationship =
						engagement.viewer_position === "hirer"
							? `You hired ${counterpartyName}`
							: `${counterpartyName} hired you`;
					return (
						<div
							key={engagement.id}
							className="flex w-full items-center justify-between gap-4 p-4 text-left md:px-5 md:py-4"
						>
							<span className="flex min-w-0 items-center gap-3">
								<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
									<Handshake className="h-5 w-5" />
								</span>
								<span className="min-w-0">
									<span className="block truncate font-semibold text-foreground">
										{relationship}
									</span>
									<span className="mt-1 block truncate text-xs text-muted-foreground">
										{isClientSide ? "Client engagement" : "Talent engagement"} ·{" "}
										{describeScope(engagement)}
									</span>
								</span>
							</span>
							<span className="flex shrink-0 items-center gap-3">
								{engagement.current_rates.length > 0 && (
									<span className="hidden text-xs font-medium text-muted-foreground sm:block">
										{engagement.current_rates.map(describeRate).join(" · ")}
									</span>
								)}
								<FinanceStatusBadge status={engagement.status} />
								{engagement.activated_by_contract_id && (
									<button
										type="button"
										onClick={() =>
											onOpenContract(
												engagement.activated_by_contract_id as string,
											)
										}
										className="text-xs font-semibold text-primary hover:underline"
									>
										Contract
									</button>
								)}
							</span>
						</div>
					);
				})}
			</AppSurfaceCard>
		</div>
	);
}

function InvoicePortfolio({
	loading,
	items,
	onOpen,
}: {
	loading: boolean;
	items: FinanceInvoiceSummary[];
	onOpen: (id: string) => void;
}) {
	if (loading) return <Loading />;
	if (!items.length) return <NoFinanceData />;
	return (
		<div className="space-y-5 pb-8">
			<FinanceSectionHeading
				eyebrow="Invoice portfolio"
				title="Client billing"
				description="Track invoices across projects, then open a project to issue or manage them."
				count={`${items.length} ${items.length === 1 ? "invoice" : "invoices"}`}
			/>
			<AppSurfaceCard className="divide-y divide-border overflow-hidden">
				{items.map((item) => (
					<button
						type="button"
						key={item.id}
						onClick={() => item.project_id && onOpen(item.project_id)}
						disabled={!item.project_id}
						className="group flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-muted/40 disabled:cursor-default disabled:hover:bg-transparent md:px-5 md:py-4"
					>
						<span className="flex min-w-0 items-center gap-3">
							<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
								<ReceiptText className="h-5 w-5" />
							</span>
							<span className="min-w-0">
								<span className="block truncate font-semibold text-foreground">
									{item.number} ·{" "}
									{item.project?.title ??
										item.project_title_snapshot ??
										"Project removed"}
								</span>
								<span className="mt-1 block truncate text-xs text-muted-foreground">
									{item.due_date ? `Due ${item.due_date}` : "No due date"} ·{" "}
									{item.origin}
								</span>
							</span>
						</span>
						<span className="flex shrink-0 items-center gap-3">
							<span className="text-right">
								<span className="block font-semibold text-foreground tabular-nums">
									{formatCurrency(item.total, item.currency)}
								</span>
								<span className="mt-1 hidden sm:block">
									<FinanceStatusBadge status={item.status} />
								</span>
							</span>
							<ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
						</span>
					</button>
				))}
			</AppSurfaceCard>
		</div>
	);
}

function FinanceSectionHeading({
	eyebrow,
	title,
	description,
	count,
}: {
	eyebrow: string;
	title: string;
	description: string;
	count: string;
}) {
	return (
		<div className="flex flex-col justify-between gap-3 pt-1 sm:flex-row sm:items-end">
			<div>
				<p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
					{eyebrow}
				</p>
				<h2 className="mt-1 text-xl font-bold tracking-tight text-foreground">
					{title}
				</h2>
				<p className="mt-1 text-sm text-muted-foreground">{description}</p>
			</div>
			<span className="w-fit rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm">
				{count}
			</span>
		</div>
	);
}

function FinanceStatusBadge({ status }: { status: string }) {
	const normalized = status.toLowerCase();
	const tone = ["active", "paid", "signed"].includes(normalized)
		? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300"
		: ["issued", "sent"].includes(normalized)
			? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300"
			: "border-border bg-muted/60 text-muted-foreground";

	return (
		<span
			className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${tone}`}
		>
			{status}
		</span>
	);
}

function Loading() {
	return (
		<div className="flex justify-center py-16">
			<Loader2 className="h-6 w-6 animate-spin text-primary" />
		</div>
	);
}

function NoFinanceData() {
	return (
		<AppEmptyState
			icon={CircleDollarSign}
			title="No finance records match"
			description="Adjust the filters or choose another project."
		/>
	);
}
