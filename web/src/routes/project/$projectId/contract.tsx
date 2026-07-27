import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import {
	AlertTriangle,
	CheckCircle2,
	Circle,
	FileSignature,
	Loader2,
	PenLine,
	Rocket,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
	AppSectionHeader,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { useToast } from "@/hooks/useToast";
import {
	type BillingMode,
	type ContractTermUnit,
	formatContractDate,
	formatMoney,
	formatPeriodRange,
	type InvoiceCadence,
} from "@/lib/contract-term";
import {
	type ActivationChecklist,
	type Contract,
	type ContractClause,
	type ContractService,
	contractService,
	type ProjectEconomics,
} from "@/services/contract.service";
import { projectService } from "@/services/project.service";
import { useAuthStore, useUser } from "@/stores/authStore";

export const Route = createFileRoute("/project/$projectId/contract")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) throw redirect({ to: "/auth/login" });
	},
	component: ProjectContractPage,
});

function ProjectContractPage() {
	const { projectId } = Route.useParams();
	const user = useUser();
	const qc = useQueryClient();
	const toast = useToast();

	const projectQuery = useQuery({
		queryKey: ["project", projectId],
		queryFn: () => projectService.get(projectId),
	});
	const project = projectQuery.data;

	// The consultant of record edits terms and sees economics. Everyone else
	// (including the client) gets a read-only agreement plus the sign action.
	const isConsultant = Boolean(user?.id && project?.consultant_id === user.id);

	const contractsQuery = useQuery({
		queryKey: ["contracts", projectId],
		queryFn: () => contractService.listByProject(projectId),
	});
	// Newest version governs; older versions are history.
	const contract = contractsQuery.data?.[0] ?? null;

	const economicsQuery = useQuery({
		queryKey: ["project", projectId, "economics"],
		queryFn: () => contractService.getEconomics(projectId),
		enabled: isConsultant,
	});

	const checklistQuery = useQuery({
		queryKey: ["project", projectId, "activation-checklist"],
		queryFn: () => contractService.getActivationChecklist(projectId),
		enabled: isConsultant,
	});

	const invalidateAll = () => {
		void qc.invalidateQueries({ queryKey: ["contracts", projectId] });
		void qc.invalidateQueries({ queryKey: ["project", projectId] });
	};

	const createMutation = useMutation({
		mutationFn: () => contractService.create(projectId, {}),
		onSuccess: () => {
			toast.success("Draft contract created");
			invalidateAll();
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const signMutation = useMutation({
		mutationFn: ({
			party,
			name,
		}: {
			party: "consultant" | "client";
			name: string;
		}) => contractService.sign(contract?.id as string, party, name),
		onSuccess: () => {
			toast.success("Signature recorded");
			invalidateAll();
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const activateMutation = useMutation({
		mutationFn: () => projectService.update(projectId, { status: "active" }),
		onSuccess: () => {
			toast.success("Project activated");
			invalidateAll();
		},
		onError: (err: Error) => toast.error(err.message),
	});

	if (projectQuery.isPending || contractsQuery.isPending) {
		return (
			<div className="app-shell-bg flex h-full items-center justify-center">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="app-shell-bg h-full w-full overflow-y-auto">
			<div className="mx-auto w-full max-w-5xl px-5 py-6 md:px-8 md:py-8">
				<AppSurfaceCard strong className="mb-6 p-6">
					<AppSectionHeader
						kicker="Finance"
						title="Contract"
						subtitle="What the client pays, for how long, and how the money splits between the company and the team."
						rightSlot={
							contract ? <ContractStatusChip status={contract.status} /> : null
						}
					/>
				</AppSurfaceCard>

				{!contract ? (
					<AppSurfaceCard className="p-8 text-center">
						<FileSignature className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
						<p className="text-sm font-semibold text-foreground">
							No contract yet
						</p>
						<p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
							A contract sets the recurring fee or client rate, the term, and
							the billing schedule. The project can't be activated without one.
						</p>
						{isConsultant && (
							<button
								type="button"
								onClick={() => createMutation.mutate()}
								disabled={createMutation.isPending}
								className="app-cta mt-5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
							>
								{createMutation.isPending
									? "Creating…"
									: "Create draft contract"}
							</button>
						)}
					</AppSurfaceCard>
				) : (
					<div className="space-y-6">
						<PartiesSection contract={contract} editable={isConsultant} />
						<TermsSection contract={contract} editable={isConsultant} />
						<ServicesSection contract={contract} editable={isConsultant} />
						{isConsultant && (
							<EconomicsSection
								projectId={projectId}
								contract={contract}
								economics={economicsQuery.data ?? null}
								isLoading={economicsQuery.isPending}
							/>
						)}
						<AgreementSection contract={contract} editable={isConsultant} />
						<SignatureSection
							contract={contract}
							canSignAsConsultant={isConsultant}
							canSignAsClient={
								Boolean(user?.id) &&
								(contract.client_user_id === user?.id ||
									project?.client_id === user?.id)
							}
							onSign={(party, name) => signMutation.mutate({ party, name })}
							isPending={signMutation.isPending}
						/>
						{isConsultant && (
							<ActivationSection
								checklist={checklistQuery.data ?? null}
								isLoading={checklistQuery.isPending}
								projectStatus={project?.status ?? null}
								onActivate={() => activateMutation.mutate()}
								isActivating={activateMutation.isPending}
							/>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

/* ── Status chip ──────────────────────────────────────────────────────────── */

function ContractStatusChip({ status }: { status: Contract["status"] }) {
	const classes: Record<Contract["status"], string> = {
		draft: "bg-muted text-muted-foreground border-border",
		sent: "bg-amber-500/15 text-amber-600 border-amber-500/30",
		signed: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
		active: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
		ended: "bg-muted text-muted-foreground border-border",
		cancelled: "bg-destructive/10 text-destructive border-destructive/30",
	};
	return (
		<span
			className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${classes[status]}`}
		>
			{status}
		</span>
	);
}

/* ── Parties ──────────────────────────────────────────────────────────────── */

function PartiesSection({
	contract,
	editable,
}: {
	contract: Contract;
	editable: boolean;
}) {
	const qc = useQueryClient();
	const toast = useToast();
	const [draft, setDraft] = useState({
		provider_name: contract.provider_name ?? "",
		provider_address: contract.provider_address ?? "",
		provider_tin: contract.provider_tin ?? "",
		client_name: contract.client_name ?? "",
		client_contact_name: contract.client_contact_name ?? "",
		client_address: contract.client_address ?? "",
		client_tin: contract.client_tin ?? "",
		client_email: contract.client_email ?? "",
	});

	const mutation = useMutation({
		mutationFn: () => contractService.update(contract.id, draft),
		onSuccess: () => {
			toast.success("Parties saved");
			void qc.invalidateQueries({
				queryKey: ["contracts", contract.project_id],
			});
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const locked = !editable || !isEditableStatus(contract.status);

	return (
		<AppSurfaceCard className="p-6">
			<h2 className="text-lg font-semibold text-foreground">Parties</h2>
			<div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
				<div className="space-y-3">
					<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Service provider
					</p>
					<TextField
						label="Name"
						value={draft.provider_name}
						onChange={(v) => setDraft((d) => ({ ...d, provider_name: v }))}
						disabled={locked}
					/>
					<TextField
						label="Address"
						value={draft.provider_address}
						onChange={(v) => setDraft((d) => ({ ...d, provider_address: v }))}
						disabled={locked}
					/>
					<TextField
						label="TIN"
						value={draft.provider_tin}
						onChange={(v) => setDraft((d) => ({ ...d, provider_tin: v }))}
						disabled={locked}
					/>
				</div>
				<div className="space-y-3">
					<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Client
					</p>
					<TextField
						label="Name"
						value={draft.client_name}
						onChange={(v) => setDraft((d) => ({ ...d, client_name: v }))}
						disabled={locked}
					/>
					<TextField
						label="Contact person"
						value={draft.client_contact_name}
						onChange={(v) =>
							setDraft((d) => ({ ...d, client_contact_name: v }))
						}
						disabled={locked}
					/>
					<TextField
						label="Email"
						value={draft.client_email}
						onChange={(v) => setDraft((d) => ({ ...d, client_email: v }))}
						disabled={locked}
					/>
					<TextField
						label="Address"
						value={draft.client_address}
						onChange={(v) => setDraft((d) => ({ ...d, client_address: v }))}
						disabled={locked}
					/>
					<TextField
						label="TIN"
						value={draft.client_tin}
						onChange={(v) => setDraft((d) => ({ ...d, client_tin: v }))}
						disabled={locked}
					/>
				</div>
			</div>
			{!locked && (
				<SaveButton
					onClick={() => mutation.mutate()}
					isPending={mutation.isPending}
				/>
			)}
		</AppSurfaceCard>
	);
}

/* ── Commercial terms ─────────────────────────────────────────────────────── */

function TermsSection({
	contract,
	editable,
}: {
	contract: Contract;
	editable: boolean;
}) {
	const qc = useQueryClient();
	const toast = useToast();
	const [draft, setDraft] = useState({
		currency: contract.currency,
		billing_mode: contract.billing_mode,
		recurring_fee: contract.recurring_fee?.toString() ?? "",
		client_hourly_rate: contract.client_hourly_rate?.toString() ?? "",
		included_hours: contract.included_hours?.toString() ?? "",
		invoice_cadence: contract.invoice_cadence,
		invoice_offset_days: String(contract.invoice_offset_days ?? 0),
		due_days: String(contract.due_days ?? 15),
		invoice_number_prefix: contract.invoice_number_prefix ?? "",
		service_description: contract.service_description ?? "",
		payment_method: contract.payment_method ?? "",
		service_start_date: contract.service_start_date ?? "",
		term_count: contract.term_count?.toString() ?? "12",
		term_unit: contract.term_unit ?? ("month" as ContractTermUnit),
	});

	const mutation = useMutation({
		mutationFn: () =>
			contractService.update(contract.id, {
				currency: draft.currency,
				billing_mode: draft.billing_mode,
				recurring_fee: numberOrNull(draft.recurring_fee),
				client_hourly_rate: numberOrNull(draft.client_hourly_rate),
				included_hours: numberOrNull(draft.included_hours),
				invoice_cadence: draft.invoice_cadence,
				invoice_offset_days: Number(draft.invoice_offset_days) || 0,
				due_days: Number(draft.due_days) || 0,
				invoice_number_prefix: draft.invoice_number_prefix.trim() || undefined,
				service_description: draft.service_description.trim() || undefined,
				payment_method: draft.payment_method.trim() || undefined,
				service_start_date: draft.service_start_date || undefined,
				term_count: Number(draft.term_count) || undefined,
				term_unit: draft.term_unit,
			}),
		onSuccess: () => {
			toast.success("Terms saved");
			void qc.invalidateQueries({
				queryKey: ["contracts", contract.project_id],
			});
			void qc.invalidateQueries({
				queryKey: ["project", contract.project_id, "activation-checklist"],
			});
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const locked = !editable || !isEditableStatus(contract.status);
	const usesFee =
		draft.billing_mode === "retainer" || draft.billing_mode === "hybrid";
	const usesRate =
		draft.billing_mode === "time_based" || draft.billing_mode === "hybrid";

	return (
		<AppSurfaceCard className="p-6">
			<h2 className="text-lg font-semibold text-foreground">
				Commercial terms
			</h2>
			<p className="mt-1 text-sm text-muted-foreground">
				These drive every client invoice. Rates here are what the{" "}
				<span className="font-semibold">client</span> pays — team member rates
				are separate and stay internal.
			</p>

			<div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
				<SelectField
					label="Billing"
					value={draft.billing_mode}
					disabled={locked}
					onChange={(v) =>
						setDraft((d) => ({ ...d, billing_mode: v as BillingMode }))
					}
					options={[
						{ value: "retainer", label: "Recurring retainer" },
						{ value: "time_based", label: "Hourly (approved hours)" },
						{ value: "hybrid", label: "Retainer + overage" },
					]}
				/>
				<TextField
					label="Currency"
					value={draft.currency}
					onChange={(v) => setDraft((d) => ({ ...d, currency: v }))}
					disabled={locked}
				/>
				{usesFee && (
					<TextField
						label="Recurring fee"
						type="number"
						value={draft.recurring_fee}
						onChange={(v) => setDraft((d) => ({ ...d, recurring_fee: v }))}
						disabled={locked}
					/>
				)}
				{usesRate && (
					<TextField
						label="Client hourly rate"
						type="number"
						value={draft.client_hourly_rate}
						onChange={(v) => setDraft((d) => ({ ...d, client_hourly_rate: v }))}
						disabled={locked}
					/>
				)}
				{draft.billing_mode === "hybrid" && (
					<TextField
						label="Hours included in fee"
						type="number"
						value={draft.included_hours}
						onChange={(v) => setDraft((d) => ({ ...d, included_hours: v }))}
						disabled={locked}
					/>
				)}
				<SelectField
					label="Invoice cadence"
					value={draft.invoice_cadence}
					disabled={locked}
					onChange={(v) =>
						setDraft((d) => ({ ...d, invoice_cadence: v as InvoiceCadence }))
					}
					options={[
						{ value: "semi_monthly", label: "Cut-off (team periods)" },
						{ value: "monthly", label: "Monthly" },
					]}
				/>
				<TextField
					label="Service starts"
					type="date"
					value={draft.service_start_date}
					onChange={(v) => setDraft((d) => ({ ...d, service_start_date: v }))}
					disabled={locked}
				/>
				<TextField
					label="Term"
					type="number"
					value={draft.term_count}
					onChange={(v) => setDraft((d) => ({ ...d, term_count: v }))}
					disabled={locked}
				/>
				<SelectField
					label="Term unit"
					value={draft.term_unit}
					disabled={locked}
					onChange={(v) =>
						setDraft((d) => ({ ...d, term_unit: v as ContractTermUnit }))
					}
					options={[
						{ value: "month", label: "Months" },
						{ value: "year", label: "Years" },
					]}
				/>
				<TextField
					label="Invoice N days after period end"
					type="number"
					value={draft.invoice_offset_days}
					onChange={(v) => setDraft((d) => ({ ...d, invoice_offset_days: v }))}
					disabled={locked}
				/>
				<TextField
					label="Payment due in N days"
					type="number"
					value={draft.due_days}
					onChange={(v) => setDraft((d) => ({ ...d, due_days: v }))}
					disabled={locked}
				/>
				<TextField
					label="Invoice number prefix"
					value={draft.invoice_number_prefix}
					onChange={(v) =>
						setDraft((d) => ({ ...d, invoice_number_prefix: v }))
					}
					disabled={locked}
				/>
				<TextField
					label="Service description"
					value={draft.service_description}
					onChange={(v) => setDraft((d) => ({ ...d, service_description: v }))}
					disabled={locked}
				/>
				<TextField
					label="Payment method"
					value={draft.payment_method}
					onChange={(v) => setDraft((d) => ({ ...d, payment_method: v }))}
					disabled={locked}
				/>
			</div>

			{/* Derived schedule, computed server-side from the saved terms. */}
			<div className="mt-6 rounded-xl border border-border bg-muted/40 p-4">
				<p className="text-sm font-semibold text-foreground">
					Service {formatContractDate(contract.service_start_date)} –{" "}
					{formatContractDate(contract.service_end_date)}
				</p>
				<p className="mt-1 text-xs text-muted-foreground">
					Contract ends {formatContractDate(contract.contract_end_date)} ·{" "}
					{contract.periods.length} billing period
					{contract.periods.length === 1 ? "" : "s"}
				</p>
				{contract.periods.length > 0 && (
					<ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-xs text-muted-foreground">
						{contract.periods.slice(0, 12).map((period) => (
							<li key={period.id} className="flex flex-wrap gap-x-3">
								<span className="font-medium text-foreground">
									{formatPeriodRange(period)}
								</span>
								<span>invoice {formatContractDate(period.invoiceDate)}</span>
								<span>due {formatContractDate(period.dueDate)}</span>
							</li>
						))}
						{contract.periods.length > 12 && (
							<li className="italic">
								…and {contract.periods.length - 12} more
							</li>
						)}
					</ul>
				)}
			</div>

			{!locked && (
				<SaveButton
					onClick={() => mutation.mutate()}
					isPending={mutation.isPending}
				/>
			)}
		</AppSurfaceCard>
	);
}

/* ── Budget split (projections) ───────────────────────────────────────────── */

function EconomicsSection({
	projectId,
	contract,
	economics,
	isLoading,
}: {
	projectId: string;
	contract: Contract;
	economics: ProjectEconomics | null;
	isLoading: boolean;
}) {
	const qc = useQueryClient();
	const toast = useToast();
	const companyPercentId = useId();
	const [companyPercent, setCompanyPercent] = useState(
		economics ? String(economics.company_percent) : "40",
	);

	useEffect(() => {
		if (economics) setCompanyPercent(String(economics.company_percent));
	}, [economics]);

	const company = Number(companyPercent);
	const team = Number.isFinite(company) ? 100 - company : 0;
	const valid = Number.isFinite(company) && company >= 0 && company <= 100;

	const mutation = useMutation({
		mutationFn: () =>
			contractService.updateEconomics(projectId, {
				company_percent: company,
				team_percent: team,
				currency: contract.currency,
			}),
		onSuccess: () => {
			toast.success("Budget split saved");
			void qc.invalidateQueries({
				queryKey: ["project", projectId, "economics"],
			});
			void qc.invalidateQueries({
				queryKey: ["project", projectId, "activation-checklist"],
			});
		},
		onError: (err: Error) => toast.error(err.message),
	});

	// Per-period revenue is only knowable up front for a retainer; an hourly
	// contract's revenue depends on hours actually logged, so we don't guess.
	const periodRevenue =
		contract.billing_mode === "time_based" ? null : contract.recurring_fee;

	return (
		<AppSurfaceCard className="p-6">
			<h2 className="text-lg font-semibold text-foreground">Budget split</h2>
			<p className="mt-1 text-sm text-muted-foreground">
				How each period's revenue divides between company margin and the pool
				available to pay the team. Internal — the client never sees this.
			</p>

			{isLoading ? (
				<div className="flex justify-center py-8">
					<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
				</div>
			) : (
				<>
					<div className="mt-5 flex flex-wrap items-end gap-4">
						<div>
							<label
								htmlFor={companyPercentId}
								className="mb-1.5 block text-xs font-semibold text-muted-foreground"
							>
								Company %
							</label>
							<input
								id={companyPercentId}
								type="number"
								min={0}
								max={100}
								step="1"
								value={companyPercent}
								onChange={(e) => setCompanyPercent(e.target.value)}
								className="w-28 rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
							/>
						</div>
						<div className="text-sm text-muted-foreground">
							Team pool:{" "}
							<span className="font-semibold text-foreground">{team}%</span>
						</div>
					</div>

					{periodRevenue ? (
						<div className="mt-5 rounded-xl border border-border bg-muted/40 p-4 text-sm">
							<Row
								label="Period revenue"
								value={formatMoney(contract.currency, periodRevenue)}
								strong
							/>
							<Row
								label={`Company (${company}%)`}
								value={formatMoney(
									contract.currency,
									(periodRevenue * company) / 100,
								)}
							/>
							<Row
								label={`Team pool (${team}%)`}
								value={formatMoney(
									contract.currency,
									(periodRevenue * team) / 100,
								)}
							/>
						</div>
					) : (
						<p className="mt-4 text-xs text-muted-foreground">
							This contract bills by the hour, so period revenue depends on
							approved hours. The split is applied to whatever each period
							actually invoices.
						</p>
					)}

					<SaveButton
						onClick={() => mutation.mutate()}
						isPending={mutation.isPending}
						disabled={!valid}
					/>
				</>
			)}
		</AppSurfaceCard>
	);
}

function Row({
	label,
	value,
	strong,
}: {
	label: string;
	value: string;
	strong?: boolean;
}) {
	return (
		<div className="flex items-center justify-between py-1">
			<span className="text-muted-foreground">{label}</span>
			<span
				className={
					strong
						? "font-semibold text-foreground"
						: "tabular-nums text-foreground"
				}
			>
				{value}
			</span>
		</div>
	);
}

/* ── Agreement clauses ────────────────────────────────────────────────────── */

/* ── Services catalog ─────────────────────────────────────────────────────── */

function ServicesSection({
	contract,
	editable,
}: {
	contract: Contract;
	editable: boolean;
}) {
	const qc = useQueryClient();
	const toast = useToast();
	const [services, setServices] = useState<ContractService[]>(
		contract.services,
	);

	const mutation = useMutation({
		mutationFn: () =>
			contractService.update(contract.id, {
				// Re-index positions so order survives a round-trip.
				services: services.map((s, i) => ({ ...s, position: i })),
			}),
		onSuccess: () => {
			toast.success("Services saved");
			void qc.invalidateQueries({
				queryKey: ["contracts", contract.project_id],
			});
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const locked = !editable || !isEditableStatus(contract.status);

	const addRow = () =>
		setServices((prev) => [
			...prev,
			{
				id: crypto.randomUUID(),
				name: "",
				description: "",
				unit: "",
				unit_rate: 0,
				position: prev.length,
			},
		]);

	const patchRow = (id: string, patch: Partial<ContractService>) =>
		setServices((prev) =>
			prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
		);

	const removeRow = (id: string) =>
		setServices((prev) => prev.filter((s) => s.id !== id));

	return (
		<AppSurfaceCard className="p-6">
			<h2 className="text-lg font-semibold text-foreground">Services</h2>
			<p className="mt-1 text-sm text-muted-foreground">
				The billable services this contract covers. You can pick these directly
				into an invoice instead of retyping each line.
			</p>

			<div className="mt-5 space-y-3">
				{services.length === 0 && (
					<p className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
						No services defined yet.
					</p>
				)}
				{services.map((service) => (
					<div
						key={service.id}
						className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-muted/30 p-4 sm:grid-cols-[1fr_120px_140px_auto]"
					>
						<div className="space-y-2">
							<input
								type="text"
								value={service.name}
								disabled={locked}
								placeholder="Service name"
								onChange={(e) => patchRow(service.id, { name: e.target.value })}
								className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-70"
							/>
							<input
								type="text"
								value={service.description ?? ""}
								disabled={locked}
								placeholder="Description (optional)"
								onChange={(e) =>
									patchRow(service.id, { description: e.target.value })
								}
								className="w-full rounded-lg border border-input bg-card px-3 py-2 text-xs text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-70"
							/>
						</div>
						<input
							type="text"
							value={service.unit ?? ""}
							disabled={locked}
							placeholder="Unit (e.g. hour)"
							onChange={(e) => patchRow(service.id, { unit: e.target.value })}
							className="h-fit w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-70"
						/>
						<input
							type="number"
							min={0}
							step="0.01"
							value={service.unit_rate}
							disabled={locked}
							placeholder="Rate"
							onChange={(e) =>
								patchRow(service.id, { unit_rate: Number(e.target.value) })
							}
							className="h-fit w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-70"
						/>
						{!locked && (
							<button
								type="button"
								onClick={() => removeRow(service.id)}
								className="h-fit rounded-lg border border-border px-2.5 py-2 text-xs font-semibold text-muted-foreground hover:border-destructive hover:text-destructive"
							>
								Remove
							</button>
						)}
					</div>
				))}
			</div>

			{!locked && (
				<div className="mt-4 flex items-center gap-3">
					<button
						type="button"
						onClick={addRow}
						className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted"
					>
						+ Add service
					</button>
					<SaveButton
						onClick={() => mutation.mutate()}
						isPending={mutation.isPending}
					/>
				</div>
			)}
		</AppSurfaceCard>
	);
}

/* ── Agreement clauses ────────────────────────────────────────────────────── */

function AgreementSection({
	contract,
	editable,
}: {
	contract: Contract;
	editable: boolean;
}) {
	const qc = useQueryClient();
	const toast = useToast();
	const [clauses, setClauses] = useState<ContractClause[]>(contract.clauses);

	const mutation = useMutation({
		mutationFn: () => contractService.update(contract.id, { clauses }),
		onSuccess: () => {
			toast.success("Agreement saved");
			void qc.invalidateQueries({
				queryKey: ["contracts", contract.project_id],
			});
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const locked = !editable || !isEditableStatus(contract.status);

	return (
		<AppSurfaceCard className="p-6">
			<h2 className="text-lg font-semibold text-foreground">
				Service agreement
			</h2>
			<p className="mt-1 text-sm text-muted-foreground">
				Seeded from the standard template. {"{{provider}}"} and {"{{client}}"}{" "}
				are replaced with the party names when the agreement is rendered.
			</p>

			<div className="mt-5 space-y-4">
				{clauses.map((clause, index) => (
					<div
						key={clause.key}
						className="rounded-xl border border-border bg-muted/30 p-4"
					>
						<p className="text-sm font-semibold text-foreground">
							{index + 1}. {clause.title}
						</p>
						<textarea
							value={clause.body}
							rows={3}
							disabled={locked}
							onChange={(e) =>
								setClauses((prev) =>
									prev.map((c) =>
										c.key === clause.key ? { ...c, body: e.target.value } : c,
									),
								)
							}
							className="mt-2 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-70"
						/>
					</div>
				))}
			</div>

			{!locked && (
				<SaveButton
					onClick={() => mutation.mutate()}
					isPending={mutation.isPending}
				/>
			)}
		</AppSurfaceCard>
	);
}

/* ── Signatures ───────────────────────────────────────────────────────────── */

function SignatureSection({
	contract,
	canSignAsConsultant,
	canSignAsClient,
	onSign,
	isPending,
}: {
	contract: Contract;
	canSignAsConsultant: boolean;
	canSignAsClient: boolean;
	onSign: (party: "consultant" | "client", name: string) => void;
	isPending: boolean;
}) {
	const [consultantName, setConsultantName] = useState("");
	const [clientName, setClientName] = useState("");

	const termsReady = Boolean(
		contract.service_start_date && contract.service_end_date,
	);

	return (
		<AppSurfaceCard className="p-6">
			<h2 className="text-lg font-semibold text-foreground">Signatures</h2>
			<p className="mt-1 text-sm text-muted-foreground">
				The contract becomes <span className="font-semibold">signed</span> only
				once both parties have stamped it.
			</p>

			{!termsReady && (
				<p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
					Set the service start date and term before signing.
				</p>
			)}

			<div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
				<SignatureBlock
					heading="For the service provider"
					signedName={contract.signed_by_consultant_name}
					signedAt={contract.signed_by_consultant_at}
					canSign={canSignAsConsultant && termsReady}
					value={consultantName}
					onChange={setConsultantName}
					onSign={() => onSign("consultant", consultantName)}
					isPending={isPending}
				/>
				<SignatureBlock
					heading="For the client"
					signedName={contract.signed_by_client_name}
					signedAt={contract.signed_by_client_at}
					canSign={canSignAsClient && termsReady}
					value={clientName}
					onChange={setClientName}
					onSign={() => onSign("client", clientName)}
					isPending={isPending}
				/>
			</div>
		</AppSurfaceCard>
	);
}

function SignatureBlock({
	heading,
	signedName,
	signedAt,
	canSign,
	value,
	onChange,
	onSign,
	isPending,
}: {
	heading: string;
	signedName: string | null;
	signedAt: string | null;
	canSign: boolean;
	value: string;
	onChange: (v: string) => void;
	onSign: () => void;
	isPending: boolean;
}) {
	if (signedAt) {
		return (
			<div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
				<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					{heading}
				</p>
				<p className="mt-2 text-sm font-semibold text-foreground">
					{signedName}
				</p>
				<p className="mt-0.5 text-xs text-muted-foreground">
					Signed {formatContractDate(signedAt.slice(0, 10))}
				</p>
			</div>
		);
	}

	return (
		<div className="rounded-xl border border-border bg-muted/30 p-4">
			<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				{heading}
			</p>
			{canSign ? (
				<div className="mt-3 space-y-2">
					<input
						type="text"
						placeholder="Type your full name"
						value={value}
						onChange={(e) => onChange(e.target.value)}
						className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
					/>
					<button
						type="button"
						onClick={onSign}
						disabled={!value.trim() || isPending}
						className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
					>
						<PenLine className="h-3.5 w-3.5" />
						Sign
					</button>
				</div>
			) : (
				<p className="mt-2 text-sm italic text-muted-foreground">
					Awaiting signature
				</p>
			)}
		</div>
	);
}

/* ── Activation ───────────────────────────────────────────────────────────── */

function ActivationSection({
	checklist,
	isLoading,
	projectStatus,
	onActivate,
	isActivating,
}: {
	checklist: ActivationChecklist | null;
	isLoading: boolean;
	projectStatus: string | null;
	onActivate: () => void;
	isActivating: boolean;
}) {
	const alreadyActive = projectStatus === "active";

	return (
		<AppSurfaceCard strong className="p-6">
			<h2 className="text-lg font-semibold text-foreground">
				Activate this project
			</h2>
			<p className="mt-1 text-sm text-muted-foreground">
				An active project bills the client and pays the team, so everything
				billing depends on has to be in place first.
			</p>

			{isLoading ? (
				<div className="flex justify-center py-8">
					<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
				</div>
			) : checklist ? (
				<>
					<ul className="mt-5 space-y-2">
						{checklist.items.map((item) => (
							<li
								key={item.key}
								className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5"
							>
								{item.ok ? (
									<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
								) : item.severity === "warning" ? (
									<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
								) : (
									<Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
								)}
								<div className="min-w-0 flex-1">
									<p className="text-sm font-medium text-foreground">
										{item.label}
									</p>
									{item.detail && (
										<p className="mt-0.5 text-xs text-muted-foreground">
											{item.detail}
										</p>
									)}
								</div>
								{!item.ok && item.fixPath && (
									<Link
										to={item.fixPath}
										className="shrink-0 text-xs font-semibold text-primary hover:underline"
									>
										Fix
									</Link>
								)}
							</li>
						))}
					</ul>

					<button
						type="button"
						onClick={onActivate}
						disabled={!checklist.ready || alreadyActive || isActivating}
						className="app-cta mt-5 inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
					>
						<Rocket className="h-4 w-4" />
						{alreadyActive
							? "Project is active"
							: isActivating
								? "Activating…"
								: "Activate project"}
					</button>
				</>
			) : null}
		</AppSurfaceCard>
	);
}

/* ── Shared field primitives ──────────────────────────────────────────────── */

function isEditableStatus(status: Contract["status"]): boolean {
	return status === "draft" || status === "sent";
}

function numberOrNull(value: string): number | null {
	const parsed = Number(value);
	return value.trim() && Number.isFinite(parsed) ? parsed : null;
}

function TextField({
	label,
	value,
	onChange,
	disabled,
	type = "text",
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	disabled?: boolean;
	type?: string;
}) {
	return (
		<div>
			<span className="mb-1.5 block text-xs font-semibold text-muted-foreground">
				{label}
			</span>
			<input
				type={type}
				value={value}
				disabled={disabled}
				onChange={(e) => onChange(e.target.value)}
				className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-70"
			/>
		</div>
	);
}

function SelectField({
	label,
	value,
	onChange,
	options,
	disabled,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	options: Array<{ value: string; label: string }>;
	disabled?: boolean;
}) {
	return (
		<div>
			<span className="mb-1.5 block text-xs font-semibold text-muted-foreground">
				{label}
			</span>
			<select
				value={value}
				disabled={disabled}
				onChange={(e) => onChange(e.target.value)}
				className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-70"
			>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</div>
	);
}

function SaveButton({
	onClick,
	isPending,
	disabled,
}: {
	onClick: () => void;
	isPending: boolean;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={isPending || disabled}
			className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-50"
		>
			{isPending ? "Saving…" : "Save"}
		</button>
	);
}
