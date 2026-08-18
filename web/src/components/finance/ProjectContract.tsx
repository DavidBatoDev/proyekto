import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	useMutation,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import {
	ArrowLeft,
	FileSignature,
	GripVertical,
	Link2,
	ListPlus,
	Loader2,
	Minus,
	Plus,
	Send,
	Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import { DateField } from "@/components/common/DateField";
import { Dropdown } from "@/components/common/Dropdown";
import {
	AutosaveIndicator,
	FieldLabel,
	SelectField,
	TextField,
	ToggleField,
} from "@/components/common/FormFields";
import { ScopeDialog, type ScopeOption } from "@/components/common/ScopeDialog";
import {
	type ContractCanvasStats,
	ContractEditorCanvas,
} from "@/components/finance/ContractEditorCanvas";
import { ClientSigningLinkModal } from "@/components/project/ClientSigningLinkModal";
import type {
	PreviewParties,
	PreviewTerms,
} from "@/components/project/ContractDocumentPreview";
import {
	type CapturedInitials,
	InitialsPad,
	initialsFromName,
} from "@/components/project/signature/InitialsPad";
import { SignaturePad } from "@/components/project/signature/SignaturePad";
import { SignaturePlacementField } from "@/components/project/signature/SignaturePlacementField";
import { type AutosaveStatus, useAutosave } from "@/hooks/useAutosave";
import { useConfirm } from "@/hooks/useConfirm";
import { useToast } from "@/hooks/useToast";
import {
	type BillingMode,
	type ContractTermUnit,
	formatContractDate,
	formatPeriodRange,
	type InvoiceCadence,
} from "@/lib/contract-term";
import { CURRENCIES } from "@/lib/currency";
import {
	financeStatusBadgeClass,
	financeStatusMeta,
} from "@/lib/finance-status";
import {
	type BillingTiming,
	type Contract,
	type ContractClause,
	type ContractEditScope,
	type ContractService,
	contractService,
	type ProviderKind,
	type SignaturePlacement,
} from "@/services/contract.service";
import { projectService } from "@/services/project.service";
import { getTeam, listProjectTeams } from "@/services/teams.service";
import { useUser } from "@/stores/authStore";

const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({
	value: c.code,
	label: c.label,
}));

/**
 * `?step=` opens a specific document section. Unknown values fall through to
 * the default step so a stale bookmark still opens the page.
 */
