import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	FileStack,
	FileUp,
	Loader2,
	Plus,
	Sparkles,
	Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	AppEmptyState,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { useToast } from "@/hooks/useToast";
import {
	DOC_TYPE_LABELS,
	type IntakeBatch,
	type IntakeDocument,
	type IntakeRelationship,
	intakeService,
	type ReplicateResult,
} from "@/services/intake.service";
import { getTeam, updateTeam } from "@/services/teams.service";
import { IntakeReviewPanel } from "./IntakeReviewPanel";
import {
	currencyOptions,
	currencyQuestionText,
	heldAgreementLabel,
	importerSideHint,
	tradingNameAction,
	withTradingName,
} from "./intakeHints";

const STATUS_LABEL: Record<IntakeDocument["status"], string> = {
	uploaded: "Uploaded",
	classified: "Classified",
	extracted: "Ready to review",
	confirmed: "Confirmed",
	replicated: "Imported",
	failed: "Failed",
	skipped: "Duplicate, skipped",
};

/**
 * Engagements -> Import documents. One sitting to bring running work in from
 * paper: upload, let the AI detect and read, review every record, then create
 * the projects, recorded agreements and invoice history, and invite each
 * counterparty to confirm. docs/13-proposals/document-intake.md
 */
export function IntakePage({ batchId }: { batchId?: string }) {
	const navigate = useNavigate();
	const toast = useToast();
	const batchesQuery = useQuery({
		queryKey: ["intake", "batches"],
		queryFn: () => intakeService.listBatches(),
		enabled: !batchId,
	});
	const createMutation = useMutation({
		mutationFn: () => intakeService.createBatch(),
		onSuccess: (batch) =>
			void navigate({
				to: "/engagements/intake",
				search: { batch: batch.id },
			}),
		onError: (error: Error) => toast.error(error.message),
	});

	return (
		<div className="min-h-full px-5 pb-10 md:px-8">
			<div className="mx-auto w-full max-w-6xl pt-5">
				<p className="text-xs text-muted-foreground">
					<Link to="/engagements" className="hover:underline">
						Engagements
					</Link>{" "}
					/ Import documents
				</p>
				<div className="mt-2 flex flex-wrap items-center justify-between gap-3">
					<h1 className="text-2xl font-bold tracking-tight text-foreground">
						Import documents
					</h1>
					{!batchId && (
						<button
							type="button"
							onClick={() => createMutation.mutate()}
							disabled={createMutation.isPending}
							className="app-cta inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
						>
							<Plus className="h-4 w-4" /> Start an import
						</button>
					)}
				</div>
				<p className="mt-1 max-w-3xl text-sm text-muted-foreground">
					Upload the signed contracts, amendments, invoices and receipts behind
					work that started outside Proyekto. The AI splits, classifies and
					reads them; you confirm every record before anything is created. Each
					agreement is recorded as signed outside Proyekto and only takes effect
					when the other party confirms it matches.
				</p>
				<div className="mt-6">
					{batchId ? (
						<BatchView batchId={batchId} />
					) : batchesQuery.isPending ? (
						<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
					) : (batchesQuery.data ?? []).length === 0 ? (
						<AppEmptyState
							icon={FileStack}
							title="No imports yet"
							description="Start an import to bring a running engagement in from paper."
						/>
					) : (
						<AppSurfaceCard className="divide-y divide-border">
							{(batchesQuery.data ?? []).map((batch) => (
								<Link
									key={batch.id}
									to="/engagements/intake"
									search={{ batch: batch.id }}
									className="flex items-center justify-between px-4 py-3 text-sm hover:bg-muted"
								>
									<span>
										Import of {new Date(batch.created_at).toLocaleDateString()}
									</span>
									<span className="text-xs text-muted-foreground">
										{batch.status === "replicated" ? "Imported" : "Open"}
									</span>
								</Link>
							))}
						</AppSurfaceCard>
					)}
				</div>
			</div>
		</div>
	);
}

