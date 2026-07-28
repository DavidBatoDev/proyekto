import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	CheckCircle2,
	FileSignature,
	Loader2,
	PenLine,
	Trash2,
	Upload,
	X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
	AppSectionHeader,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { DateField } from "@/components/common/DateField";
import {
	AutosaveIndicator,
	FieldLabel,
	SelectField,
	TextField,
} from "@/components/common/FormFields";
import { RequireProjectAccess } from "@/components/common/RequireProjectAccess";
import {
	ActivationGuide,
	checklistProgress,
} from "@/components/project/ActivationGuide";
import {
	ContractDocumentPreview,
	type PreviewParties,
	type PreviewTerms,
} from "@/components/project/ContractDocumentPreview";
import { useActivationChecklist } from "@/hooks/useActivationChecklist";
import { useAutosave } from "@/hooks/useAutosave";
import { useToast } from "@/hooks/useToast";
import {
	type BillingMode,
	type ContractTermUnit,
	formatContractDate,
	formatMoney,
	formatPeriodRange,
	type InvoiceCadence,
} from "@/lib/contract-term";
import { CURRENCIES } from "@/lib/currency";
import {
	type Contract,
	type ContractClause,
	type ContractService,
	contractService,
	DEFAULT_SIGNATURE_PLACEMENT,
	type ProjectEconomics,
	type SignaturePlacement,
} from "@/services/contract.service";
import { projectService } from "@/services/project.service";
import { uploadService } from "@/services/upload.service";
import { useAuthStore, useUser } from "@/stores/authStore";

const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({
	value: c.code,
	label: c.label,
}));

export const Route = createFileRoute("/project/$projectId/contract")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) throw redirect({ to: "/auth/login" });
	},
	component: ProjectContractRoute,
});

function ProjectContractRoute() {
	const { projectId } = Route.useParams();
	return (
		<div className="app-shell-bg h-full w-full overflow-y-auto">
			<RequireProjectAccess projectId={projectId} access="contract">
				<ProjectContractPage />
			</RequireProjectAccess>
		</div>
	);
}

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

	const checklistQuery = useActivationChecklist(projectId, {
		enabled: isConsultant,
	});

	const [activeStep, setActiveStep] = useState<StepKey>("parties");

	// Live drafts fed up from the Parties/Terms editors so the right-side document
	// preview updates as the consultant types. Seeded from the saved contract and
	// re-seeded when the contract identity changes (a different version loads).
	const [previewParties, setPreviewParties] = useState<PreviewParties>(() =>
		partiesPreview(contract),
	);
	const [previewTerms, setPreviewTerms] = useState<PreviewTerms>(() =>
		termsPreview(contract),
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-seed only when a different contract loads, not on every field save (the editors keep the preview live in between).
	useEffect(() => {
		setPreviewParties(partiesPreview(contract));
		setPreviewTerms(termsPreview(contract));
	}, [contract?.id]);

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
			signatureUrl,
			placement,
		}: {
			party: "consultant" | "client";
			name: string;
			signatureUrl?: string | null;
			placement?: SignaturePlacement;
		}) =>
			contractService.sign(
				contract?.id as string,
				party,
				name,
				signatureUrl,
				placement,
			),
		onSuccess: () => {
			toast.success("Signature recorded");
			invalidateAll();
		},
		onError: (err: Error) => toast.error(err.message),
	});

	// Moving/resizing the overlay is cosmetic and stays available after
	// signing, so it gets its own quiet mutation rather than forcing a
	// remove-and-re-sign.
	const placementMutation = useMutation({
		mutationFn: ({
			party,
			placement,
		}: {
			party: "consultant" | "client";
			placement: Partial<SignaturePlacement>;
		}) =>
			contractService.setSignaturePlacement(
				contract?.id as string,
				party,
				placement,
			),
		onSuccess: () => invalidateAll(),
		onError: (err: Error) => toast.error(err.message),
	});

	const unsignMutation = useMutation({
		mutationFn: ({ party }: { party: "consultant" | "client" }) =>
			contractService.unsign(contract?.id as string, party),
		onSuccess: () => {
			toast.success("Signature removed");
			invalidateAll();
		},
		onError: (err: Error) => toast.error(err.message),
	});

	if (projectQuery.isPending || contractsQuery.isPending) {
		return (
			<div className="flex h-full items-center justify-center">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="w-full">
			<div className="mx-auto w-full max-w-[1440px] px-5 py-6 md:px-8 md:py-8">
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
					<div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)_minmax(0,480px)]">
						{/* Left: step rail + activation guide (kept beside the steps so
						    it stays visible, not buried under the tall preview). */}
						<div className="space-y-5 lg:sticky lg:top-6 lg:self-start">
							<StepRail
								steps={visibleSteps(isConsultant)}
								activeStep={activeStep}
								onSelect={setActiveStep}
								contract={contract}
								economics={economicsQuery.data ?? null}
							/>
							{isConsultant && checklistQuery.data && (
								<div className="app-surface-card-strong rounded-2xl p-4">
									<div className="mb-2 flex items-center justify-between">
										<h3 className="text-sm font-semibold text-foreground">
											Make it live
										</h3>
										<span className="text-xs font-semibold text-muted-foreground">
											{checklistProgress(checklistQuery.data).done}/
											{checklistProgress(checklistQuery.data).total}
										</span>
									</div>
									<ActivationGuide
										projectId={projectId}
										checklist={checklistQuery.data}
										isLoading={checklistQuery.isPending}
										projectStatus={project?.status ?? null}
										mode="compact"
									/>
								</div>
							)}
						</div>

						{/* Center: active step */}
						<div className="min-w-0">
							{activeStep === "parties" && (
								<PartiesSection
									contract={contract}
									editable={isConsultant}
									onDraftChange={setPreviewParties}
								/>
							)}
							{activeStep === "terms" && (
								<TermsSection
									contract={contract}
									editable={isConsultant}
									onDraftChange={setPreviewTerms}
								/>
							)}
							{activeStep === "services" && (
								<ServicesSection contract={contract} editable={isConsultant} />
							)}
							{activeStep === "budget" && isConsultant && (
								<EconomicsSection
									projectId={projectId}
									contract={contract}
									economics={economicsQuery.data ?? null}
									isLoading={economicsQuery.isPending}
								/>
							)}
							{activeStep === "agreement" && (
								<AgreementSection contract={contract} editable={isConsultant} />
							)}
							{activeStep === "signatures" && (
								<SignatureSection
									contract={contract}
									canSignAsConsultant={isConsultant}
									canSignAsClient={
										Boolean(user?.id) &&
										(contract.client_user_id === user?.id ||
											project?.client_id === user?.id)
									}
									onSign={(party, name, signatureUrl, placement) =>
										signMutation.mutate({
											party,
											name,
											signatureUrl,
											placement,
										})
									}
									onUnsign={(party) => unsignMutation.mutate({ party })}
									onPlacementChange={(party, placement) =>
										placementMutation.mutate({ party, placement })
									}
									isPending={signMutation.isPending}
									isUnsigning={unsignMutation.isPending}
									isRescaling={placementMutation.isPending}
								/>
							)}
						</div>

						{/* Right: the live document preview gets the whole column. */}
						<div className="lg:sticky lg:top-6 lg:self-start">
							<ContractDocumentPreview
								contract={contract}
								parties={previewParties}
								terms={previewTerms}
							/>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

