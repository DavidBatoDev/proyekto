import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowLeft,
	ChevronLeft,
	ChevronRight,
	FileText,
	Loader2,
	Sparkles,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
	type CanvasSnip,
	DocumentCanvas,
	type SnipRect,
} from "@/components/finance/imports/DocumentCanvas";
import {
	type FieldEvidence,
	SnipField,
} from "@/components/finance/imports/SnipField";
import { useToast } from "@/hooks/useToast";
import { CURRENCY_CODE_OPTIONS } from "@/lib/currency";
import {
	type DocumentSnip,
	financeImportsService,
} from "@/services/financeImports.service";

/**
 * The import workspace: the source document on the left, the record on the right.
 *
 * A full-page document like the contract editor, and a sibling of the finance
 * portfolio rather than a child of it — the tab bar and filter toolbar belong to
 * the section, not to a workspace that is only ever about one file.
 *
 * The rule the whole screen enforces: a figure is either snipped from the
 * document, or typed by a person who saw it. The reader's suggestions arrive
 * labelled and unconfirmed, and committing them is a deliberate act.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/imports/$documentId",
)({
	component: ImportWorkspace,
});

interface FieldState {
	value: string;
	evidence?: FieldEvidence;
	rect?: SnipRect;
	suggested?: boolean;
}

const EMPTY_FIELD: FieldState = { value: "" };

/** The figures an invoice is recorded from. */
const INVOICE_FIELDS = [
	{ key: "number", label: "Invoice number", required: true },
	{ key: "issue_date", label: "Issue date", type: "date", required: true },
	{ key: "due_date", label: "Due date", type: "date" },
	{ key: "total", label: "Total billed", type: "number", required: true },
] as const;

/** Money that already landed, in the currency it landed in. */
const PAYMENT_FIELDS = [
	{ key: "payment_date", label: "Date received", type: "date" },
	{ key: "settled_amount", label: "Amount received", type: "number" },
	{ key: "reference", label: "Bank reference" },
] as const;

function parseAmount(raw: string): string {
	const cleaned = raw.replace(/[^0-9.,]/g, "").replace(/,/g, "");
	const value = Number(cleaned);
	return Number.isFinite(value) && value > 0 ? String(value) : "";
}

/**
 * Dates on invoices are written for people ("August 15, 2026", "SEP 14, 2026"),
 * so a snip is parsed rather than trusted. What will not parse stays in the box
 * as the raw text, where it is obviously wrong and can be fixed.
 */