export function ProjectContract({
	contractId,
	initialStep,
	onBack,
	onOpenContract,
}: {
	contractId: string;
	initialStep?: StepKey;
	onBack: () => void;
	onOpenContract?: (contractId: string) => void;
}) {
	const user = useUser();
	const qc = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const contractQuery = useQuery({
		queryKey: ["contract", contractId],
		queryFn: () => contractService.getById(contractId),
	});
	const contract = contractQuery.data ?? null;
	const projectQuery = useQuery({
		queryKey: ["project", contract?.project_id],
		queryFn: () => {
			if (!contract?.project_id) throw new Error("Project not found");
			return projectService.get(contract.project_id);
		},
		enabled: Boolean(contract?.project_id),
	});
	const project = projectQuery.data;
	const contractConsultantId =
		contract?.consultant_user_id ?? contract?.created_by ?? null;
	const consultantPosition = contract?.positions.find(
		(position) => position.capacity === "consultant",
	);
	const counterpartyPosition = contract?.positions.find(
		(position) => position.capacity !== "consultant",
	);
	// Whether the viewer is the provider on THIS contract. It used to ask the
	// execution layer instead — "is this person the project's consultant?", via
	// the member row whose origin was 'consultant' — which answered a contract
	// question with a project fact. The contract names its own parties.
	const isConsultant =
		user?.id === consultantPosition?.user_id ||
		(!consultantPosition && user?.id === contractConsultantId);
	const canSignAsConsultant = Boolean(user?.id) && isConsultant;
	const [activeStep, setActiveStep] = useState<StepKey>(
		initialStep ?? "parties",
	);
	const [zoom, setZoom] = useState(80);
	const [fitSignal, setFitSignal] = useState(0);
	const [signingLinkOpen, setSigningLinkOpen] = useState(false);
	const [canvasStats, setCanvasStats] = useState<ContractCanvasStats>({
		currentPage: 1,
		pageCount: 1,
		wordCount: 0,
	});
	const [previewParties, setPreviewParties] = useState<PreviewParties>(() =>
		partiesPreview(contract),
	);
	const [previewTerms, setPreviewTerms] = useState<PreviewTerms>(() =>
		termsPreview(contract),
	);
	const [documentClauses, setDocumentClauses] = useState<ContractClause[]>(
		() => contract?.clauses ?? [],
	);
	const documentClausesRef = useRef(documentClauses);
	const persistedClausesRef = useRef<ContractClause[]>([]);
	const persistedClauseContractIdRef = useRef<string | null>(null);
	documentClausesRef.current = documentClauses;

	useEffect(() => {
		if (initialStep) setActiveStep(initialStep);
	}, [initialStep]);
	useEffect(() => {
		setPreviewParties(partiesPreview(contract));
		setPreviewTerms(termsPreview(contract));
		setDocumentClauses(contract?.clauses ?? []);
		if (contract && persistedClauseContractIdRef.current !== contract.id) {
			persistedClauseContractIdRef.current = contract.id;
			persistedClausesRef.current = contract.clauses;
		}
	}, [contract]);

	const updateDocumentClauses = (clauses: ContractClause[]) => {
		void qc.cancelQueries({ queryKey: ["contract", contractId] });
		setDocumentClauses(clauses);
		qc.setQueryData<Contract>(["contract", contractId], (current) =>
			current ? { ...current, clauses } : current,
		);
	};

	const clausesSaveStatus = useAutosave(
		documentClauses,
		async (clauses) => {
			if (!contract) return;
			const saved = await contractService.update(contract.id, { clauses });
			persistedClausesRef.current = saved.clauses;
			qc.setQueryData<Contract>(["contract", contract.id], saved);
			void qc.invalidateQueries({
				queryKey: ["contracts", contract.project_id],
			});
		},
		{
			enabled: Boolean(
				contract && isConsultant && isEditableStatus(contract.status),
			),
			onError: (error, failedClauses) => {
				if (
					JSON.stringify(documentClausesRef.current) ===
					JSON.stringify(failedClauses)
				) {
					const rollback = persistedClausesRef.current;
					setDocumentClauses(rollback);
					qc.setQueryData<Contract>(["contract", contractId], (current) =>
						current ? { ...current, clauses: rollback } : current,
					);
				}
				toast.error(error.message);
			},
		},
	);

	const invalidateAll = () => {
		void qc.invalidateQueries({ queryKey: ["contract", contractId] });
		if (contract) {
			void qc.invalidateQueries({
				queryKey: ["contracts", contract.project_id],
			});
			void qc.invalidateQueries({ queryKey: ["project", contract.project_id] });
		}
		void qc.invalidateQueries({ queryKey: ["finance"] });
	};
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
			contractService.sign(contractId, party, name, signatureUrl, placement),
		onSuccess: () => {
			toast.success("Signature recorded");
			invalidateAll();
		},
		onError: (error: Error) => toast.error(error.message),
	});
	const placementMutation = useMutation({
		mutationFn: ({
			party,
			placement,
		}: {
			party: "consultant" | "client";
			placement: Partial<SignaturePlacement>;
		}) => contractService.setSignaturePlacement(contractId, party, placement),
		onSuccess: invalidateAll,
		onError: (error: Error) => toast.error(error.message),
	});
	const unsignMutation = useMutation({
		mutationFn: ({ party }: { party: "consultant" | "client" }) =>
			contractService.unsign(contractId, party),
		onSuccess: () => {
			toast.success("Signature removed");
			invalidateAll();
		},
		onError: (error: Error) => toast.error(error.message),
	});
	const deleteMutation = useMutation({
		mutationFn: () => contractService.delete(contractId),
		onSuccess: async () => {
			toast.success("Draft contract deleted");
			await Promise.all([
				qc.invalidateQueries({
					queryKey: ["finance", "contracts"],
					refetchType: "all",
				}),
				qc.invalidateQueries({
					queryKey: ["finance", "portfolio"],
					refetchType: "all",
				}),
			]);
			qc.removeQueries({ queryKey: ["contract", contractId] });
			onBack();
		},
		onError: (error: Error) => toast.error(error.message),
	});
	const deleteDraft = async () => {
		if (!contract) return;
		const confirmed = await confirm({
			title: "Delete this draft contract?",
			message:
				"This permanently removes the draft agreement. Sent and signed contracts cannot be deleted.",
			confirmLabel: "Delete draft",
			tone: "danger",
		});
		if (confirmed) deleteMutation.mutate();
	};

	if (contractQuery.isPending || (contract && projectQuery.isPending)) {
		return (
			<div className="flex h-[calc(100dvh-3.5rem-var(--safe-top))] items-center justify-center">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}
	if (contractQuery.isError || !contract) {
		return (
			<div className="flex h-[calc(100dvh-3.5rem-var(--safe-top))] items-center justify-center p-6">
				<AppSurfaceCard className="max-w-md p-8 text-center">
					<FileSignature className="mx-auto h-10 w-10 text-muted-foreground" />
					<h1 className="mt-3 text-base font-semibold text-foreground">
						Contract unavailable
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						It may have been removed, or you may no longer have access to its
						project.
					</p>
					<button
						type="button"
						onClick={onBack}
						className="mt-5 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
					>
						Back to contracts
					</button>
				</AppSurfaceCard>
			</div>
		);
	}

	const editable = isConsultant && isEditableStatus(contract.status);
	const adjustZoom = (delta: number) =>
		setZoom((current) => Math.max(30, Math.min(200, current + delta)));

	return (
		<div className="flex h-[calc(100dvh-3.5rem-var(--safe-top))] min-h-[520px] flex-col overflow-hidden bg-background">
			<header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3 shadow-sm">
				<div className="flex min-w-0 items-center gap-2">
					<button
						type="button"
						onClick={onBack}
						aria-label="Back to contracts"
						className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
					>
						<ArrowLeft className="h-4 w-4" />
					</button>
					<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<FileSignature className="h-4 w-4" />
					</span>
					<div className="min-w-0">
						<h1 className="truncate text-sm font-semibold text-foreground">
							{contract.contract_number
								? `Contract ${contract.contract_number}`
								: `Service agreement · Version ${contract.version}`}
						</h1>
						<p className="truncate text-[11px] text-muted-foreground">
							{project?.title ??
								contract.project_title_snapshot ??
								contract.client_name ??
								"Project removed"}
						</p>
					</div>
					<ContractStatusChip status={contract.status} />
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<Dropdown
						value={activeStep}
						onChange={(value) => setActiveStep(value as StepKey)}
						options={STEP_META.map((step) => ({
							value: step.key,
							label: step.label,
						}))}
						ariaLabel="Contract section"
						className="hidden w-40 lg:block"
					/>
					<div className="hidden items-center gap-0.5 rounded-md border border-border p-0.5 md:flex">
						<ZoomButton label="Zoom out" onClick={() => adjustZoom(-10)}>
							<Minus className="h-3.5 w-3.5" />
						</ZoomButton>
						<span className="w-10 text-center text-[11px] tabular-nums text-foreground">
							{zoom}%
						</span>
						<ZoomButton label="Zoom in" onClick={() => adjustZoom(10)}>
							<Plus className="h-3.5 w-3.5" />
						</ZoomButton>
					</div>
					{isConsultant && !contract.signed_by_client_at && (
						<button
							type="button"
							onClick={() => setSigningLinkOpen(true)}
							className="hidden items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-muted sm:inline-flex"
						>
							<Send className="h-3.5 w-3.5" /> Send to client
						</button>
					)}
					{isConsultant && contract.status === "draft" && (
						<button
							type="button"
							onClick={() => void deleteDraft()}
							disabled={deleteMutation.isPending}
							className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 px-2.5 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
						>
							{deleteMutation.isPending ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<Trash2 className="h-3.5 w-3.5" />
							)}
							<span className="hidden sm:inline">Delete draft</span>
						</button>
					)}
					<button
						type="button"
						onClick={() => setActiveStep("signatures")}
						className="app-cta rounded-md px-3 py-1.5 text-xs font-semibold text-white"
					>
						Signatures
					</button>
				</div>
			</header>
			<div className="grid min-h-0 flex-1 grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
				<div className="min-w-0 overflow-hidden">
					<ContractEditorCanvas
						contract={{ ...contract, clauses: documentClauses }}
						parties={previewParties}
						terms={previewTerms}
						activeSection={activeStep}
						onSectionSelect={(section) => setActiveStep(section)}
						editable={editable}
						onClauseChange={(key, patch) =>
							updateDocumentClauses(
								documentClauses.map((clause) =>
									clause.key === key ? { ...clause, ...patch } : clause,
								),
							)
						}
						zoom={zoom}
						onZoomChange={setZoom}
						fitSignal={fitSignal}
						onStatsChange={setCanvasStats}
						pageInitials={contract.page_initials}
					/>
				</div>
				<aside className="min-w-0 overflow-y-auto border-l border-border bg-background">
					<div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
						<div className="min-w-0 flex-1">
							<p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
								Inspector
							</p>
							<Dropdown
								value={activeStep}
								onChange={(value) => setActiveStep(value as StepKey)}
								options={STEP_META.map((step) => ({
									value: step.key,
									label: step.label,
								}))}
								ariaLabel="Inspector section"
								className="mt-1 w-full min-w-0"
							/>
						</div>
						{activeStep === "agreement" && editable && (
							<AutosaveIndicator status={clausesSaveStatus} className="mt-0" />
						)}
					</div>
					<div className="p-3">
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
								onAmended={(created) => onOpenContract?.(created.id)}
							/>
						)}
						{activeStep === "services" && (
							<ServicesSection contract={contract} editable={isConsultant} />
						)}
						{activeStep === "agreement" && (
							<AgreementSection
								contract={contract}
								editable={isConsultant}
								clauses={documentClauses}
								onChange={updateDocumentClauses}
								saveStatus={clausesSaveStatus}
							/>
						)}
						{activeStep === "signatures" && (
							<PageInitialsPanel
								contract={contract}
								pageCount={canvasStats.pageCount}
								viewerPosition={
									contract.positions.find((p) => p.user_id === user?.id)
										?.position ?? null
								}
								// The seat's own identity snapshot, which is what the
								// document already prints for this party.
								viewerName={
									contract.positions.find((p) => p.user_id === user?.id)
										?.display_name_snapshot ?? null
								}
								onSaved={() =>
									void qc.invalidateQueries({
										queryKey: ["contract", contract.id],
									})
								}
							/>
						)}
						{activeStep === "signatures" && (
							<SignatureSection
								contract={contract}
								isConsultant={isConsultant}
								canSignAsConsultant={canSignAsConsultant}
								canSignAsClient={
									Boolean(user?.id) &&
									(counterpartyPosition?.user_id === user?.id ||
										(!counterpartyPosition &&
											(contract.client_user_id === user?.id ||
												(project?.owner_id === user?.id &&
													project?.owner_id !== contractConsultantId))))
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
				</aside>
			</div>
			<footer className="flex h-9 shrink-0 items-center justify-between border-t border-border bg-card px-3 text-[11px] text-muted-foreground">
				<div className="flex items-center gap-4 tabular-nums">
					<span>
						Page {canvasStats.currentPage} of {canvasStats.pageCount}
					</span>
					<span>
						{canvasStats.wordCount}{" "}
						{canvasStats.wordCount === 1 ? "word" : "words"}
					</span>
					<span className="hidden sm:inline">
						{editable ? "Autosave on" : "Read only"}
					</span>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => setFitSignal((signal) => signal + 1)}
						className="rounded px-2 py-1 font-medium hover:bg-muted hover:text-foreground"
					>
						Fit width
					</button>
					<ZoomButton label="Zoom out" onClick={() => adjustZoom(-10)}>
						<Minus className="h-3.5 w-3.5" />
					</ZoomButton>
					<input
						type="range"
						min={30}
						max={200}
						step={10}
						value={zoom}
						onChange={(event) => setZoom(Number(event.target.value))}
						aria-label="Document zoom"
						className="h-1 w-24 accent-primary"
					/>
					<ZoomButton label="Zoom in" onClick={() => adjustZoom(10)}>
						<Plus className="h-3.5 w-3.5" />
					</ZoomButton>
					<button
						type="button"
						onClick={() => setZoom(100)}
						className="w-10 rounded py-1 text-center tabular-nums hover:bg-muted hover:text-foreground"
					>
						{zoom}%
					</button>
				</div>
			</footer>
			{signingLinkOpen && (
				<ClientSigningLinkModal
					contract={contract}
					onClose={() => setSigningLinkOpen(false)}
				/>
			)}
		</div>
	);
}