/* ── Step rail ────────────────────────────────────────────────────────────── */

type StepKey =
	| "parties"
	| "terms"
	| "services"
	| "budget"
	| "agreement"
	| "signatures";

const STEP_META: Array<{
	key: StepKey;
	label: string;
	consultantOnly?: boolean;
}> = [
	{ key: "parties", label: "Parties" },
	{ key: "terms", label: "Commercial terms" },
	{ key: "services", label: "Services" },
	{ key: "budget", label: "Budget split", consultantOnly: true },
	{ key: "agreement", label: "Agreement" },
	{ key: "signatures", label: "Signatures" },
];

function visibleSteps(isConsultant: boolean) {
	return STEP_META.filter((s) => isConsultant || !s.consultantOnly);
}

/**
 * Per-step completeness for the rail's done/todo dot. Derived from the contract
 * (and economics) directly rather than the activation checklist, so each step
 * reflects its own data even for items the checklist doesn't track (services,
 * agreement). "optional" steps show a neutral dot when empty, not a red todo.
 */
function stepStatus(
	key: StepKey,
	contract: Contract,
	economics: ProjectEconomics | null,
): "done" | "todo" | "optional" {
	switch (key) {
		case "parties":
			return contract.client_name || contract.client_email ? "done" : "todo";
		case "terms": {
			const hasDates =
				Boolean(contract.service_start_date) &&
				Boolean(contract.service_end_date);
			const hasMoney =
				Number(contract.recurring_fee) > 0 ||
				Number(contract.client_hourly_rate) > 0;
			return hasDates && hasMoney ? "done" : "todo";
		}
		case "services":
			return contract.services.length > 0 ? "done" : "optional";
		case "budget":
			return economics &&
				Math.abs(economics.company_percent + economics.team_percent - 100) <
					1e-9
				? "done"
				: "todo";
		case "agreement":
			return contract.clauses.length > 0 ? "done" : "optional";
		case "signatures":
			return contract.status === "signed" || contract.status === "active"
				? "done"
				: "todo";
	}
}

function StepRail({
	steps,
	activeStep,
	onSelect,
	contract,
	economics,
}: {
	steps: Array<{ key: StepKey; label: string }>;
	activeStep: StepKey;
	onSelect: (key: StepKey) => void;
	contract: Contract;
	economics: ProjectEconomics | null;
}) {
	return (
		<nav>
			<ol className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-1">
				{steps.map((step, index) => {
					const status = stepStatus(step.key, contract, economics);
					const active = step.key === activeStep;
					return (
						<li key={step.key}>
							<button
								type="button"
								onClick={() => onSelect(step.key)}
								className={`flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${
									active
										? "bg-primary text-primary-foreground shadow-sm"
										: "text-muted-foreground hover:bg-muted"
								}`}
							>
								<StepDot status={status} active={active} index={index} />
								{step.label}
							</button>
						</li>
					);
				})}
			</ol>
		</nav>
	);
}