function BatchView({ batchId }: { batchId: string }) {
	const qc = useQueryClient();
	const toast = useToast();
	const fileInput = useRef<HTMLInputElement>(null);
	const [reviewing, setReviewing] = useState<string | null>(null);
	const batchQuery = useQuery({
		queryKey: ["intake", "batch", batchId],
		queryFn: () => intakeService.getBatch(batchId),
	});
	const invalidate = () =>
		void qc.invalidateQueries({ queryKey: ["intake", "batch", batchId] });
	const onError = (error: Error) => toast.error(error.message);

	const uploadMutation = useMutation({
		mutationFn: (files: File[]) => intakeService.upload(batchId, files),
		onSuccess: (rows) => {
			invalidate();
			const skipped = rows.filter((row) => row.status === "skipped").length;
			toast.success(
				skipped
					? `${rows.length - skipped} uploaded, ${skipped} already imported`
					: `${rows.length} uploaded`,
			);
		},
		onError,
	});
	const classifyMutation = useMutation({
		mutationFn: (id: string) => intakeService.classify(id),
		onSuccess: invalidate,
		onError,
	});
	const extractMutation = useMutation({
		mutationFn: (id: string) => intakeService.extract(id),
		onSuccess: invalidate,
		onError,
	});
	const groupMutation = useMutation({
		mutationFn: () => intakeService.group(batchId),
		onSuccess: invalidate,
		onError,
	});
	/** Detect and read everything still waiting, one file at a time. */
	const readAllMutation = useMutation({
		mutationFn: async (documents: IntakeDocument[]) => {
			for (const doc of documents.filter((d) => d.status === "uploaded")) {
				await intakeService.classify(doc.id);
			}
			const fresh = await intakeService.getBatch(batchId);
			for (const doc of (fresh.documents ?? []).filter(
				(d) => d.status === "classified",
			)) {
				await intakeService.extract(doc.id);
			}
		},
		onSuccess: invalidate,
		onError: (error: Error) => {
			invalidate();
			onError(error);
		},
	});

	if (batchQuery.isPending) {
		return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
	}
	if (batchQuery.isError) {
		return (
			<p className="text-sm text-destructive">{batchQuery.error.message}</p>
		);
	}
	const batch = batchQuery.data as IntakeBatch;
	const documents = batch.documents ?? [];
	const relationships = batch.relationships ?? [];
	const reviewDoc = documents.find((doc) => doc.id === reviewing) ?? null;
	const pendingReads = documents.some(
		(doc) => doc.status === "uploaded" || doc.status === "classified",
	);

	return (
		<div className="space-y-6">
			<AppSurfaceCard className="p-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<h2 className="text-base font-semibold text-foreground">
							1. Upload
						</h2>
						<p className="text-xs text-muted-foreground">
							PDFs, phone photos and scans; many at once. {batch.pages ?? 0}{" "}
							page{batch.pages === 1 ? "" : "s"} so far. English only for now,
							typed or handwritten.
						</p>
					</div>
					<div className="flex gap-2">
						<input
							ref={fileInput}
							type="file"
							multiple
							accept="application/pdf,image/jpeg,image/png,image/webp"
							className="hidden"
							onChange={(event) => {
								const files = [...(event.target.files ?? [])];
								if (files.length) uploadMutation.mutate(files);
								event.target.value = "";
							}}
						/>
						<button
							type="button"
							onClick={() => fileInput.current?.click()}
							disabled={uploadMutation.isPending || batch.status !== "open"}
							className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50"
						>
							{uploadMutation.isPending ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<FileUp className="h-4 w-4" />
							)}
							Add files
						</button>
						<button
							type="button"
							onClick={() => readAllMutation.mutate(documents)}
							disabled={!pendingReads || readAllMutation.isPending}
							className="app-cta inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
						>
							{readAllMutation.isPending ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Sparkles className="h-4 w-4" />
							)}
							Detect and read
						</button>
					</div>
				</div>
			</AppSurfaceCard>

			<AppSurfaceCard className="overflow-hidden">
				<div className="flex items-center justify-between border-b border-border px-4 py-3">
					<h2 className="text-base font-semibold text-foreground">
						2. Review each document
					</h2>
					<span className="text-xs text-muted-foreground">
						{
							documents.filter(
								(d) => d.status === "confirmed" || d.status === "replicated",
							).length
						}{" "}
						of {documents.filter((d) => d.status !== "skipped").length}{" "}
						confirmed
					</span>
				</div>
				{documents.length === 0 ? (
					<p className="px-4 py-8 text-center text-sm text-muted-foreground">
						No files yet.
					</p>
				) : (
					<ul className="divide-y divide-border">
						{documents.map((doc) => (
							<li
								key={doc.id}
								className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
							>
								<div className="min-w-0">
									<p className="truncate font-medium text-foreground">
										{doc.doc_type
											? DOC_TYPE_LABELS[doc.doc_type]
											: "Not classified"}{" "}
										<span className="font-normal text-muted-foreground">
											· {doc.file_name}
											{doc.page_count > 1
												? ` · p. ${doc.page_start}-${doc.page_end}`
												: ""}
										</span>
									</p>
									{doc.flags.length > 0 && (
										<p className="truncate text-xs text-amber-700 dark:text-amber-300">
											{doc.flags[0]}
										</p>
									)}
								</div>
								<div className="flex items-center gap-2">
									<span className="text-xs text-muted-foreground">
										{STATUS_LABEL[doc.status]}
									</span>
									{doc.status === "uploaded" && (
										<button
											type="button"
											onClick={() => classifyMutation.mutate(doc.id)}
											disabled={classifyMutation.isPending}
											className="rounded-md border border-border px-2 py-1 text-xs font-semibold hover:bg-muted"
										>
											Detect
										</button>
									)}
									{doc.status === "classified" && (
										<button
											type="button"
											onClick={() => extractMutation.mutate(doc.id)}
											disabled={extractMutation.isPending}
											className="rounded-md border border-border px-2 py-1 text-xs font-semibold hover:bg-muted"
										>
											Read
										</button>
									)}
									{doc.status !== "uploaded" && doc.status !== "skipped" && (
										<button
											type="button"
											onClick={() => setReviewing(doc.id)}
											className="rounded-md border border-primary/40 px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10"
										>
											Review
										</button>
									)}
								</div>
							</li>
						))}
					</ul>
				)}
			</AppSurfaceCard>

			<AppSurfaceCard className="p-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<h2 className="text-base font-semibold text-foreground">
							3. Relationships
						</h2>
						<p className="text-xs text-muted-foreground">
							Documents grouped by the other party. Confirm who they are and
							which project the work belongs to, then import.
						</p>
					</div>
					<button
						type="button"
						onClick={() => groupMutation.mutate()}
						disabled={groupMutation.isPending}
						className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50"
					>
						<Users className="h-4 w-4" /> Group documents
					</button>
				</div>
				<div className="mt-4 space-y-3">
					{relationships.map((relationship) => (
						<RelationshipCard
							key={relationship.id}
							relationship={relationship}
							documents={documents.filter(
								(doc) => doc.relationship_id === relationship.id,
							)}
							onChanged={invalidate}
						/>
					))}
					{relationships.length === 0 && (
						<p className="text-sm text-muted-foreground">
							Group the documents once they are read.
						</p>
					)}
				</div>
			</AppSurfaceCard>

			{reviewDoc && (
				<IntakeReviewPanel
					document={reviewDoc}
					invoices={documents.filter(
						(doc) =>
							doc.doc_type === "invoice" &&
							doc.relationship_id === reviewDoc.relationship_id,
					)}
					onClose={() => {
						setReviewing(null);
						invalidate();
					}}
				/>
			)}
		</div>
	);
}