function ZoomButton({
	label,
	onClick,
	children,
}: {
	label: string;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
		>
			{children}
		</button>
	);
}

/* ── Document sections ────────────────────────────────────────────────────── */

export type StepKey =
	| "parties"
	| "terms"
	| "services"
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
	{ key: "agreement", label: "Agreement" },
	{ key: "signatures", label: "Signatures" },
];

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
			<legend className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
				{title}
			</legend>
			<div className="grid grid-cols-1 gap-y-3">{children}</div>
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
		provider_tin: contract?.provider_tin ?? null,
		provider_kind: contract?.provider_kind ?? null,
		client_name: contract?.client_name ?? "",
		client_contact_name: contract?.client_contact_name ?? "",
		client_address: contract?.client_address ?? "",
		client_email: contract?.client_email ?? null,
		client_tin: contract?.client_tin ?? null,
	};
}

/** Maps the saved contract into the commercial-terms fields the preview shows. */
function termsPreview(contract: Contract | null): PreviewTerms {
	return {
		currency: contract?.currency ?? "USD",
		billing_mode: contract?.billing_mode ?? "time_based",
		fixed_fee: contract?.fixed_fee?.toString() ?? "",
		recurring_fee: contract?.recurring_fee?.toString() ?? "",
		client_hourly_rate: contract?.client_hourly_rate?.toString() ?? "",
		service_description: contract?.service_description ?? "",
		payment_method: contract?.payment_method ?? "",
		due_days: String(contract?.due_days ?? 15),
		billing_timing: contract?.billing_timing ?? "arrears",
		auto_renew: contract?.auto_renew ?? false,
		notice_days: String(contract?.notice_days ?? 30),
	};
}

/* ── Status chip ──────────────────────────────────────────────────────────── */