function StepDot({
	status,
	active,
	index,
}: {
	status: "done" | "todo" | "optional";
	active: boolean;
	index: number;
}) {
	if (status === "done") {
		return (
			<CheckCircle2
				className={`h-4 w-4 shrink-0 ${active ? "text-primary-foreground" : "text-emerald-500"}`}
			/>
		);
	}
	return (
		<span
			className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
				active
					? "border-primary-foreground/60 text-primary-foreground"
					: status === "optional"
						? "border-border text-muted-foreground"
						: "border-amber-400 text-amber-500"
			}`}
		>
			{index + 1}
		</span>
	);
}

/* ── Field group ──────────────────────────────────────────────────────────── */

/**
 * A titled cluster of fields in a roomy two-column grid. Replaces the single
 * dense 3-column grid that squeezed ~15 controls together and wrapped their
 * labels; grouping by purpose (Billing · Schedule · Invoicing · Scope) with a
 * wider gap keeps every label on one line and the form scannable.
 */
function FieldGroup({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<fieldset>
			<legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				{title}
			</legend>
			<div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
				{children}
			</div>
		</fieldset>
	);
}

/* ── Preview draft builders ───────────────────────────────────────────────── */

/** Maps the saved contract into the party fields the live document preview shows. */
function partiesPreview(contract: Contract | null): PreviewParties {
	return {
		provider_name: contract?.provider_name ?? "",
		provider_address: contract?.provider_address ?? "",
		provider_email: contract?.provider_email ?? null,
		client_name: contract?.client_name ?? "",
		client_contact_name: contract?.client_contact_name ?? "",
		client_address: contract?.client_address ?? "",
	};
}

/** Maps the saved contract into the commercial-terms fields the preview shows. */
function termsPreview(contract: Contract | null): PreviewTerms {
	return {
		currency: contract?.currency ?? "USD",
		billing_mode: contract?.billing_mode ?? "time_based",
		recurring_fee: contract?.recurring_fee?.toString() ?? "",
		client_hourly_rate: contract?.client_hourly_rate?.toString() ?? "",
		service_description: contract?.service_description ?? "",
		payment_method: contract?.payment_method ?? "",
		due_days: String(contract?.due_days ?? 15),
	};
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
	onDraftChange,
}: {
	contract: Contract;
	editable: boolean;
	onDraftChange?: (parties: PreviewParties) => void;
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

	// Feed the live document preview as the consultant edits.
	useEffect(() => {
		onDraftChange?.({
			provider_name: draft.provider_name,
			provider_address: draft.provider_address,
			provider_email: contract.provider_email,
			client_name: draft.client_name,
			client_contact_name: draft.client_contact_name,
			client_address: draft.client_address,
		});
	}, [
		draft.provider_name,
		draft.provider_address,
		draft.client_name,
		draft.client_contact_name,
		draft.client_address,
		contract.provider_email,
		onDraftChange,
	]);

	const locked = !editable || !isEditableStatus(contract.status);

	const saveStatus = useAutosave(
		draft,
		async (value) => {
			await contractService.update(contract.id, value);
			void qc.invalidateQueries({
				queryKey: ["contracts", contract.project_id],
			});
		},
		{ enabled: !locked, onError: (err) => toast.error(err.message) },
	);

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
			{!locked && <AutosaveIndicator status={saveStatus} />}
		</AppSurfaceCard>
	);
}

/* ── Commercial terms ─────────────────────────────────────────────────────── */

function TermsSection({
	contract,
	editable,
	onDraftChange,
}: {
	contract: Contract;
	editable: boolean;
	onDraftChange?: (terms: PreviewTerms) => void;
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

	// Feed the live document preview as the consultant edits.
	useEffect(() => {
		onDraftChange?.({
			currency: draft.currency,
			billing_mode: draft.billing_mode,
			recurring_fee: draft.recurring_fee,
			client_hourly_rate: draft.client_hourly_rate,
			service_description: draft.service_description,
			payment_method: draft.payment_method,
			due_days: draft.due_days,
		});
	}, [
		draft.currency,
		draft.billing_mode,
		draft.recurring_fee,
		draft.client_hourly_rate,
		draft.service_description,
		draft.payment_method,
		draft.due_days,
		onDraftChange,
	]);

	const locked = !editable || !isEditableStatus(contract.status);

	const saveStatus = useAutosave(
		draft,
		async (d) => {
			await contractService.update(contract.id, {
				currency: d.currency,
				billing_mode: d.billing_mode,
				recurring_fee: numberOrNull(d.recurring_fee),
				client_hourly_rate: numberOrNull(d.client_hourly_rate),
				included_hours: numberOrNull(d.included_hours),
				invoice_cadence: d.invoice_cadence,
				invoice_offset_days: Number(d.invoice_offset_days) || 0,
				due_days: Number(d.due_days) || 0,
				invoice_number_prefix: d.invoice_number_prefix.trim() || undefined,
				service_description: d.service_description.trim() || undefined,
				payment_method: d.payment_method.trim() || undefined,
				service_start_date: d.service_start_date || undefined,
				term_count: Number(d.term_count) || undefined,
				term_unit: d.term_unit,
			});
			void qc.invalidateQueries({
				queryKey: ["contracts", contract.project_id],
			});
			void qc.invalidateQueries({
				queryKey: ["project", contract.project_id, "activation-checklist"],
			});
		},
		{ enabled: !locked, onError: (err) => toast.error(err.message) },
	);
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

			<div className="mt-6 space-y-6">
				<FieldGroup title="Billing">
					<SelectField
						label="Billing model"
						hint="How the client is charged. Retainer bills a flat fee each period; Hourly bills approved time at the rate below; Retainer + overage bills the fee plus any hours beyond the included allowance."
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
					<SelectField
						label="Currency"
						hint="The currency every invoice on this contract is issued in. It should match your team members' rate currency, or the margin maths compares apples to oranges."
						value={draft.currency}
						disabled={locked}
						onChange={(v) => setDraft((d) => ({ ...d, currency: v }))}
						options={CURRENCY_OPTIONS}
					/>
					{usesFee && (
						<TextField
							label="Recurring fee"
							hint="The flat amount billed every billing period, before any overage. This is the client price — what you pay the team is separate."
							type="number"
							value={draft.recurring_fee}
							onChange={(v) => setDraft((d) => ({ ...d, recurring_fee: v }))}
							disabled={locked}
						/>
					)}
					{usesRate && (
						<TextField
							label="Client hourly rate"
							hint="What the client pays per approved hour. Only approved time logs are billed, so unreviewed hours never reach an invoice."
							type="number"
							value={draft.client_hourly_rate}
							onChange={(v) =>
								setDraft((d) => ({ ...d, client_hourly_rate: v }))
							}
							disabled={locked}
						/>
					)}
					{draft.billing_mode === "hybrid" && (
						<TextField
							label="Hours included in fee"
							hint="Hours the retainer already covers each period. Approved time beyond this is billed at the hourly rate as overage."
							type="number"
							value={draft.included_hours}
							onChange={(v) => setDraft((d) => ({ ...d, included_hours: v }))}
							disabled={locked}
						/>
					)}
				</FieldGroup>

				<FieldGroup title="Schedule">
					<DateField
						label="Service start date"
						hint="The day the engagement begins. Billing periods are counted from here, and no invoice is generated before it."
						value={draft.service_start_date}
						onChange={(v) => setDraft((d) => ({ ...d, service_start_date: v }))}
						disabled={locked}
					/>
					<SelectField
						label="Invoice cadence"
						hint="How often an invoice is raised. Monthly bills once per calendar month; Cut-off follows your team's pay periods (usually twice a month), so client billing lines up with when you pay the team."
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
						label="Term length"
						hint="How long the engagement runs, counted in the unit beside it. 12 + Months ends the service period a year after the start date."
						type="number"
						value={draft.term_count}
						onChange={(v) => setDraft((d) => ({ ...d, term_count: v }))}
						disabled={locked}
					/>
					<SelectField
						label="Term unit"
						hint="The unit the term length is counted in — months or years."
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
				</FieldGroup>

				<FieldGroup title="Invoicing">
					<TextField
						label="Invoice delay (days after period)"
						hint="How long to wait after a billing period closes before raising its invoice. 0 invoices on the closing day; use a few days if you need time to approve hours first."
						type="number"
						value={draft.invoice_offset_days}
						onChange={(v) =>
							setDraft((d) => ({ ...d, invoice_offset_days: v }))
						}
						disabled={locked}
					/>
					<TextField
						label="Payment terms (days)"
						hint="How many days the client has to pay after the invoice date — 'Net 15' means 15. It sets each invoice's due date."
						type="number"
						value={draft.due_days}
						onChange={(v) => setDraft((d) => ({ ...d, due_days: v }))}
						disabled={locked}
					/>
					<TextField
						label="Invoice number prefix"
						hint="Your own short code at the front of every invoice number on this contract — e.g. 'BS' produces BS2026-001, BS2026-002. Use whatever your bookkeeping expects; it has no effect beyond the label."
						placeholder="e.g. BS"
						value={draft.invoice_number_prefix}
						onChange={(v) =>
							setDraft((d) => ({ ...d, invoice_number_prefix: v }))
						}
						disabled={locked}
					/>
				</FieldGroup>

				<FieldGroup title="Scope & payment">
					<TextField
						label="Service description"
						optional
						hint="One line summarising what you're delivering. It appears in the Commercial Terms table on the agreement."
						value={draft.service_description}
						onChange={(v) =>
							setDraft((d) => ({ ...d, service_description: v }))
						}
						disabled={locked}
					/>
					<TextField
						label="Payment method"
						optional
						hint="How the client should pay — e.g. bank transfer, online payment. Printed on the invoice so they know where to send it."
						value={draft.payment_method}
						onChange={(v) => setDraft((d) => ({ ...d, payment_method: v }))}
						disabled={locked}
					/>
				</FieldGroup>
			</div>

			{/* Derived schedule, computed server-side from the saved terms. */}
			<BillingSchedulePreview contract={contract} />

			{!locked && <AutosaveIndicator status={saveStatus} />}
		</AppSurfaceCard>
	);
}

/* ── Billing schedule preview ─────────────────────────────────────────────── */

/**
 * The invoice calendar this contract's terms produce. Previously a wall of
 * run-on lines ("Aug 1 – Aug 31 invoice Aug 31 due Sep 15") that took real
 * effort to parse; now a numbered table with aligned columns, so it reads as
 * the schedule it is and you can see at a glance which periods have passed.
 */
function BillingSchedulePreview({ contract }: { contract: Contract }) {
	const [showAll, setShowAll] = useState(false);
	const periods = contract.periods;
	const today = new Date().toISOString().slice(0, 10);
	const VISIBLE = 6;
	const shown = showAll ? periods : periods.slice(0, VISIBLE);

	if (periods.length === 0) {
		return (
			<div className="mt-6 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
				Set a service start date and term length to see the billing schedule.
			</div>
		);
	}

	return (
		<div className="mt-6 overflow-hidden rounded-xl border border-border">
			<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border bg-muted/40 px-4 py-3">
				<div>
					<p className="text-sm font-semibold text-foreground">
						Billing schedule
					</p>
					<p className="mt-0.5 text-xs text-muted-foreground">
						{formatContractDate(contract.service_start_date)} –{" "}
						{formatContractDate(contract.service_end_date)}
						{contract.contract_end_date &&
						contract.contract_end_date !== contract.service_end_date
							? ` · contract ends ${formatContractDate(contract.contract_end_date)}`
							: ""}
					</p>
				</div>
				<span className="rounded-full bg-card px-2.5 py-1 text-xs font-semibold text-muted-foreground">
					{periods.length} invoice{periods.length === 1 ? "" : "s"}
				</span>
			</div>

			<div className="overflow-x-auto">
				<table className="w-full text-xs">
					<thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
						<tr className="border-b border-border">
							<th className="px-4 py-2 font-semibold">#</th>
							<th className="px-4 py-2 font-semibold">Period covered</th>
							<th className="px-4 py-2 font-semibold">Invoice date</th>
							<th className="px-4 py-2 font-semibold">Payment due</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-border">
						{shown.map((period, index) => {
							const past = period.invoiceDate <= today;
							return (
								<tr
									key={period.id}
									className={past ? "text-muted-foreground" : "text-foreground"}
								>
									<td className="px-4 py-2 tabular-nums text-muted-foreground">
										{index + 1}
									</td>
									<td className="px-4 py-2 font-medium">
										{formatPeriodRange(period)}
									</td>
									<td className="px-4 py-2 tabular-nums">
										{formatContractDate(period.invoiceDate)}
									</td>
									<td className="px-4 py-2 tabular-nums">
										{formatContractDate(period.dueDate)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>

			{periods.length > VISIBLE && (
				<button
					type="button"
					onClick={() => setShowAll((v) => !v)}
					className="w-full border-t border-border bg-muted/30 px-4 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
				>
					{showAll
						? "Show fewer"
						: `Show all ${periods.length} billing periods`}
				</button>
			)}
		</div>
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

	const saveStatus = useAutosave(
		{ company, team },
		async () => {
			await contractService.updateEconomics(projectId, {
				company_percent: company,
				team_percent: team,
				currency: contract.currency,
			});
			void qc.invalidateQueries({
				queryKey: ["project", projectId, "economics"],
			});
			void qc.invalidateQueries({
				queryKey: ["project", projectId, "activation-checklist"],
			});
		},
		{ enabled: valid, onError: (err) => toast.error(err.message) },
	);

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

					{!valid && (
						<p className="mt-4 text-xs text-destructive">
							Company % must be between 0 and 100.
						</p>
					)}
					<AutosaveIndicator status={saveStatus} />
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

/**
 * How a service is billed. Free text invited typos ("hr", "Hour", "hours")
 * that then read inconsistently on the invoice, so the choices are fixed.
 */
const SERVICE_UNIT_OPTIONS: Array<{ value: string; label: string }> = [
	{ value: "", label: "Select…" },
	{ value: "hour", label: "Hour" },
	{ value: "day", label: "Day" },
	{ value: "week", label: "Week" },
	{ value: "month", label: "Month" },
	{ value: "project", label: "Project (one-off)" },
	{ value: "item", label: "Item" },
];

function ServicesSection({
	contract,
	editable,
}: {
	contract: Contract;
	editable: boolean;
}) {
	const qc = useQueryClient();
	const toast = useToast();
	const currency = contract.currency || "USD";
	const [services, setServices] = useState<ContractService[]>(
		contract.services,
	);

	const locked = !editable || !isEditableStatus(contract.status);

	const saveStatus = useAutosave(
		services,
		async (rows) => {
			await contractService.update(contract.id, {
				// Re-index positions so order survives a round-trip.
				services: rows.map((s, i) => ({ ...s, position: i })),
			});
			void qc.invalidateQueries({
				queryKey: ["contracts", contract.project_id],
			});
		},
		{ enabled: !locked, onError: (err) => toast.error(err.message) },
	);

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
						className="rounded-xl border border-border bg-muted/30 p-4"
					>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_150px_160px_auto]">
							<FieldLabel
								label="Service"
								hint="What you're billing for. This becomes the invoice line's description."
							>
								<input
									type="text"
									value={service.name}
									disabled={locked}
									placeholder="e.g. Digital Marketing"
									onChange={(e) =>
										patchRow(service.id, { name: e.target.value })
									}
									className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-70"
								/>
							</FieldLabel>
							<FieldLabel
								label="Billed per"
								hint="The unit the rate applies to — per hour, per month, or a one-off per project."
							>
								<select
									value={service.unit ?? ""}
									disabled={locked}
									onChange={(e) =>
										patchRow(service.id, { unit: e.target.value })
									}
									className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-70"
								>
									{SERVICE_UNIT_OPTIONS.map((option) => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))}
								</select>
							</FieldLabel>
							<FieldLabel
								label={`Rate (${currency})`}
								hint="What the CLIENT pays per unit. Team member costs are separate and stay internal."
							>
								<input
									type="number"
									min={0}
									step="0.01"
									value={service.unit_rate}
									disabled={locked}
									placeholder="0.00"
									onChange={(e) =>
										patchRow(service.id, { unit_rate: Number(e.target.value) })
									}
									className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-70"
								/>
							</FieldLabel>
							{!locked && (
								<button
									type="button"
									onClick={() => removeRow(service.id)}
									className="h-fit self-end rounded-lg border border-border px-2.5 py-2 text-xs font-semibold text-muted-foreground hover:border-destructive hover:text-destructive"
								>
									Remove
								</button>
							)}
						</div>
						<FieldLabel
							label="Description"
							optional
							hint="Extra detail shown under the line on the invoice."
							className="mt-3"
						>
							<input
								type="text"
								value={service.description ?? ""}
								disabled={locked}
								placeholder="e.g. Monthly retainer covering channel management"
								onChange={(e) =>
									patchRow(service.id, { description: e.target.value })
								}
								className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-70"
							/>
						</FieldLabel>
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
					<AutosaveIndicator status={saveStatus} className="mt-0" />
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

	const locked = !editable || !isEditableStatus(contract.status);

	const saveStatus = useAutosave(
		clauses,
		async (rows) => {
			await contractService.update(contract.id, { clauses: rows });
			void qc.invalidateQueries({
				queryKey: ["contracts", contract.project_id],
			});
		},
		{ enabled: !locked, onError: (err) => toast.error(err.message) },
	);

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

			{!locked && <AutosaveIndicator status={saveStatus} />}
		</AppSurfaceCard>
	);
}

/* ── Signatures ───────────────────────────────────────────────────────────── */

function SignatureSection({
	contract,
	canSignAsConsultant,
	canSignAsClient,
	onSign,
	onUnsign,
	onPlacementChange,
	isPending,
	isUnsigning,
	isRescaling,
}: {
	contract: Contract;
	canSignAsConsultant: boolean;
	canSignAsClient: boolean;
	onSign: (
		party: "consultant" | "client",
		name: string,
		signatureUrl?: string | null,
		placement?: SignaturePlacement,
	) => void;
	onUnsign: (party: "consultant" | "client") => void;
	onPlacementChange: (
		party: "consultant" | "client",
		placement: Partial<SignaturePlacement>,
	) => void;
	isPending: boolean;
	isUnsigning: boolean;
	isRescaling: boolean;
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
				once both parties have stamped it. Draw or upload your signature, or
				just type your name.
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
					signedImageUrl={contract.signed_by_consultant_signature_url}
					placement={{
						scale: contract.signed_by_consultant_signature_scale,
						offsetX: contract.signed_by_consultant_signature_offset_x,
						offsetY: contract.signed_by_consultant_signature_offset_y,
					}}
					canSign={canSignAsConsultant && termsReady}
					canManage={canSignAsConsultant}
					value={consultantName}
					onChange={setConsultantName}
					onSign={(url, next) =>
						onSign("consultant", consultantName, url, next)
					}
					onUnsign={() => onUnsign("consultant")}
					onPlacementChange={(next) => onPlacementChange("consultant", next)}
					isPending={isPending}
					isUnsigning={isUnsigning}
					isRescaling={isRescaling}
				/>
				<SignatureBlock
					heading="For the client"
					signedName={contract.signed_by_client_name}
					signedAt={contract.signed_by_client_at}
					signedImageUrl={contract.signed_by_client_signature_url}
					placement={{
						scale: contract.signed_by_client_signature_scale,
						offsetX: contract.signed_by_client_signature_offset_x,
						offsetY: contract.signed_by_client_signature_offset_y,
					}}
					canSign={canSignAsClient && termsReady}
					canManage={canSignAsClient}
					value={clientName}
					onChange={setClientName}
					onSign={(url, next) => onSign("client", clientName, url, next)}
					onUnsign={() => onUnsign("client")}
					onPlacementChange={(next) => onPlacementChange("client", next)}
					isPending={isPending}
					isUnsigning={isUnsigning}
					isRescaling={isRescaling}
				/>
			</div>
		</AppSurfaceCard>
	);
}

function SignatureBlock({
	heading,
	signedName,
	signedAt,
	signedImageUrl,
	placement,
	canSign,
	canManage,
	value,
	onChange,
	onSign,
	onUnsign,
	onPlacementChange,
	isPending,
	isUnsigning,
	isRescaling,
}: {
	heading: string;
	signedName: string | null;
	signedAt: string | null;
	signedImageUrl: string | null;
	placement: SignaturePlacement;
	canSign: boolean;
	canManage: boolean;
	value: string;
	onChange: (v: string) => void;
	onSign: (
		signatureUrl?: string | null,
		placement?: SignaturePlacement,
	) => void;
	onUnsign: () => void;
	onPlacementChange: (placement: Partial<SignaturePlacement>) => void;
	isPending: boolean;
	isUnsigning: boolean;
	isRescaling: boolean;
}) {
	if (signedAt) {
		return (
			<div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
				<div className="flex items-start justify-between gap-2">
					<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						{heading}
					</p>
					{canManage && (
						<button
							type="button"
							onClick={onUnsign}
							disabled={isUnsigning}
							className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
						>
							{isUnsigning ? (
								<Loader2 className="h-3 w-3 animate-spin" />
							) : (
								<Trash2 className="h-3 w-3" />
							)}
							Remove
						</button>
					)}
				</div>
				{signedImageUrl && (
					<SignaturePlacementField
						imageUrl={signedImageUrl}
						alt={`${signedName ?? "Signature"} signature`}
						placement={placement}
						editable={canManage}
						busy={isRescaling}
						onCommit={onPlacementChange}
						className="mt-2"
					/>
				)}
				<p className="mt-2 text-sm font-semibold text-foreground">
					{signedName}
				</p>
				<p className="mt-0.5 text-xs text-muted-foreground">
					Signed {formatContractDate(signedAt.slice(0, 10))}
				</p>
				{canManage && (
					<p className="mt-2 text-[11px] text-muted-foreground">
						Remove to re-sign — e.g. to upload a signature image instead of a
						typed name.
					</p>
				)}
			</div>
		);
	}

	return (
		<div className="rounded-xl border border-border bg-muted/30 p-4">
			<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				{heading}
			</p>
			{canSign ? (
				<SignaturePad
					name={value}
					onNameChange={onChange}
					onSign={onSign}
					isPending={isPending}
				/>
			) : (
				<p className="mt-2 text-sm italic text-muted-foreground">
					Awaiting signature
				</p>
			)}
		</div>
	);
}

/** Base rendered height of a signature image at scale 1, in px. */
const SIGNATURE_BASE_HEIGHT_PX = 56;
/** Height of the signature field. FIXED — matches the document exactly. */
const SIGNATURE_FIELD_HEIGHT_PX = 64;
const SIGNATURE_MIN_SCALE = 0.5;
const SIGNATURE_MAX_SCALE = 3;
const SIGNATURE_MAX_OFFSET = 3;

const clampOffset = (v: number) =>
	Math.min(SIGNATURE_MAX_OFFSET, Math.max(-SIGNATURE_MAX_OFFSET, v));

/**
 * A signature field you can drag the signature around inside, the way a PDF
 * signer lets you nudge a stamp onto the printed signature line.
 *
 * The field's height is fixed and the image is an absolutely positioned
 * overlay on top of it, so neither resizing nor repositioning can change the
 * surrounding layout — which is what kept knocking the document's two
 * signature columns out of alignment.
 *
 * Offsets are stored in multiples of the base height rather than pixels, so
 * the same value renders correctly in the compact preview, the full-size
 * document, and the PDF.
 */
function SignaturePlacementField({
	imageUrl,
	alt,
	placement,
	editable,
	busy,
	onCommit,
	className = "",
}: {
	imageUrl: string;
	alt: string;
	placement: SignaturePlacement;
	editable: boolean;
	busy?: boolean;
	/** Fires once per gesture, on release. */
	onCommit: (placement: Partial<SignaturePlacement>) => void;
	className?: string;
}) {
	// Local copy so the overlay tracks the cursor; the server value lands on
	// release and this re-syncs to it.
	const [draft, setDraft] = useState(placement);
	useEffect(() => setDraft(placement), [placement]);

	const dragRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		originX: number;
		originY: number;
	} | null>(null);

	const height = SIGNATURE_BASE_HEIGHT_PX * draft.scale;

	const startDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
		if (!editable) return;
		e.preventDefault();
		dragRef.current = {
			pointerId: e.pointerId,
			startX: e.clientX,
			startY: e.clientY,
			originX: draft.offsetX,
			originY: draft.offsetY,
		};
		e.currentTarget.setPointerCapture(e.pointerId);
	};

	const moveDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== e.pointerId) return;
		setDraft((prev) => ({
			...prev,
			offsetX: clampOffset(
				drag.originX + (e.clientX - drag.startX) / SIGNATURE_BASE_HEIGHT_PX,
			),
			// Screen y grows downward; our offset grows upward.
			offsetY: clampOffset(
				drag.originY - (e.clientY - drag.startY) / SIGNATURE_BASE_HEIGHT_PX,
			),
		}));
	};

	const endDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== e.pointerId) return;
		dragRef.current = null;
		if (
			draft.offsetX !== placement.offsetX ||
			draft.offsetY !== placement.offsetY
		) {
			onCommit({ offsetX: draft.offsetX, offsetY: draft.offsetY });
		}
	};

	// Arrow keys nudge by a tenth of the base height — the fine adjustment a
	// pointer can't do precisely.
	const nudge = (e: React.KeyboardEvent<HTMLButtonElement>) => {
		if (!editable) return;
		const step = e.shiftKey ? 0.02 : 0.1;
		const delta: Partial<SignaturePlacement> = {};
		if (e.key === "ArrowLeft")
			delta.offsetX = clampOffset(draft.offsetX - step);
		else if (e.key === "ArrowRight")
			delta.offsetX = clampOffset(draft.offsetX + step);
		else if (e.key === "ArrowUp")
			delta.offsetY = clampOffset(draft.offsetY + step);
		else if (e.key === "ArrowDown")
			delta.offsetY = clampOffset(draft.offsetY - step);
		else return;
		e.preventDefault();
		setDraft((prev) => ({ ...prev, ...delta }));
		onCommit(delta);
	};

	const isPlaced =
		draft.offsetX !== 0 || draft.offsetY !== 0 || draft.scale !== 1;

	return (
		<div className={className}>
			<div
				className="relative overflow-visible border-b border-border/60"
				style={{ height: SIGNATURE_FIELD_HEIGHT_PX }}
			>
				{/* A button rather than a bare div: it is focusable and labelled for
				    free, so arrow-key nudging works without a custom tabindex. */}
				<button
					type="button"
					disabled={!editable}
					aria-label="Drag to position the signature; arrow keys nudge it"
					onPointerDown={startDrag}
					onPointerMove={moveDrag}
					onPointerUp={endDrag}
					onPointerCancel={endDrag}
					onKeyDown={nudge}
					className={`absolute bottom-0 left-0 z-10 touch-none rounded-sm p-0 outline-none ${
						editable
							? "cursor-grab ring-primary/40 hover:ring-2 focus-visible:ring-2 active:cursor-grabbing"
							: "cursor-default"
					} ${busy ? "opacity-60" : ""}`}
					style={{
						height,
						transform: `translate(${draft.offsetX * SIGNATURE_BASE_HEIGHT_PX}px, ${
							-draft.offsetY * SIGNATURE_BASE_HEIGHT_PX
						}px)`,
					}}
				>
					<img
						src={imageUrl}
						alt={alt}
						draggable={false}
						className="pointer-events-none h-full max-w-none select-none object-contain"
					/>
				</button>
			</div>

			{editable && (
				<div className="mt-2 space-y-1.5">
					<SignatureSizeControl
						scale={placement.scale}
						disabled={busy}
						onPreview={(scale) => setDraft((prev) => ({ ...prev, scale }))}
						onCommit={(scale) => onCommit({ scale })}
					/>
					<div className="flex items-center justify-between gap-2">
						<p className="text-[11px] text-muted-foreground">
							Drag the signature onto the line — arrow keys nudge it.
						</p>
						{isPlaced && (
							<button
								type="button"
								onClick={() => {
									setDraft(DEFAULT_SIGNATURE_PLACEMENT);
									onCommit(DEFAULT_SIGNATURE_PLACEMENT);
								}}
								disabled={busy}
								className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
							>
								Reset
							</button>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

/**
 * Slider for how large a signature image renders in the agreement. The same
 * multiplier drives the editor, the live preview, and the PDF, so what the
 * signer sets here is what the client sees.
 */
function SignatureSizeControl({
	scale,
	disabled,
	onPreview,
	onCommit,
	className = "",
}: {
	scale: number;
	disabled?: boolean;
	/** Fires on every drag step so the signature resizes under the cursor. */
	onPreview: (scale: number) => void;
	/** Fires on release — the only point anything is persisted. */
	onCommit: (scale: number) => void;
	className?: string;
}) {
	const [draft, setDraft] = useState(scale);
	// Follow the server once a save lands (or another device changes it).
	useEffect(() => setDraft(scale), [scale]);

	return (
		<div className={`flex items-center gap-2 ${className}`}>
			<span className="text-[11px] font-medium text-muted-foreground">
				Size
			</span>
			<input
				type="range"
				min={SIGNATURE_MIN_SCALE}
				max={SIGNATURE_MAX_SCALE}
				step={0.1}
				value={draft}
				disabled={disabled}
				aria-label="Signature size"
				onChange={(e) => {
					const next = Number(e.target.value);
					setDraft(next);
					onPreview(next);
				}}
				onPointerUp={() => onCommit(draft)}
				onKeyUp={() => onCommit(draft)}
				className="h-1 flex-1 cursor-pointer accent-primary disabled:opacity-50"
			/>
			<span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">
				{Math.round(draft * 100)}%
			</span>
		</div>
	);
}

/**
 * Name input + signature capture: draw it on a canvas (default) or upload a
 * signature image. Either way the result is flattened/stored as a PNG in R2 and
 * its URL rides along with the sign request to persist on the contract and
 * render in the document. Draw is the default because it can't be a stray photo;
 * upload is there for a scanned/pre-made signature.
 */
function SignaturePad({
	name,
	onNameChange,
	onSign,
	isPending,
}: {
	name: string;
	onNameChange: (v: string) => void;
	onSign: (
		signatureUrl?: string | null,
		placement?: SignaturePlacement,
	) => void;
	isPending: boolean;
}) {
	const toast = useToast();
	const [mode, setMode] = useState<"draw" | "upload">("draw");
	// Where and how large the signature sits on its field. Set it here and the
	// preview below shows the real placement before you commit.
	const [placement, setPlacement] = useState<SignaturePlacement>(
		DEFAULT_SIGNATURE_PLACEMENT,
	);

	// Draw mode.
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const drawing = useRef(false);
	const [hasDrawing, setHasDrawing] = useState(false);

	// Upload mode.
	const inputRef = useRef<HTMLInputElement>(null);
	const [dragging, setDragging] = useState(false);
	const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);

	const [uploading, setUploading] = useState(false);
	const accept = "image/png,image/jpeg,image/webp";

	// Ink style is set once; the stroke is dark so it reads on the white document.
	useEffect(() => {
		if (mode !== "draw") return;
		const ctx = canvasRef.current?.getContext("2d");
		if (!ctx) return;
		ctx.lineWidth = 2.5;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.strokeStyle = "#1e293b";
	}, [mode]);

	const pointFor = (e: React.PointerEvent<HTMLCanvasElement>) => {
		const canvas = canvasRef.current;
		if (!canvas) return { x: 0, y: 0 };
		const rect = canvas.getBoundingClientRect();
		return {
			x: (e.clientX - rect.left) * (canvas.width / rect.width),
			y: (e.clientY - rect.top) * (canvas.height / rect.height),
		};
	};

	const startStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
		const ctx = canvasRef.current?.getContext("2d");
		if (!ctx) return;
		drawing.current = true;
		const { x, y } = pointFor(e);
		ctx.beginPath();
		ctx.moveTo(x, y);
		e.currentTarget.setPointerCapture(e.pointerId);
	};

	const moveStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
		if (!drawing.current) return;
		const ctx = canvasRef.current?.getContext("2d");
		if (!ctx) return;
		const { x, y } = pointFor(e);
		ctx.lineTo(x, y);
		ctx.stroke();
		if (!hasDrawing) setHasDrawing(true);
	};

	const endStroke = () => {
		drawing.current = false;
	};

	const clear = () => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
		setHasDrawing(false);
	};

	const handleFile = async (file: File | undefined) => {
		if (!file) return;
		if (!accept.split(",").includes(file.type)) {
			toast.error("Signature must be a PNG, JPG, or WEBP image.");
			return;
		}
		if (file.size > 5 * 1024 * 1024) {
			toast.error("Signature image must be under 5 MB.");
			return;
		}
		setUploading(true);
		try {
			const url = await uploadService.uploadContractSignature(file);
			setUploadedUrl(url);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Upload failed");
		} finally {
			setUploading(false);
		}
	};

	const handleSign = async () => {
		if (mode === "upload") {
			onSign(uploadedUrl, uploadedUrl ? placement : undefined);
			return;
		}
		const canvas = canvasRef.current;
		if (!hasDrawing || !canvas) {
			onSign(null);
			return;
		}
		setUploading(true);
		try {
			const blob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob(resolve, "image/png"),
			);
			if (!blob) {
				onSign(null);
				return;
			}
			const file = new File([blob], "signature.png", { type: "image/png" });
			const url = await uploadService.uploadContractSignature(file);
			onSign(url, placement);
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Signature upload failed",
			);
		} finally {
			setUploading(false);
		}
	};

	return (
		<div className="mt-3 space-y-2">
			<input
				type="text"
				placeholder="Type your full name"
				value={name}
				onChange={(e) => onNameChange(e.target.value)}
				className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
			/>

			{/* Draw / Upload toggle */}
			<div className="inline-flex rounded-lg border border-border p-0.5 text-xs font-medium">
				<button
					type="button"
					onClick={() => setMode("draw")}
					className={`rounded-md px-2.5 py-1 transition ${
						mode === "draw"
							? "bg-primary text-primary-foreground"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					Draw
				</button>
				<button
					type="button"
					onClick={() => setMode("upload")}
					className={`rounded-md px-2.5 py-1 transition ${
						mode === "upload"
							? "bg-primary text-primary-foreground"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					Upload
				</button>
			</div>

			{mode === "draw" ? (
				<div className="relative rounded-lg border border-border bg-card">
					<canvas
						ref={canvasRef}
						width={600}
						height={160}
						onPointerDown={startStroke}
						onPointerMove={moveStroke}
						onPointerUp={endStroke}
						onPointerLeave={endStroke}
						className="h-28 w-full touch-none rounded-lg"
					/>
					{!hasDrawing && (
						<span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
							Draw your signature here
						</span>
					)}
					{hasDrawing && (
						<button
							type="button"
							onClick={clear}
							className="absolute right-1.5 top-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:text-foreground"
						>
							Clear
						</button>
					)}
				</div>
			) : uploadedUrl ? (
				<div className="relative rounded-lg border border-border bg-card p-2">
					{/* The very same field the document uses — position and size the
					    signature here and that is exactly how it lands. Nothing is
					    persisted until Sign, so "commit" is just local state. */}
					<SignaturePlacementField
						imageUrl={uploadedUrl}
						alt="Signature preview"
						placement={placement}
						editable
						onCommit={(next) => setPlacement((prev) => ({ ...prev, ...next }))}
					/>
					<button
						type="button"
						onClick={() => setUploadedUrl(null)}
						className="absolute right-1.5 top-1.5 rounded-full bg-slate-900/60 p-1 text-white transition hover:bg-slate-900/80"
						aria-label="Remove signature image"
					>
						<X className="h-3 w-3" />
					</button>
				</div>
			) : (
				<>
					<button
						type="button"
						onClick={() => inputRef.current?.click()}
						onDragOver={(e) => {
							e.preventDefault();
							setDragging(true);
						}}
						onDragLeave={() => setDragging(false)}
						onDrop={(e) => {
							e.preventDefault();
							setDragging(false);
							void handleFile(e.dataTransfer.files?.[0]);
						}}
						className={`flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-3 py-4 text-xs transition ${
							dragging
								? "border-primary bg-primary/5 text-primary"
								: "border-border text-muted-foreground hover:border-primary/50"
						}`}
					>
						{uploading ? (
							<>
								<Loader2 className="h-4 w-4 animate-spin" />
								Uploading…
							</>
						) : (
							<>
								<Upload className="h-4 w-4" />
								Drag &amp; drop or click to upload a signature image
							</>
						)}
					</button>
					<input
						ref={inputRef}
						type="file"
						accept={accept}
						className="hidden"
						onChange={(e) => void handleFile(e.target.files?.[0] ?? undefined)}
					/>
				</>
			)}

			<div>
				<button
					type="button"
					onClick={handleSign}
					disabled={!name.trim() || isPending || uploading}
					className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
				>
					<PenLine className="h-3.5 w-3.5" />
					{uploading ? "Signing…" : "Sign"}
				</button>
			</div>
		</div>
	);
}

/* ── Activation ───────────────────────────────────────────────────────────── */

/* ── Shared field primitives ──────────────────────────────────────────────── */

function isEditableStatus(status: Contract["status"]): boolean {
	return status === "draft" || status === "sent";
}

function numberOrNull(value: string): number | null {
	const parsed = Number(value);
	return value.trim() && Number.isFinite(parsed) ? parsed : null;
}