function parseDate(raw: string): string {
	const match = /([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/.exec(raw);
	const candidate = match ? `${match[1]} ${match[2]}, ${match[3]}` : raw;
	const parsed = new Date(candidate);
	if (Number.isNaN(parsed.getTime())) return raw.trim();
	return parsed.toISOString().slice(0, 10);
}

function ImportWorkspace() {
	const { documentId } = Route.useParams();
	const navigate = useNavigate();
	const toast = useToast();
	const qc = useQueryClient();

	const [page, setPage] = useState(1);
	const [pageCount, setPageCount] = useState(1);
	const [activeField, setActiveField] = useState<string | null>(null);
	const [fields, setFields] = useState<Record<string, FieldState>>({});
	const [currency, setCurrency] = useState("AUD");
	const [settledCurrency, setSettledCurrency] = useState("PHP");
	const [recordPayment, setRecordPayment] = useState(true);
	const [proofDocumentId, setProofDocumentId] = useState("");

	const documentQuery = useQuery({
		queryKey: ["finance-import", "document", documentId],
		queryFn: () => financeImportsService.get(documentId),
	});
	const bytesQuery = useQuery({
		queryKey: ["finance-import", "file", documentId],
		queryFn: () => financeImportsService.file(documentId),
		staleTime: 5 * 60_000,
	});
	const document = documentQuery.data;

	const proofsQuery = useQuery({
		queryKey: ["finance-import", "proofs", document?.project_id],
		queryFn: () =>
			financeImportsService.list(document?.project_id ?? "", "payment_proof"),
		enabled: Boolean(document?.project_id),
	});

	const field = (key: string): FieldState => fields[key] ?? EMPTY_FIELD;
	const setField = (key: string, patch: Partial<FieldState>) =>
		setFields((previous) => ({
			...previous,
			[key]: { ...(previous[key] ?? EMPTY_FIELD), ...patch },
		}));

	const readMutation = useMutation({
		mutationFn: () => financeImportsService.read(documentId),
		onSuccess: (row) => {
			void qc.invalidateQueries({
				queryKey: ["finance-import", "document", documentId],
			});
			const read = row.extraction?.fields;
			if (!read) {
				toast.info("Nothing could be pre-filled. Snip the fields instead.");
				return;
			}
			// Suggestions never overwrite a value that was snipped or typed: the
			// human-established figure outranks the model's every time.
			const apply = (key: string, value: string | null | undefined) => {
				if (!value) return;
				setFields((previous) => {
					const existing = previous[key];
					if (existing?.value) return previous;
					return { ...previous, [key]: { value, suggested: true } };
				});
			};
			apply("number", read.number?.value);
			apply("issue_date", read.issue_date?.value);
			apply("due_date", read.due_date?.value);
			apply("total", read.total?.value);
			if (read.currency?.value) setCurrency(read.currency.value);
			toast.success("Draft filled in. Snip each figure to evidence it.");
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const importMutation = useMutation({
		mutationFn: () => {
			if (!document) throw new Error("Document not loaded");
			const snips: DocumentSnip[] = Object.entries(fields)
				.filter(([, state]) => state.rect && state.evidence)
				.map(([key, state]) => ({
					field_key: key,
					document_id: documentId,
					page: state.evidence?.page ?? 1,
					rect: state.rect as SnipRect,
					value_text: state.evidence?.value_text,
					origin: "snip" as const,
				}));

			const total = Number(field("total").value);
			const settled = Number(field("settled_amount").value);
			return financeImportsService.importInvoice({
				project_id: document.project_id,
				source_document_id: documentId,
				number: field("number").value.trim(),
				currency,
				total,
				issue_date: field("issue_date").value,
				due_date: field("due_date").value || undefined,
				snips: snips.filter((snip) => !snip.field_key.startsWith("settled")),
				payments:
					recordPayment && field("payment_date").value
						? [
								{
									// What the payment settles OF THE INVOICE. A full
									// settlement clears the invoice; the received amount is
									// recorded separately, in the money that arrived.
									amount: total,
									payment_date: field("payment_date").value,
									reference: field("reference").value || undefined,
									payment_method: "Bank transfer",
									settled_currency: settled ? settledCurrency : undefined,
									settled_amount: settled || undefined,
									proof_document_id: proofDocumentId || undefined,
								},
							]
						: undefined,
			});
		},
		onSuccess: () => {
			toast.success("Recorded. It now counts in the finance overview.");
			void qc.invalidateQueries({ queryKey: ["finance"] });
			void qc.invalidateQueries({ queryKey: ["finance-import"] });
			void navigate({
				to: "/engagements/finance/imports",
				search: { projectId: document?.project_id },
			});
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const onSnip = useCallback(
		(rect: SnipRect, text: string) => {
			if (!activeField) return;
			const raw = text.trim();
			const value =
				activeField === "total" || activeField === "settled_amount"
					? parseAmount(raw) || raw
					: activeField.endsWith("_date")
						? parseDate(raw)
						: raw;
			setFields((previous) => ({
				...previous,
				[activeField]: {
					value: value || previous[activeField]?.value || "",
					rect,
					evidence: { page, value_text: raw },
					suggested: false,
				},
			}));
			setActiveField(null);
		},
		[activeField, page],
	);

	const canvasSnips = useMemo<CanvasSnip[]>(
		() =>
			Object.entries(fields)
				.filter(([, state]) => state.rect && state.evidence)
				.map(([key, state]) => ({
					field_key: key,
					page: state.evidence?.page ?? 1,
					rect: state.rect as SnipRect,
				})),
		[fields],
	);

	const evidencedCount = canvasSnips.length;
	const ready =
		Boolean(field("number").value) &&
		Boolean(field("issue_date").value) &&
		Number(field("total").value) > 0;

	const impliedRate = (() => {
		const total = Number(field("total").value);
		const settled = Number(field("settled_amount").value);
		if (!total || !settled || settledCurrency === currency) return null;
		return (settled / total).toFixed(4);
	})();

	if (documentQuery.isPending) {
		return (
			<div className="flex min-h-full justify-center py-24">
				<Loader2 className="h-6 w-6 animate-spin text-primary" />
			</div>
		);
	}

	if (documentQuery.isError || !document) {
		return (
			<div className="mx-auto min-h-full max-w-3xl px-5 py-10">
				<p className="text-sm text-muted-foreground">
					That document is not available.
				</p>
			</div>
		);
	}

	return (
		<div className="min-h-full px-5 py-4 md:px-8 md:py-5">
			<div className="mx-auto w-full max-w-[1500px]">
				<header className="mb-4 flex flex-wrap items-center justify-between gap-3">
					<div className="flex min-w-0 items-center gap-3">
						<Link
							to="/engagements/finance/imports"
							search={{ projectId: document.project_id }}
							className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
						>
							<ArrowLeft className="h-4 w-4" /> Imports
						</Link>
						<span className="text-border">/</span>
						<span className="flex min-w-0 items-center gap-2">
							<FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
							<span className="truncate text-sm font-semibold text-foreground">
								{document.file_name}
							</span>
						</span>
					</div>

					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => readMutation.mutate()}
							disabled={readMutation.isPending}
							className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
						>
							{readMutation.isPending ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<Sparkles className="h-3.5 w-3.5" />
							)}
							Read the document
						</button>
						<button
							type="button"
							onClick={() => importMutation.mutate()}
							disabled={!ready || importMutation.isPending}
							className="app-cta inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
						>
							{importMutation.isPending && (
								<Loader2 className="h-4 w-4 animate-spin" />
							)}
							Record invoice
						</button>
					</div>
				</header>

				<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
					<section>
						<DocumentCanvas
							bytes={bytesQuery.data ?? null}
							mimeType={document.mime_type}
							page={page}
							snips={canvasSnips}
							activeField={activeField}
							onPageCount={setPageCount}
							onSnip={onSnip}
						/>
						{pageCount > 1 && (
							<div className="mt-2 flex items-center justify-center gap-3 text-sm">
								<button
									type="button"
									onClick={() => setPage((current) => Math.max(1, current - 1))}
									disabled={page <= 1}
									className="rounded-md border border-border p-1 disabled:opacity-40"
								>
									<ChevronLeft className="h-4 w-4" />
								</button>
								<span className="text-muted-foreground">
									Page {page} of {pageCount}
								</span>
								<button
									type="button"
									onClick={() =>
										setPage((current) => Math.min(pageCount, current + 1))
									}
									disabled={page >= pageCount}
									className="rounded-md border border-border p-1 disabled:opacity-40"
								>
									<ChevronRight className="h-4 w-4" />
								</button>
							</div>
						)}
					</section>

					<aside className="space-y-5">
						<div className="rounded-xl border border-border bg-card p-4">
							<h2 className="text-sm font-semibold text-foreground">Invoice</h2>
							<p className="mb-3 mt-0.5 text-xs text-muted-foreground">
								{evidencedCount === 0
									? "Nothing snipped yet — pick a field, then drag over it in the document."
									: `${evidencedCount} figure${evidencedCount === 1 ? "" : "s"} snipped from this document.`}
							</p>

							<div className="space-y-3">
								{INVOICE_FIELDS.map((entry) => (
									<SnipField
										key={entry.key}
										label={entry.label}
										fieldKey={entry.key}
										type={"type" in entry ? entry.type : "text"}
										required={"required" in entry ? entry.required : false}
										value={field(entry.key).value}
										evidence={field(entry.key).evidence}
										suggested={field(entry.key).suggested}
										activeField={activeField}
										onArm={setActiveField}
										onChange={(value) =>
											setField(entry.key, { value, suggested: false })
										}
									/>
								))}

								<div>
									<label
										htmlFor="import-currency"
										className="mb-1 block text-xs font-medium text-muted-foreground"
									>
										Billed in
									</label>
									<select
										id="import-currency"
										value={currency}
										onChange={(event) => setCurrency(event.target.value)}
										className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
									>
										{CURRENCY_CODE_OPTIONS.map((code) => (
											<option key={code} value={code}>
												{code}
											</option>
										))}
									</select>
								</div>
							</div>
						</div>

						<div className="rounded-xl border border-border bg-card p-4">
							<label className="flex items-center gap-2 text-sm font-semibold text-foreground">
								<input
									type="checkbox"
									checked={recordPayment}
									onChange={(event) => setRecordPayment(event.target.checked)}
									className="h-4 w-4 rounded border-input"
								/>
								Payment already received
							</label>
							<p className="mb-3 mt-0.5 text-xs text-muted-foreground">
								Record what actually landed. The rate is derived from the two
								amounts, so the invoice keeps its own face value.
							</p>

							{recordPayment && (
								<div className="space-y-3">
									{PAYMENT_FIELDS.map((entry) => (
										<SnipField
											key={entry.key}
											label={entry.label}
											fieldKey={entry.key}
											type={"type" in entry ? entry.type : "text"}
											value={field(entry.key).value}
											evidence={field(entry.key).evidence}
											activeField={activeField}
											onArm={setActiveField}
											onChange={(value) => setField(entry.key, { value })}
										/>
									))}

									<div>
										<label
											htmlFor="settled-currency"
											className="mb-1 block text-xs font-medium text-muted-foreground"
										>
											Received in
										</label>
										<select
											id="settled-currency"
											value={settledCurrency}
											onChange={(event) =>
												setSettledCurrency(event.target.value)
											}
											className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
										>
											{CURRENCY_CODE_OPTIONS.map((code) => (
												<option key={code} value={code}>
													{code}
												</option>
											))}
										</select>
										{impliedRate && (
											<p className="mt-1 text-[11px] text-muted-foreground">
												{impliedRate} {settledCurrency} per {currency} on this
												transfer
											</p>
										)}
									</div>

									<div>
										<label
											htmlFor="proof-document"
											className="mb-1 block text-xs font-medium text-muted-foreground"
										>
											Proof of payment
										</label>
										<select
											id="proof-document"
											value={proofDocumentId}
											onChange={(event) =>
												setProofDocumentId(event.target.value)
											}
											className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
										>
											<option value="">No document attached</option>
											{(proofsQuery.data ?? []).map((proof) => (
												<option key={proof.id} value={proof.id}>
													{proof.file_name}
												</option>
											))}
										</select>
										<p className="mt-1 text-[11px] text-muted-foreground">
											Upload bank records on the Imports tab to list them here.
										</p>
									</div>
								</div>
							)}
						</div>
					</aside>
				</div>
			</div>
		</div>
	);
}