function ContractStatusChip({ status }: { status: Contract["status"] }) {
	const meta = financeStatusMeta(status);
	return (
		<span
			title={meta.hint || undefined}
			className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${financeStatusBadgeClass(meta.tone)}`}
		>
			{meta.label}
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
	const confirm = useConfirm();
	const [draft, setDraft] = useState({
		// provider_kind rides the autosave draft so flipping the toggle records
		// the choice without touching the typed-in details. It used to fire a
		// destructive reseed on click, which is exactly what ReseedProviderDto's
		// own docstring says must not happen.
		provider_kind: contract.provider_kind,
		provider_name: contract.provider_name ?? "",
		provider_address: contract.provider_address ?? "",
		provider_tin: contract.provider_tin ?? "",
		client_name: contract.client_name ?? "",
		client_contact_name: contract.client_contact_name ?? "",
		client_address: contract.client_address ?? "",
		client_tin: contract.client_tin ?? "",
		client_email: contract.client_email ?? "",
	});

	// Only teams attached to this project are legitimate providers — and the
	// backend enforces the same rule, so offering anything else would just 400.
	const attachedTeamsQuery = useQuery({
		queryKey: ["project", contract.project_id, "teams"],
		queryFn: () =>
			contract.project_id
				? listProjectTeams(contract.project_id)
				: Promise.resolve([]),
		enabled: Boolean(contract.project_id),
	});
	const attachedTeams = useMemo(
		() => attachedTeamsQuery.data ?? [],
		[attachedTeamsQuery.data],
	);
	// project_teams carries only ids, so resolve the names the picker shows.
	const teamDetailQueries = useQueries({
		queries: attachedTeams.map((t) => ({
			queryKey: ["teams", "detail", t.team_id],
			queryFn: () => getTeam(t.team_id),
			staleTime: 5 * 60_000,
		})),
	});
	const teamNameById = useMemo(() => {
		const map: Record<string, string> = {};
		teamDetailQueries.forEach((q, i) => {
			const id = attachedTeams[i]?.team_id;
			if (id) map[id] = q.data?.name ?? "Team";
		});
		return map;
	}, [teamDetailQueries, attachedTeams]);
	const primaryTeamId = useMemo(
		() =>
			(attachedTeams.find((t) => t.is_primary) ?? attachedTeams[0])?.team_id ??
			"",
		[attachedTeams],
	);
	const [refillTeamId, setRefillTeamId] = useState("");
	const effectiveRefillTeamId = refillTeamId || primaryTeamId;

	// Feed the live document preview as the consultant edits.
	useEffect(() => {
		onDraftChange?.({
			provider_name: draft.provider_name,
			provider_address: draft.provider_address,
			provider_email: contract.provider_email,
			provider_tin: draft.provider_tin,
			provider_kind: draft.provider_kind,
			client_name: draft.client_name,
			client_contact_name: draft.client_contact_name,
			client_address: draft.client_address,
			client_email: draft.client_email,
			client_tin: draft.client_tin,
		});
	}, [
		draft.provider_name,
		draft.provider_address,
		draft.provider_tin,
		draft.provider_kind,
		draft.client_name,
		draft.client_contact_name,
		draft.client_address,
		draft.client_email,
		draft.client_tin,
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
			void qc.invalidateQueries({ queryKey: ["contract", contract.id] });
		},
		{ enabled: !locked, onError: (err) => toast.error(err.message) },
	);

	/**
	 * Refilling is destructive, so it goes through its own endpoint and its own
	 * confirm — never through the autosave draft above, which would race with it.
	 */
	const reseedMutation = useMutation({
		mutationFn: (input: { kind: ProviderKind; teamId?: string }) =>
			contractService.reseedProvider(contract.id, input.kind, input.teamId),
		onSuccess: (updated) => {
			setDraft((d) => ({
				...d,
				provider_name: updated.provider_name ?? "",
				provider_address: updated.provider_address ?? "",
				provider_tin: updated.provider_tin ?? "",
			}));
			void qc.invalidateQueries({
				queryKey: ["contracts", contract.project_id],
			});
			void qc.invalidateQueries({ queryKey: ["contract", contract.id] });
			toast.success(
				updated.provider_kind === "agency"
					? "Filled in from your team's billing identity."
					: "Filled in from your profile.",
			);
		},
		onError: (err) => toast.error((err as Error).message),
	});

	const hasProviderDetails = Boolean(
		draft.provider_name.trim() ||
			draft.provider_address.trim() ||
			draft.provider_tin.trim(),
	);

	const refill = async () => {
		const kind = draft.provider_kind;
		const source =
			kind === "agency"
				? (teamNameById[effectiveRefillTeamId] ?? "that team")
				: "your profile";
		if (hasProviderDetails) {
			const ok = await confirm({
				title: "Replace the service-provider details?",
				message: `Name, address and TIN will be overwritten with ${
					kind === "agency"
						? `the billing identity saved on ${source}`
						: "your personal profile"
				}. Anything you typed here is lost.`,
				confirmLabel: "Replace details",
				tone: "danger",
			});
			if (!ok) return;
		}
		reseedMutation.mutate({
			kind,
			teamId:
				kind === "agency" ? effectiveRefillTeamId || undefined : undefined,
		});
	};

	return (
		<section className="px-1 py-1 [&_.text-sm]:text-xs [&_.text-xs]:text-[11px] [&_input:not([type=checkbox])]:text-xs [&_button]:text-[11px]">
			<h2 className="text-sm font-semibold text-foreground">Parties</h2>
			<div className="mt-3 grid grid-cols-1 gap-4">
				<div className="space-y-2.5">
					<p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
						Service provider
					</p>

					<ProviderKindToggle
						value={draft.provider_kind}
						disabled={locked}
						onChange={(kind) =>
							setDraft((d) => ({ ...d, provider_kind: kind }))
						}
					/>

					{draft.provider_kind === "agency" && attachedTeams.length > 1 && (
						<div className="space-y-1">
							<span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
								Bill as
							</span>
							<Dropdown
								value={effectiveRefillTeamId}
								onChange={setRefillTeamId}
								disabled={locked || reseedMutation.isPending}
								options={attachedTeams.map((t) => ({
									value: t.team_id,
									label: `${teamNameById[t.team_id] ?? "Team"}${
										t.is_primary ? " · primary" : ""
									}`,
								}))}
							/>
						</div>
					)}

					<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
						<button
							type="button"
							onClick={() => void refill()}
							disabled={
								locked ||
								reseedMutation.isPending ||
								(draft.provider_kind === "agency" && !effectiveRefillTeamId)
							}
							className="text-[11px] font-semibold text-primary underline-offset-2 hover:underline disabled:opacity-50"
						>
							{reseedMutation.isPending
								? "Refilling…"
								: draft.provider_kind === "agency"
									? "Refill from team settings"
									: "Refill from my profile"}
						</button>
						{draft.provider_kind === "individual" && (
							<span className="text-[11px] text-muted-foreground">
								Your profile has no business address or tax ID — type them here.
							</span>
						)}
						{draft.provider_kind === "agency" && attachedTeams.length === 0 && (
							<span className="text-[11px] text-muted-foreground">
								No team attached — attach one on the Team page to bill as an
								agency.
							</span>
						)}
					</div>
					{draft.provider_kind === "agency" && attachedTeams.length > 1 && (
						<p className="text-[11px] text-muted-foreground">
							This only picks whose details to copy. It does not change the
							project's primary team.
						</p>
					)}

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
				<div className="space-y-2.5">
					<p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
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
		</section>
	);
}

/* ── Commercial terms ─────────────────────────────────────────────────────── */

/**
 * The editable Commercial Terms draft, seeded from a saved contract. Named so
 * that discarding an amendment can reset straight back to what is signed.
 */
function draftFromContract(contract: Contract) {
	return {
		currency: contract.currency,
		billing_mode: contract.billing_mode,
		billing_timing: contract.billing_timing ?? ("arrears" as BillingTiming),
		fixed_fee: contract.fixed_fee?.toString() ?? "",
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
		auto_renew: contract.auto_renew ?? false,
		notice_days: String(contract.notice_days ?? 30),
		time_tracking_mode: contract.time_tracking_mode,
		allow_manual_time: contract.allow_manual_time,
		time_rounding_minutes: String(contract.time_rounding_minutes ?? 0),
		weekly_time_limit_minutes:
			contract.weekly_time_limit_minutes?.toString() ?? "",
		client_hours_detail_level: contract.client_hours_detail_level,
	};
}

function TermsSection({
	contract,
	editable,
	onDraftChange,
	onAmended,
}: {
	contract: Contract;
	editable: boolean;
	onDraftChange?: (terms: PreviewTerms) => void;
	onAmended?: (contract: Contract) => void;
}) {
	const qc = useQueryClient();
	const toast = useToast();
	const [draft, setDraft] = useState(() => draftFromContract(contract));

	// Feed the live document preview as the consultant edits.
	useEffect(() => {
		onDraftChange?.({
			currency: draft.currency,
			billing_mode: draft.billing_mode,
			fixed_fee: draft.fixed_fee,
			recurring_fee: draft.recurring_fee,
			client_hourly_rate: draft.client_hourly_rate,
			service_description: draft.service_description,
			payment_method: draft.payment_method,
			due_days: draft.due_days,
			billing_timing: draft.billing_timing,
			auto_renew: draft.auto_renew,
			notice_days: draft.notice_days,
		});
	}, [
		draft.currency,
		draft.billing_mode,
		draft.fixed_fee,
		draft.recurring_fee,
		draft.client_hourly_rate,
		draft.service_description,
		draft.payment_method,
		draft.due_days,
		draft.billing_timing,
		draft.auto_renew,
		draft.notice_days,
		onDraftChange,
	]);

	// A signed contract can't be edited in place, but its terms may still need
	// to change. "Amend" unlocks the same fields into a local draft that is
	// submitted as a new version rather than autosaved over the signed one.
	const [amending, setAmending] = useState(false);
	const [scopeOpen, setScopeOpen] = useState(false);
	const signed = contract.status === "signed";
	const locked = !editable || (!isEditableStatus(contract.status) && !amending);

	const termsPayload = (d: typeof draft) => ({
		currency: d.currency,
		billing_mode: d.billing_mode,
		billing_timing: d.billing_timing,
		fixed_fee: numberOrNull(d.fixed_fee),
		recurring_fee: numberOrNull(d.recurring_fee),
		client_hourly_rate: numberOrNull(d.client_hourly_rate),
		included_hours: numberOrNull(d.included_hours),
		invoice_cadence: d.invoice_cadence,
		invoice_offset_days: Number(d.invoice_offset_days) || 0,
		due_days: Number(d.due_days) || 0,
		invoice_number_prefix: d.invoice_number_prefix.trim() || undefined,
		service_description: d.service_description.trim() || undefined,
		payment_method: d.payment_method.trim() || undefined,
		time_tracking_mode: d.time_tracking_mode,
		allow_manual_time: d.allow_manual_time,
		time_rounding_minutes: Number(d.time_rounding_minutes) || 0,
		weekly_time_limit_minutes: numberOrNull(d.weekly_time_limit_minutes),
		client_hours_detail_level: d.client_hours_detail_level,
		service_start_date: d.service_start_date || undefined,
		term_count: Number(d.term_count) || undefined,
		term_unit: d.term_unit,
		auto_renew: d.auto_renew,
		notice_days: numberOrNull(d.notice_days),
	});

	const amendMutation = useMutation({
		mutationFn: (scope: ContractEditScope) =>
			contractService.amend(contract.id, scope, termsPayload(draft)),
		onSuccess: (created) => {
			toast.success(
				`Version ${created.version} created as a draft — both parties need to sign it.`,
			);
			setAmending(false);
			setScopeOpen(false);
			void qc.invalidateQueries({
				queryKey: ["contracts", contract.project_id],
			});
			onAmended?.(created);
		},
		onError: (err) => {
			toast.error((err as Error).message);
			setScopeOpen(false);
		},
	});

	const saveStatus = useAutosave(
		draft,
		async (d) => {
			await contractService.update(contract.id, {
				currency: d.currency,
				billing_mode: d.billing_mode,
				billing_timing: d.billing_timing,
				fixed_fee: numberOrNull(d.fixed_fee),
				recurring_fee: numberOrNull(d.recurring_fee),
				client_hourly_rate: numberOrNull(d.client_hourly_rate),
				included_hours: numberOrNull(d.included_hours),
				invoice_cadence: d.invoice_cadence,
				invoice_offset_days: Number(d.invoice_offset_days) || 0,
				due_days: Number(d.due_days) || 0,
				invoice_number_prefix: d.invoice_number_prefix.trim() || undefined,
				service_description: d.service_description.trim() || undefined,
				payment_method: d.payment_method.trim() || undefined,
				time_tracking_mode: d.time_tracking_mode,
				allow_manual_time: d.allow_manual_time,
				time_rounding_minutes: Number(d.time_rounding_minutes) || 0,
				weekly_time_limit_minutes: numberOrNull(d.weekly_time_limit_minutes),
				client_hours_detail_level: d.client_hours_detail_level,
				service_start_date: d.service_start_date || undefined,
				term_count: Number(d.term_count) || undefined,
				term_unit: d.term_unit,
				auto_renew: d.auto_renew,
				notice_days: numberOrNull(d.notice_days),
			});
			void qc.invalidateQueries({
				queryKey: ["contracts", contract.project_id],
			});
			void qc.invalidateQueries({ queryKey: ["contract", contract.id] });
		},
		{
			enabled: !locked && !amending,
			onError: (err) => toast.error(err.message),
		},
	);
	const usesFee =
		draft.billing_mode === "retainer" || draft.billing_mode === "hybrid";
	const usesRate =
		draft.billing_mode === "time_based" || draft.billing_mode === "hybrid";
	const usesFixed = draft.billing_mode === "fixed";
	const advanceBilling = draft.billing_timing === "advance";

	return (
		<section className="px-1 py-1 [&_.text-sm]:text-xs [&_.text-xs]:text-[11px] [&_input:not([type=checkbox])]:text-xs [&_button]:text-[11px]">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 className="text-sm font-semibold text-foreground">
						Commercial terms
					</h2>
					<p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
						These drive every client invoice. Rates here are what the{" "}
						<span className="font-semibold">client</span> pays — team member
						rates are separate and stay internal.
					</p>
				</div>
				{editable && signed && !amending && (
					<button
						type="button"
						onClick={() => setAmending(true)}
						className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold text-foreground transition hover:bg-muted"
					>
						Amend terms
					</button>
				)}
			</div>

			{amending && (
				<div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
					<p className="text-[11px] leading-4 text-muted-foreground">
						Editing an amendment. Nothing is saved until you choose which
						invoices it applies to.
					</p>
					<div className="flex shrink-0 items-center gap-2">
						<button
							type="button"
							onClick={() => {
								setDraft(draftFromContract(contract));
								setAmending(false);
							}}
							className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-muted"
						>
							Discard
						</button>
						<button
							type="button"
							onClick={() => setScopeOpen(true)}
							disabled={amendMutation.isPending}
							className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
						>
							{amendMutation.isPending ? "Amending…" : "Apply change…"}
						</button>
					</div>
				</div>
			)}

			<div className="mt-4 space-y-4">
				<FieldGroup
					title={
						contract.relationship_kind === "talent_services"
							? "How Talent is paid"
							: "How the Client is charged"
					}
				>
					<SelectField
						label="Charging model"
						hint="How the client is charged. Retainer bills a flat fee each period; Hourly bills approved time at the rate below; Retainer + overage bills the fee plus any hours beyond the included allowance."
						value={draft.billing_mode}
						disabled={locked}
						onChange={(v) => {
							const mode = v as BillingMode;
							setDraft((d) => ({
								...d,
								billing_mode: mode,
								// Advance is retainer-only (the backend and a DB CHECK both
								// enforce it). Snap back rather than autosaving a combination
								// that would 400.
								billing_timing:
									mode === "retainer" ? d.billing_timing : "arrears",
							}));
						}}
						options={[
							{ value: "retainer", label: "Recurring retainer" },
							{ value: "time_based", label: "Hourly (approved hours)" },
							{ value: "hybrid", label: "Retainer + overage" },
							{ value: "fixed", label: "Fixed contract amount" },
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
							label="Fee per billing period"
							hint="The flat amount billed each period, before any overage. This is the client price — what you pay the team is set separately, in Financials."
							type="number"
							value={draft.recurring_fee}
							onChange={(v) => setDraft((d) => ({ ...d, recurring_fee: v }))}
							disabled={locked}
						/>
					)}
					{usesFixed && (
						<TextField
							label="Fixed contract amount"
							hint="Fixed Client contracts are manually invoiced until milestone billing ships."
							type="number"
							value={draft.fixed_fee}
							onChange={(v) => setDraft((d) => ({ ...d, fixed_fee: v }))}
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
							label="Hours included in the fee"
							hint="Hours the retainer already covers each period. Approved time beyond this is billed at the hourly rate as overage."
							type="number"
							value={draft.included_hours}
							onChange={(v) => setDraft((d) => ({ ...d, included_hours: v }))}
							disabled={locked}
						/>
					)}
				</FieldGroup>

				<FieldGroup title="Time policy">
					<SelectField
						label="Time tracking"
						value={draft.time_tracking_mode}
						disabled={locked}
						onChange={(v) =>
							setDraft((d) => ({
								...d,
								time_tracking_mode: v as typeof d.time_tracking_mode,
							}))
						}
						options={[
							{ value: "disabled", label: "Disabled" },
							{ value: "optional", label: "Optional" },
							{ value: "required", label: "Required" },
						]}
					/>
					<SelectField
						label="Client hours detail"
						value={draft.client_hours_detail_level}
						disabled={
							locked || contract.relationship_kind === "talent_services"
						}
						onChange={(v) =>
							setDraft((d) => ({
								...d,
								client_hours_detail_level:
									v as typeof d.client_hours_detail_level,
							}))
						}
						options={[
							{ value: "none", label: "None" },
							{ value: "summary", label: "Summary" },
							{ value: "detailed", label: "Detailed" },
						]}
					/>
					<TextField
						label="Rounding minutes"
						type="number"
						value={draft.time_rounding_minutes}
						onChange={(v) =>
							setDraft((d) => ({ ...d, time_rounding_minutes: v }))
						}
						disabled={locked}
					/>
					<TextField
						label="Weekly time limit"
						hint="Leave empty for no limit."
						type="number"
						value={draft.weekly_time_limit_minutes}
						onChange={(v) =>
							setDraft((d) => ({ ...d, weekly_time_limit_minutes: v }))
						}
						disabled={locked}
					/>
				</FieldGroup>

				<FieldGroup title="When invoices go out">
					<SelectField
						label="How often you invoice"
						hint="Monthly raises one invoice per calendar month. Twice a month follows your team's pay cut-offs, so client billing lines up with when you pay the team."
						value={draft.invoice_cadence}
						disabled={locked}
						onChange={(v) =>
							setDraft((d) => ({ ...d, invoice_cadence: v as InvoiceCadence }))
						}
						options={[
							{ value: "monthly", label: "Once a month" },
							{
								value: "semi_monthly",
								label: "Twice a month (your team's pay cut-offs)",
							},
						]}
					/>
					<SelectField
						label="Invoice timing"
						hint="In arrears — invoice after the period has been delivered. In advance — invoice before the period starts (a prepaid retainer). Advance is only available on a recurring retainer, since hourly work has to be logged and approved before it can be billed."
						value={draft.billing_timing}
						disabled={locked || draft.billing_mode !== "retainer"}
						onChange={(v) =>
							setDraft((d) => ({ ...d, billing_timing: v as BillingTiming }))
						}
						options={[
							{ value: "arrears", label: "In arrears (after the period)" },
							{ value: "advance", label: "In advance (prepaid)" },
						]}
					/>
					<TextField
						label={
							advanceBilling
								? "Invoice lead time (days before)"
								: "Invoice lead time (days after)"
						}
						hint={
							advanceBilling
								? "Days BEFORE the period starts to raise its invoice. 7 sends the invoice a week ahead of the month it covers."
								: "Days to wait AFTER a period closes before raising its invoice. 0 invoices on the closing day; a few days gives you time to approve hours first."
						}
						type="number"
						value={draft.invoice_offset_days}
						onChange={(v) =>
							setDraft((d) => ({ ...d, invoice_offset_days: v }))
						}
						disabled={locked}
					/>
					<TextField
						label="Payment due (days after invoice)"
						hint="Your net terms. 15 means the client has 15 days from the invoice date to pay; it sets each invoice's due date. This is the payment window, not a late-payment grace period."
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

				<FieldGroup title="Term & renewal">
					<DateField
						label="Service start date"
						hint="The day the engagement begins. Billing periods are counted from here, and no invoice is generated before it."
						value={draft.service_start_date}
						onChange={(v) => setDraft((d) => ({ ...d, service_start_date: v }))}
						disabled={locked}
					/>
					<TermLengthField
						count={draft.term_count}
						unit={draft.term_unit}
						disabled={locked}
						onCountChange={(v) => setDraft((d) => ({ ...d, term_count: v }))}
						onUnitChange={(v) => setDraft((d) => ({ ...d, term_unit: v }))}
					/>
					<ToggleField
						label="Renews automatically"
						hint={`When on, the term rolls over for another ${draft.term_count || "—"} ${
							draft.term_unit === "year" ? "year(s)" : "month(s)"
						} unless either side gives notice.`}
						checked={draft.auto_renew}
						disabled={locked}
						onChange={(v) => setDraft((d) => ({ ...d, auto_renew: v }))}
						onLabel="Renews automatically"
						offLabel="Ends at the term"
					/>
					<TextField
						label="Notice to cancel (days)"
						hint="Written notice either side must give to end the agreement or stop a renewal. It also drives the 'contract ending soon' reminder."
						type="number"
						value={draft.notice_days}
						onChange={(v) => setDraft((d) => ({ ...d, notice_days: v }))}
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

			{!locked && !amending && <AutosaveIndicator status={saveStatus} />}

			<ScopeDialog
				open={scopeOpen}
				title="Which invoices does this change apply to?"
				options={CONTRACT_SCOPE_OPTIONS}
				footnote={`Amending creates version ${contract.version + 1} of the agreement. Both parties re-sign it before it takes effect — the current version keeps governing until then.`}
				onClose={() => setScopeOpen(false)}
				onPick={(scope) => {
					if (scope === "this") {
						setScopeOpen(false);
						toast.error(
							"Open that invoice in the invoice editor — a one-off change doesn't alter the agreement.",
						);
						return;
					}
					amendMutation.mutate(scope);
				}}
			/>
		</section>
	);
}

/**
 * The contract flavour of the recurring-scope prompt. Unlike the meetings
 * version, two of these three write a whole new agreement — so the dialog says
 * what each one actually does rather than just naming it.
 */
const CONTRACT_SCOPE_OPTIONS: ReadonlyArray<ScopeOption<ContractEditScope>> = [
	{
		scope: "this",
		label: "Only this invoice",
		description: "A one-off change. The agreement is untouched.",
	},
	{
		scope: "following",
		label: "This period and future ones",
		description:
			"The current agreement ends the day before, and a new version takes over.",
	},
	{
		scope: "all",
		label: "The whole engagement",
		description: "Replaces the terms from the original service start date.",
	},
];

/**
 * Individual-vs-agency, at the contract level rather than the team level.
 *
 * Some consultants work under an agency, some as themselves, and the same
 * person may want one engagement kept off the agency's books for tax reasons.
 * Tying this to "does the project have a team attached" would get that wrong,
 * so it is a per-contract choice.
 */
function ProviderKindToggle({
	value,
	disabled,
	onChange,
}: {
	value: ProviderKind;
	disabled?: boolean;
	onChange: (kind: ProviderKind) => void;
}) {
	const options: Array<{ kind: ProviderKind; label: string }> = [
		{ kind: "individual", label: "Individual contractor" },
		{ kind: "agency", label: "Agency or company" },
	];
	return (
		<div className="inline-flex rounded-md border border-border p-0.5 text-[11px] font-medium">
			{options.map((o) => (
				<button
					key={o.kind}
					type="button"
					disabled={disabled || value === o.kind}
					onClick={() => onChange(o.kind)}
					className={`rounded px-2 py-1 transition ${
						value === o.kind
							? "bg-primary text-primary-foreground"
							: "text-muted-foreground hover:text-foreground disabled:opacity-50"
					}`}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

/**
 * Term length as one field rather than two. "Term length: 12" beside a separate
 * "Term unit: Months" read as two unrelated settings; the count is meaningless
 * without its unit, so they share a row and a label.
 */
function TermLengthField({
	count,
	unit,
	disabled,
	onCountChange,
	onUnitChange,
}: {
	count: string;
	unit: ContractTermUnit;
	disabled?: boolean;
	onCountChange: (value: string) => void;
	onUnitChange: (value: ContractTermUnit) => void;
}) {
	return (
		<FieldLabel
			label="Term length"
			hint="How long the engagement runs from the start date. The exact service end date is shown in the schedule below."
		>
			<div className="flex items-center gap-2">
				<input
					type="number"
					min={1}
					value={count}
					disabled={disabled}
					aria-label="Term length"
					onChange={(e) => onCountChange(e.target.value)}
					className="w-20 rounded-md border border-input bg-card px-2.5 py-1.5 text-xs text-card-foreground shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-70"
				/>
				<div className="flex-1">
					<Dropdown
						value={unit}
						onChange={(v) => onUnitChange(v as ContractTermUnit)}
						options={[
							{ value: "month", label: "Months" },
							{ value: "year", label: "Years" },
						]}
						disabled={disabled}
						ariaLabel="Term unit"
					/>
				</div>
			</div>
		</FieldLabel>
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
			<div className="mt-4 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-4 text-center text-[11px] text-muted-foreground">
				Set a service start date and term length to see the billing schedule.
			</div>
		);
	}

	return (
		<div className="mt-4 overflow-hidden rounded-lg border border-border">
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border bg-muted/40 px-3 py-2">
				<div>
					<p className="text-[11px] font-semibold text-foreground">
						Billing schedule
					</p>
					<p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
						{formatContractDate(contract.service_start_date)} –{" "}
						{formatContractDate(contract.service_end_date)}
						{contract.contract_end_date &&
						contract.contract_end_date !== contract.service_end_date
							? ` · contract ends ${formatContractDate(contract.contract_end_date)}`
							: ""}
						{contract.billing_timing === "advance"
							? " · invoiced in advance"
							: ""}
					</p>
				</div>
				<span className="rounded-full bg-card px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
					{periods.length} invoice{periods.length === 1 ? "" : "s"}
				</span>
			</div>

			<div className="overflow-x-auto">
				<table className="w-full text-[11px]">
					<thead className="text-left text-[9px] uppercase tracking-wide text-muted-foreground">
						<tr className="border-b border-border">
							<th className="px-2.5 py-1.5 font-semibold">#</th>
							<th className="px-2.5 py-1.5 font-semibold">Period covered</th>
							<th className="px-2.5 py-1.5 font-semibold">Invoice date</th>
							<th className="px-2.5 py-1.5 font-semibold">Payment due</th>
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
									<td className="px-2.5 py-1.5 tabular-nums text-muted-foreground">
										{index + 1}
									</td>
									<td className="px-2.5 py-1.5 font-medium">
										{formatPeriodRange(period)}
									</td>
									<td className="px-2.5 py-1.5 tabular-nums">
										{formatContractDate(period.invoiceDate)}
									</td>
									<td className="px-2.5 py-1.5 tabular-nums">
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
					className="w-full border-t border-border bg-muted/30 px-3 py-1.5 text-[10px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
				>
					{showAll
						? "Show fewer"
						: `Show all ${periods.length} billing periods`}
				</button>
			)}
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
			void qc.invalidateQueries({ queryKey: ["contract", contract.id] });
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
		<section className="px-1 py-1 [&_.text-sm]:text-xs [&_.text-xs]:text-[11px] [&_input:not([type=checkbox])]:text-xs [&_button]:text-[11px]">
			<h2 className="text-sm font-semibold text-foreground">Services</h2>
			<p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
				The billable services this contract covers. You can pick these directly
				into an invoice instead of retyping each line.
			</p>

			<div className="mt-3 space-y-2.5">
				{services.length === 0 && (
					<p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-4 text-center text-[11px] text-muted-foreground">
						No services defined yet.
					</p>
				)}
				{services.map((service, index) => (
					<div
						key={service.id}
						className="rounded-lg border border-border bg-muted/30 p-3"
					>
						<div className="mb-2 flex items-center justify-between gap-2">
							<p className="text-[11px] font-semibold text-foreground">
								Service {index + 1}
							</p>
							{!locked && (
								<button
									type="button"
									onClick={() => removeRow(service.id)}
									className="rounded-md px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
								>
									Remove
								</button>
							)}
						</div>
						<FieldLabel
							label="Service"
							hint="What you're billing for. This becomes the invoice line's description."
						>
							<input
								type="text"
								value={service.name}
								disabled={locked}
								placeholder="e.g. Digital Marketing"
								onChange={(e) => patchRow(service.id, { name: e.target.value })}
								className="min-w-0 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-70"
							/>
						</FieldLabel>
						<div className="mt-2 flex flex-wrap gap-2">
							<FieldLabel
								label="Billed per"
								hint="The unit the rate applies to — per hour, per month, or a one-off per project."
								className="min-w-36 flex-1"
							>
								<select
									value={service.unit ?? ""}
									disabled={locked}
									onChange={(e) =>
										patchRow(service.id, { unit: e.target.value })
									}
									className="min-w-0 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-70"
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
								className="min-w-36 flex-1"
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
									className="min-w-0 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-70"
								/>
							</FieldLabel>
						</div>
						<FieldLabel
							label="Description"
							optional
							hint="Extra detail shown under the line on the invoice."
							className="mt-2"
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
				<div className="mt-3 flex items-center gap-2">
					<button
						type="button"
						onClick={addRow}
						className="rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold text-foreground hover:bg-muted"
					>
						+ Add service
					</button>
					<AutosaveIndicator status={saveStatus} className="mt-0" />
				</div>
			)}
		</section>
	);
}

/* ── Agreement clauses ────────────────────────────────────────────────────── */

const ROOT_CLAUSE_PARENT = "__root__";

function clauseParent(
	clause: ContractClause,
	knownKeys: Set<string>,
): string | null {
	return clause.parent_key && knownKeys.has(clause.parent_key)
		? clause.parent_key
		: null;
}

function clauseSiblings(
	clauses: ContractClause[],
	parentKey: string | null,
): ContractClause[] {
	const knownKeys = new Set(clauses.map((clause) => clause.key));
	return clauses
		.filter((clause) => clauseParent(clause, knownKeys) === parentKey)
		.sort((left, right) => left.position - right.position);
}

function flattenClauseTree(
	clauses: ContractClause[],
	overrides = new Map<string, ContractClause[]>(),
): ContractClause[] {
	const result: ContractClause[] = [];
	const visited = new Set<string>();
	const visit = (parentKey: string | null) => {
		const siblings =
			overrides.get(parentKey ?? ROOT_CLAUSE_PARENT) ??
			clauseSiblings(clauses, parentKey);
		for (const clause of siblings) {
			if (visited.has(clause.key)) continue;
			visited.add(clause.key);
			result.push(clause);
			visit(clause.key);
		}
	};
	visit(null);
	for (const clause of clauses) {
		if (visited.has(clause.key)) continue;
		visited.add(clause.key);
		result.push({ ...clause, parent_key: null });
		visit(clause.key);
	}
	return result.map((clause, position) => ({ ...clause, position }));
}

function clauseDescendantKeys(
	clauses: ContractClause[],
	key: string,
): Set<string> {
	const removed = new Set([key]);
	let changed = true;
	while (changed) {
		changed = false;
		for (const clause of clauses) {
			if (!clause.parent_key || !removed.has(clause.parent_key)) continue;
			if (removed.has(clause.key)) continue;
			removed.add(clause.key);
			changed = true;
		}
	}
	return removed;
}

function SortableClauseRow({
	clause,
	number,
	depth,
	locked,
	onAddSubclause,
	onDelete,
	children,
}: {
	clause: ContractClause;
	number: string;
	depth: number;
	locked: boolean;
	onAddSubclause: (clause: ContractClause) => void;
	onDelete: (clause: ContractClause) => void;
	children?: React.ReactNode;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: clause.key, disabled: locked });

	return (
		<div
			ref={setNodeRef}
			style={{
				transform: CSS.Transform.toString(transform),
				transition,
			}}
			className={isDragging ? "relative z-20 opacity-40" : "relative"}
		>
			<div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-2.5 py-1.5">
				{!locked && (
					<button
						type="button"
						aria-label={"Drag " + clause.title + " to reorder"}
						className="shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:text-foreground active:cursor-grabbing"
						{...attributes}
						{...listeners}
					>
						<GripVertical className="h-3.5 w-3.5" />
					</button>
				)}
				<span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded bg-background px-1 text-[10px] font-semibold text-muted-foreground">
					{number}
				</span>
				<p className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
					{clause.title}
				</p>
				{!locked && (
					<div className="flex shrink-0 items-center gap-0.5">
						{depth === 0 && (
							<button
								type="button"
								onClick={() => onAddSubclause(clause)}
								aria-label={"Add a subclause to " + clause.title}
								className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
							>
								<ListPlus className="h-3 w-3" />
							</button>
						)}
						<button
							type="button"
							onClick={() => onDelete(clause)}
							aria-label={"Delete " + clause.title}
							className="rounded p-1 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
						>
							<Trash2 className="h-3 w-3" />
						</button>
					</div>
				)}
			</div>
			{children}
		</div>
	);
}

function AgreementSection({
	contract,
	editable,
	clauses,
	onChange,
	saveStatus,
}: {
	contract: Contract;
	editable: boolean;
	clauses: ContractClause[];
	onChange: (clauses: ContractClause[]) => void;
	saveStatus: AutosaveStatus;
}) {
	const locked = !editable || !isEditableStatus(contract.status);
	const confirm = useConfirm();
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const removeClause = async (clause: ContractClause) => {
		const removed = clauseDescendantKeys(clauses, clause.key);
		const confirmed = await confirm({
			title: `Delete “${clause.title}”?`,
			message:
				removed.size > 1
					? "This also removes its nested clauses and cannot be undone."
					: "This removes the clause from the agreement and cannot be undone.",
			confirmLabel: "Delete clause",
			tone: "danger",
		});
		if (!confirmed) return;

		onChange(
			flattenClauseTree(clauses.filter((item) => !removed.has(item.key))),
		);
	};

	const addClause = (parent: ContractClause | null) => {
		onChange(
			flattenClauseTree([
				...clauses,
				{
					key: "custom_" + crypto.randomUUID(),
					parent_key: parent?.key ?? null,
					title: parent ? "New subclause" : "New clause",
					body: parent
						? "Add the subclause text here."
						: "Add the clause text here.",
					position: clauses.length,
				},
			]),
		);
	};

	const reorder = (event: DragEndEvent) => {
		const { active, over } = event;
		if (!over || active.id === over.id) return;
		const activeClause = clauses.find((clause) => clause.key === active.id);
		const overClause = clauses.find((clause) => clause.key === over.id);
		if (!activeClause || !overClause) return;

		const knownKeys = new Set(clauses.map((clause) => clause.key));
		const parent = clauseParent(activeClause, knownKeys);
		if (parent !== clauseParent(overClause, knownKeys)) return;

		const siblings = clauseSiblings(clauses, parent);
		const oldIndex = siblings.findIndex(
			(clause) => clause.key === activeClause.key,
		);
		const newIndex = siblings.findIndex(
			(clause) => clause.key === overClause.key,
		);
		if (oldIndex < 0 || newIndex < 0) return;

		onChange(
			flattenClauseTree(
				clauses,
				new Map([
					[
						parent ?? ROOT_CLAUSE_PARENT,
						arrayMove(siblings, oldIndex, newIndex),
					],
				]),
			),
		);
	};

	const ClauseList = ({
		parentKey,
		prefix,
		depth,
	}: {
		parentKey: string | null;
		prefix: string;
		depth: number;
	}) => {
		const siblings = clauseSiblings(clauses, parentKey);
		if (siblings.length === 0) return null;
		return (
			<SortableContext
				items={siblings.map((clause) => clause.key)}
				strategy={verticalListSortingStrategy}
			>
				<div
					className={
						depth === 0
							? "space-y-1.5"
							: "mt-1.5 space-y-1.5 border-l border-border/70 pl-3"
					}
				>
					{siblings.map((clause, index) => {
						const number = prefix
							? prefix + "." + String(index + 1)
							: String(index + 1);
						return (
							<SortableClauseRow
								key={clause.key}
								clause={clause}
								number={number}
								depth={depth}
								locked={locked}
								onAddSubclause={() => addClause(clause)}
								onDelete={(item) => void removeClause(item)}
							>
								<ClauseList
									parentKey={clause.key}
									prefix={number}
									depth={depth + 1}
								/>
							</SortableClauseRow>
						);
					})}
				</div>
			</SortableContext>
		);
	};

	return (
		<section className="px-1 py-1 [&_.text-sm]:text-xs [&_.text-xs]:text-[11px] [&_button]:text-[11px]">
			<h2 className="text-sm font-semibold text-foreground">
				Agreement clauses
			</h2>
			<p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
				{locked
					? "This agreement is read-only."
					: "Edit headings and paragraphs directly in the document. Party names are protected variables and stay linked to the Parties section."}
			</p>

			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragEnd={reorder}
			>
				<div className="mt-3">
					<ClauseList parentKey={null} prefix="" depth={0} />
				</div>
			</DndContext>

			{!locked && (
				<div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
					<button
						type="button"
						onClick={() => addClause(null)}
						className="rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold text-foreground hover:bg-muted"
					>
						+ Add clause
					</button>
					<AutosaveIndicator status={saveStatus} className="mt-0" />
				</div>
			)}
		</section>
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
	isConsultant,
}: {
	contract: Contract;
	canSignAsConsultant: boolean;
	canSignAsClient: boolean;
	/** Only the consultant may mint a client signing link. */
	isConsultant: boolean;
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
	const [linkOpen, setLinkOpen] = useState(false);

	const termsReady = Boolean(
		contract.service_start_date && contract.service_end_date,
	);
	const counterpartyLabel =
		contract.relationship_kind === "talent_services" ? "Talent" : "Client";

	return (
		<section className="px-1 py-1">
			<h2 className="text-sm font-semibold text-foreground">Signatures</h2>
			<p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
				Type your full name and, if you like, draw your signature. The contract
				becomes <span className="font-semibold">signed</span> only once both
				parties have stamped it.
			</p>

			{/* Remote signing targets the non-Consultant contract position. */}
			{isConsultant && !contract.signed_by_client_at && (
				<button
					type="button"
					onClick={() => setLinkOpen(true)}
					className="mt-2 inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold text-foreground transition hover:bg-muted"
				>
					<Link2 className="h-3 w-3" />
					Send to the {counterpartyLabel.toLowerCase()} to sign
				</button>
			)}

			{!termsReady && (
				<p className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-[11px] leading-4 text-warning-foreground">
					Set the service start date and term before signing.
				</p>
			)}

			<div className="mt-3 grid grid-cols-1 gap-2.5">
				<SignatureBlock
					heading={
						contract.relationship_kind === "talent_services"
							? "For the Consultant hirer"
							: "For the Consultant provider"
					}
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
					heading={`For the ${counterpartyLabel}`}
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

			{linkOpen && (
				<ClientSigningLinkModal
					contract={contract}
					onClose={() => setLinkOpen(false)}
				/>
			)}
		</section>
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
			<div className="rounded-lg border border-success/30 bg-success/10 p-3">
				<div className="flex items-start justify-between gap-2">
					<p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
						{heading}
					</p>
					{canManage && (
						<button
							type="button"
							onClick={onUnsign}
							disabled={isUnsigning}
							className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
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
						compact
						onCommit={onPlacementChange}
						className="mt-1.5"
					/>
				)}
				<p className="mt-1.5 text-xs font-semibold text-foreground">
					{signedName}
				</p>
				<p className="mt-0.5 text-[10px] text-muted-foreground">
					Signed {formatContractDate(signedAt.slice(0, 10))}
				</p>
			</div>
		);
	}

	return (
		<div className="rounded-lg border border-border bg-muted/30 p-3">
			<p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
				{heading}
			</p>
			{canSign ? (
				<SignaturePad
					name={value}
					onNameChange={onChange}
					onSign={onSign}
					isPending={isPending}
					compact
				/>
			) : (
				<p className="mt-1.5 text-[11px] italic text-muted-foreground">
					Awaiting signature
				</p>
			)}
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

/**
 * Per-page initials, captured once and applied to every page.
 *
 * Adobe Sign's model: the signer marks once and the mark is stamped on each
 * page, because initialling a twelve-page agreement is one decision rather than
 * twelve. The seat is taken from the viewer's own contract position — nobody can
 * initial on another party's behalf.
 */
function PageInitialsPanel({
	contract,
	pageCount,
	viewerPosition,
	viewerName,
	onSaved,
}: {
	contract: Contract;
	pageCount: number;
	viewerPosition: "hirer" | "provider" | null;
	viewerName: string | null;
	onSaved: () => void;
}) {
	const toast = useToast();
	const [saving, setSaving] = useState(false);
	const mine = contract.page_initials.filter(
		(mark) => mark.position === viewerPosition,
	);
	const terminal =
		contract.status === "ended" || contract.status === "cancelled";

	if (!viewerPosition) {
		return (
			<section className="border-b border-border px-4 py-4">
				<h3 className="text-sm font-semibold text-foreground">Page initials</h3>
				<p className="mt-1 text-xs text-muted-foreground">
					Only a named party on this agreement can initial its pages.
				</p>
			</section>
		);
	}

	const apply = async (captured: CapturedInitials) => {
		setSaving(true);
		try {
			await contractService.saveInitials(contract.id, {
				position: viewerPosition,
				method: captured.method,
				pages: Array.from({ length: Math.max(1, pageCount) }, (_, i) => i),
				initials_text: captured.text ?? undefined,
				image_png: captured.png,
			});
			toast.success(
				`Initialled ${pageCount} ${pageCount === 1 ? "page" : "pages"}`,
			);
			onSaved();
		} catch (error) {
			toast.error((error as Error).message);
		} finally {
			setSaving(false);
		}
	};

	return (
		<section className="border-b border-border px-4 py-4">
			<h3 className="text-sm font-semibold text-foreground">Page initials</h3>
			<p className="mt-1 mb-3 text-xs text-muted-foreground">
				Initial once and it is stamped on every page — the mark that shows each
				page of this agreement was seen, not just the last one.
			</p>
			{mine.length > 0 ? (
				<div className="rounded-lg border border-success/30 bg-success/5 p-3">
					<p className="text-xs font-medium text-success-foreground">
						{mine.length} of {Math.max(1, pageCount)} pages initialled
					</p>
					{mine[0]?.initials_text && (
						<p className="mt-0.5 text-[11px] text-muted-foreground">
							Typed “{mine[0].initials_text}”
						</p>
					)}
				</div>
			) : null}
			{!terminal && (
				<div className={mine.length > 0 ? "mt-3" : ""}>
					<InitialsPad
						defaultText={initialsFromName(viewerName)}
						onCapture={(captured) => void apply(captured)}
						disabled={saving}
					/>
				</div>
			)}
		</section>
	);
}