function RelationshipCard({
	relationship,
	documents,
	onChanged,
}: {
	relationship: IntakeRelationship;
	documents: IntakeDocument[];
	onChanged: () => void;
}) {
	const toast = useToast();
	const [name, setName] = useState(relationship.counterparty_name ?? "");
	const [email, setEmail] = useState(relationship.counterparty_email ?? "");
	const [projectTitle, setProjectTitle] = useState(
		relationship.project_title ?? "",
	);
	const [kind, setKind] = useState(relationship.relationship_kind);
	const [result, setResult] = useState<ReplicateResult | null>(null);
	// Decision 2026-10-01: the project's currency is never changed for the
	// person. A new project preselects the documents' currency, and the choice
	// still has to be confirmed.
	const currencyQuestion = relationship.currency_question ?? null;
	const [currencyPick, setCurrencyPick] = useState<string | null>(
		currencyQuestion?.suggested ?? null,
	);
	const [currencyConfirmed, setCurrencyConfirmed] = useState(false);
	const questionKey = currencyQuestion
		? `${currencyQuestion.project_currency}:${currencyQuestion.document_currencies.join(",")}`
		: "";
	const suggestedCurrency = currencyQuestion?.suggested ?? null;
	// A different question (documents confirmed since) starts a fresh choice.
	useEffect(() => {
		setCurrencyPick(suggestedCurrency);
		setCurrencyConfirmed(false);
	}, [questionKey]);
	const currencyReady =
		!currencyQuestion ||
		(Boolean(currencyPick) &&
			(!currencyQuestion.project_is_new || currencyConfirmed));
	const saveMutation = useMutation({
		mutationFn: (confirm: boolean) =>
			intakeService.updateRelationship(relationship.id, {
				counterparty_name: name.trim() || undefined,
				counterparty_email: email || undefined,
				project_title: projectTitle || undefined,
				relationship_kind: kind,
				confirm,
			}),
		onSuccess: onChanged,
		onError: (error: Error) => toast.error(error.message),
	});
	const replicateMutation = useMutation({
		mutationFn: async () => {
			// Unsaved edits (the other party's name above all) are what the
			// records are created with, so they are saved first.
			const dirty =
				name.trim() !== (relationship.counterparty_name ?? "") ||
				email !== (relationship.counterparty_email ?? "") ||
				projectTitle !== (relationship.project_title ?? "") ||
				kind !== relationship.relationship_kind;
			if (dirty) await saveMutation.mutateAsync(false);
			return intakeService.replicate(
				relationship.id,
				currencyQuestion && currencyPick
					? { project_currency: currencyPick }
					: {},
			);
		},
		onSuccess: (next) => {
			setResult(next);
			onChanged();
			const failed = next.outcomes.filter((o) => o.error).length;
			if (failed) toast.error(`${failed} document(s) need attention`);
			else if (next.pending_agreement)
				toast.success(
					`Imported. The agreement waits for ${next.pending_agreement.name ?? next.pending_agreement.email} to join; they have been invited.`,
				);
			else
				toast.success("Imported. The other party has been asked to confirm.");
		},
		onError: (error: Error) => toast.error(error.message),
	});
	const confirmed = documents.filter(
		(doc) => doc.status === "confirmed",
	).length;
	const imported = documents.filter(
		(doc) => doc.status === "replicated",
	).length;
	const heldAgreement = relationship.replicated.pending_agreement ?? null;
	const partyHint = importerSideHint(relationship.party_check);
	const aliasAction = tradingNameAction(relationship.party_check);
	const aliasMutation = useMutation({
		mutationFn: async (action: NonNullable<typeof aliasAction>) => {
			// Read the current list first so another alias is never dropped.
			const team = await getTeam(action.teamId);
			return updateTeam(action.teamId, {
				trading_names: withTradingName(team.trading_names ?? [], action.name),
			});
		},
		onSuccess: (_team, action) => {
			toast.success(`"${action.name}" saved as a trading name.`);
			onChanged();
		},
		onError: (error: Error) => toast.error(error.message),
	});
	const locked = relationship.status === "replicated";
	return (
		<div className="rounded-lg border border-border p-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-sm font-semibold text-foreground">
					{name.trim() || relationship.counterparty_name || "Unnamed party"}
					<span className="ml-2 text-xs font-normal text-muted-foreground">
						{documents.length} document{documents.length === 1 ? "" : "s"},{" "}
						{confirmed} confirmed
						{imported ? `, ${imported} imported` : ""}
					</span>
				</p>
				<span className="text-xs text-muted-foreground">
					{relationship.status === "replicated"
						? "Imported"
						: relationship.status === "confirmed"
							? "Confirmed"
							: "Proposed"}
				</span>
			</div>
			<label className="mt-2 block text-[11px] font-medium text-muted-foreground">
				The other party
				<input
					value={name}
					disabled={locked}
					onChange={(event) => setName(event.target.value)}
					placeholder="Their name, as it should appear on the records"
					aria-label="The other party's name"
					className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
				/>
			</label>
			{!locked && partyHint && (
				<div className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
					<p>{partyHint}</p>
					{aliasAction && (
						<button
							type="button"
							disabled={aliasMutation.isPending}
							onClick={() => aliasMutation.mutate(aliasAction)}
							className="mt-1 inline-flex items-center gap-1 rounded-md border border-amber-300 px-2 py-0.5 font-medium hover:bg-amber-50 disabled:opacity-50 dark:border-amber-700 dark:hover:bg-amber-950"
						>
							{aliasMutation.isPending && (
								<Loader2 className="h-3 w-3 animate-spin" />
							)}
							{aliasAction.label}
						</button>
					)}
				</div>
			)}
			<div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
				<input
					value={email}
					disabled={locked}
					onChange={(event) => setEmail(event.target.value)}
					placeholder="Their Proyekto email"
					className="h-8 rounded-md border border-input bg-background px-2"
				/>
				<input
					value={projectTitle}
					disabled={locked || Boolean(relationship.project_id)}
					onChange={(event) => setProjectTitle(event.target.value)}
					placeholder="New project title"
					className="h-8 rounded-md border border-input bg-background px-2"
				/>
				<select
					value={kind}
					disabled={locked}
					onChange={(event) =>
						setKind(
							event.target.value as IntakeRelationship["relationship_kind"],
						)
					}
					className="h-8 rounded-md border border-input bg-background px-2"
				>
					<option value="client_services">They are my client</option>
					<option value="talent_services">They are my talent</option>
				</select>
			</div>
			{email &&
				!relationship.counterparty_user_id &&
				relationship.counterparty_email === email && (
					<p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
						No Proyekto account uses this email yet. Invoices and payments can
						still be imported; the agreement is recorded once they sign up.
					</p>
				)}
			{!locked && currencyQuestion && (
				<fieldset className="mt-2 rounded-md border border-amber-300/60 bg-amber-50/60 p-2 text-xs dark:border-amber-500/40 dark:bg-amber-500/10">
					<legend className="px-1 font-semibold text-foreground">
						Project currency
					</legend>
					<p className="text-foreground">
						{currencyQuestionText(
							currencyQuestion,
							documents
								.filter((doc) => doc.status === "confirmed")
								.every(
									(doc) =>
										doc.doc_type !== "contract" && doc.doc_type !== "amendment",
								),
						)}
					</p>
					<div className="mt-1.5 flex flex-wrap gap-3">
						{currencyOptions(currencyQuestion).map((option) => (
							<label
								key={option.value}
								className="inline-flex items-center gap-1.5"
							>
								<input
									type="radio"
									name={`currency-${relationship.id}`}
									value={option.value}
									checked={currencyPick === option.value}
									onChange={() => {
										setCurrencyPick(option.value);
										setCurrencyConfirmed(false);
									}}
								/>
								{option.label}
							</label>
						))}
					</div>
					{currencyQuestion.project_is_new && currencyPick && (
						<label className="mt-1.5 inline-flex items-center gap-1.5 font-medium text-foreground">
							<input
								type="checkbox"
								checked={currencyConfirmed}
								onChange={(event) => setCurrencyConfirmed(event.target.checked)}
							/>
							Create the new project in {currencyPick}
						</label>
					)}
				</fieldset>
			)}
			{!locked && (
				<div className="mt-2 flex gap-2">
					<button
						type="button"
						onClick={() => saveMutation.mutate(true)}
						disabled={saveMutation.isPending}
						className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold hover:bg-muted"
					>
						{relationship.status === "proposed" ? "Confirm group" : "Save"}
					</button>
					<button
						type="button"
						onClick={() => replicateMutation.mutate()}
						disabled={
							relationship.status === "proposed" ||
							confirmed === 0 ||
							!currencyReady ||
							replicateMutation.isPending
						}
						className="app-cta inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
					>
						{replicateMutation.isPending && (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						)}
						Import {confirmed} confirmed
					</button>
				</div>
			)}
			{heldAgreement && !relationship.replicated.contract_id && (
				<p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">
					{heldAgreementLabel({
						...heldAgreement,
						// The name as it now stands on the page (the paper's, or the edit).
						name: relationship.counterparty_name ?? heldAgreement.name,
					})}
				</p>
			)}
			{relationship.replicated.contract_id && (
				<Link
					to="/engagements/contracts/$contractId"
					params={{ contractId: relationship.replicated.contract_id }}
					search={{ section: "signatures" }}
					className="mt-2 inline-block text-xs font-semibold text-primary hover:underline"
				>
					Open the recorded agreement
				</Link>
			)}
			{result && result.outcomes.some((o) => o.error) && (
				<ul className="mt-2 space-y-1 text-[11px] text-destructive">
					{result.outcomes
						.filter((o) => o.error)
						.map((o) => (
							<li key={o.document_id}>
								{documents.find((d) => d.id === o.document_id)?.file_name ??
									"A document"}
								: {o.error}
							</li>
						))}
				</ul>
			)}
		</div>
	);
}
