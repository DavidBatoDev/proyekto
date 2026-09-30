import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	Check,
	ChevronLeft,
	ChevronRight,
	Loader2,
	PenLine,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ModalPortal } from "@/components/common/ModalPortal";
import {
	type CanvasSnip,
	DocumentCanvas,
	type SnipRect,
} from "@/components/finance/imports/DocumentCanvas";
import { useToast } from "@/hooks/useToast";
import {
	DOC_TYPE_LABELS,
	FIELD_LABELS,
	type IntakeClause,
	type IntakeDocType,
	type IntakeDocument,
	intakeService,
	isBlocking,
	type ReviewField,
} from "@/services/intake.service";

/**
 * One document under review: the original on the left, the extracted record
 * on the right. Modelled on DataSnipper: hover a field to see where it was
 * read, pick a field and draw a box to read it from that region, type to fix
 * a value, mark a field "Not in document". Confirm stays disabled while any
 * field is Unsure or Needs input.
 */
export function IntakeReviewPanel({
	document: initial,
	invoices,
	onClose,
}: {
	document: IntakeDocument;
	/** Invoices in the same import, for matching a payment. */
	invoices: IntakeDocument[];
	onClose: () => void;
}) {
	const qc = useQueryClient();
	const toast = useToast();
	const [doc, setDoc] = useState(initial);
	const [page, setPage] = useState(initial.page_start);
	const [pageCount, setPageCount] = useState(initial.page_count);
	const [activeField, setActiveField] = useState<string | null>(null);
	const [hovered, setHovered] = useState<string | null>(null);
	const canvasWrapper = useRef<HTMLDivElement>(null);
	useEffect(() => setDoc(initial), [initial]);

	const bytesQuery = useQuery({
		queryKey: ["intake", "file", doc.id],
		queryFn: () => intakeService.fileBytes(doc.id),
		staleTime: 5 * 60_000,
	});
	const refresh = (next: IntakeDocument) => {
		setDoc(next);
		void qc.invalidateQueries({ queryKey: ["intake", "batch", doc.batch_id] });
	};
	const onError = (error: Error) => toast.error(error.message);

	const fieldMutation = useMutation({
		mutationFn: (patch: Parameters<typeof intakeService.updateField>[1]) =>
			intakeService.updateField(doc.id, patch),
		onSuccess: refresh,
		onError,
	});
	const rereadMutation = useMutation({
		mutationFn: (payload: Parameters<typeof intakeService.reread>[1]) =>
			intakeService.reread(doc.id, payload),
		onSuccess: (next) => {
			refresh(next);
			setActiveField(null);
		},
		onError,
	});
	const docMutation = useMutation({
		mutationFn: (patch: Parameters<typeof intakeService.updateDocument>[1]) =>
			intakeService.updateDocument(doc.id, patch),
		onSuccess: refresh,
		onError,
	});
	const extractMutation = useMutation({
		mutationFn: () => intakeService.extract(doc.id),
		onSuccess: refresh,
		onError,
	});
	const clausesMutation = useMutation({
		mutationFn: (clauses: IntakeClause[]) =>
			intakeService.updateClauses(doc.id, clauses),
		onSuccess: refresh,
		onError,
	});
	const confirmMutation = useMutation({
		mutationFn: () => intakeService.confirm(doc.id),
		onSuccess: (next) => {
			refresh(next);
			toast.success("Document confirmed");
		},
		onError,
	});

	const fields = Object.entries(doc.fields);
	const blocking = fields.filter(([, field]) => isBlocking(field));
	const editable = doc.status !== "replicated" && doc.status !== "confirmed";
	const snips: CanvasSnip[] = fields
		.filter(([, field]) => field.box && field.page)
		.map(([key, field]) => {
			const [x, y, w, h] = field.box as number[];
			return {
				field_key: key,
				page: field.page as number,
				rect: { x, y, w, h },
			};
		})
		.filter((snip) => !hovered || snip.field_key === hovered);

	/**
	 * A drawn box: the PDF's own text under it fills the field when there is
	 * some; otherwise the region is cropped and read again by the model.
	 */
	const onSnip = async (rect: SnipRect, text: string) => {
		if (!activeField) return;
		const box = [rect.x, rect.y, rect.w, rect.h];
		if (text) {
			fieldMutation.mutate({
				field: activeField,
				value: text,
				snip_page: page,
				snip_box: box,
			});
			setActiveField(null);
			return;
		}
		const crop = cropRegion(canvasWrapper.current, rect);
		if (!crop) {
			toast.error("That region could not be read. Type the value instead.");
			return;
		}
		rereadMutation.mutate({
			field: activeField,
			image_data_url: crop,
			page,
			box,
		});
	};

	return (
		<ModalPortal>
			<div className="fixed inset-0 z-80 flex flex-col bg-background">
				<header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4">
					<div className="min-w-0">
						<p className="truncate text-sm font-semibold text-foreground">
							{doc.file_name}
							{doc.page_count > 1
								? ` · pages ${doc.page_start}-${doc.page_end}`
								: ""}
						</p>
						<p className="text-[11px] text-muted-foreground">
							Nothing is created until you confirm. The original stays the
							record of what was signed.
						</p>
					</div>
					<div className="flex items-center gap-2">
						<select
							value={doc.doc_type ?? "other"}
							disabled={!editable}
							onChange={(event) =>
								docMutation.mutate({
									doc_type: event.target.value as IntakeDocType,
								})
							}
							className="h-8 rounded-md border border-input bg-background px-2 text-xs"
							aria-label="Document type"
						>
							{Object.entries(DOC_TYPE_LABELS).map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</select>
						{doc.status === "classified" && (
							<button
								type="button"
								onClick={() => extractMutation.mutate()}
								disabled={extractMutation.isPending}
								className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-semibold hover:bg-muted disabled:opacity-50"
							>
								{extractMutation.isPending && (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								)}
								Read fields
							</button>
						)}
						<button
							type="button"
							onClick={() => confirmMutation.mutate()}
							disabled={
								doc.status !== "extracted" ||
								blocking.length > 0 ||
								confirmMutation.isPending
							}
							title={
								blocking.length > 0
									? `Still to check: ${blocking.map(([key]) => FIELD_LABELS[key] ?? key).join(", ")}`
									: undefined
							}
							className="app-cta inline-flex h-8 items-center gap-1 rounded-md px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
						>
							<Check className="h-3.5 w-3.5" />
							{doc.status === "confirmed" || doc.status === "replicated"
								? "Confirmed"
								: "Confirm"}
						</button>
						<button
							type="button"
							onClick={onClose}
							aria-label="Close"
							className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
						>
							<X className="h-4 w-4" />
						</button>
					</div>
				</header>

				<div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,6fr)_minmax(0,4fr)]">
					<div className="min-h-0 overflow-y-auto bg-muted/40 p-4">
						<div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
							<span>
								{activeField
									? `Draw a box around the ${FIELD_LABELS[activeField] ?? activeField}.`
									: "Pick a field on the right, then draw a box to read it from the page."}
							</span>
							<span className="flex items-center gap-1">
								<button
									type="button"
									onClick={() => setPage((p) => Math.max(1, p - 1))}
									className="rounded p-1 hover:bg-muted"
									aria-label="Previous page"
								>
									<ChevronLeft className="h-4 w-4" />
								</button>
								Page {page} of {pageCount}
								<button
									type="button"
									onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
									className="rounded p-1 hover:bg-muted"
									aria-label="Next page"
								>
									<ChevronRight className="h-4 w-4" />
								</button>
							</span>
						</div>
						<div ref={canvasWrapper}>
							{bytesQuery.isPending ? (
								<div className="flex justify-center py-20">
									<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
								</div>
							) : (
								<DocumentCanvas
									bytes={bytesQuery.data ?? null}
									mimeType={doc.mime_type}
									page={page}
									snips={snips}
									activeField={editable ? activeField : null}
									onPageCount={setPageCount}
									onSnip={(rect, text) => void onSnip(rect, text)}
								/>
							)}
						</div>
					</div>

					<aside className="min-h-0 overflow-y-auto border-l border-border p-4">
						{doc.flags.map((flag) => (
							<p
								key={flag}
								className="mb-2 flex gap-1.5 rounded-md border border-amber-300/60 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
							>
								<AlertTriangle className="h-3.5 w-3.5 shrink-0" />
								{flag}
							</p>
						))}
						{doc.status === "classified" && (
							<p className="text-sm text-muted-foreground">
								Read the fields to review this document.
							</p>
						)}
						<div className="space-y-2">
							{fields.map(([key, field]) => (
								<FieldRow
									key={key}
									name={key}
									field={field}
									editable={editable}
									active={activeField === key}
									onHover={(on) => setHovered(on ? key : null)}
									onPick={() => {
										setActiveField(activeField === key ? null : key);
										if (field.page) setPage(field.page);
									}}
									onSave={(value) =>
										fieldMutation.mutate({ field: key, value })
									}
									onAccept={() =>
										fieldMutation.mutate({ field: key, accept: true })
									}
									onAbsent={() =>
										fieldMutation.mutate({ field: key, not_in_document: true })
									}
								/>
							))}
						</div>
						{(doc.doc_type === "receipt" ||
							doc.doc_type === "proof_of_payment") && (
							<label className="mt-4 block text-xs">
								<span className="font-semibold text-foreground">
									Pays invoice
								</span>
								<select
									value={doc.extraction.match?.invoice_id ?? ""}
									disabled={!editable}
									onChange={(event) =>
										docMutation.mutate({
											matched_invoice_id: event.target.value || null,
										})
									}
									className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2"
								>
									<option value="">Not matched</option>
									{invoices.map((invoice) => (
										<option key={invoice.id} value={invoice.id}>
											{invoice.fields.number?.value ?? invoice.file_name}{" "}
											{invoice.fields.total?.value
												? `· ${invoice.fields.currency?.value ?? ""} ${invoice.fields.total.value}`
												: ""}
										</option>
									))}
								</select>
							</label>
						)}
						{(doc.doc_type === "contract" || doc.doc_type === "amendment") &&
							(doc.extraction.clauses?.length ?? 0) > 0 && (
								<ClauseEditor
									clauses={doc.extraction.clauses ?? []}
									editable={editable}
									saving={clausesMutation.isPending}
									onSave={(clauses) => clausesMutation.mutate(clauses)}
								/>
							)}
					</aside>
				</div>
			</div>
		</ModalPortal>
	);
}

const STATE_META: Record<
	ReviewField["state"],
	{ label: string; className: string }
> = {
	read: { label: "✓", className: "text-emerald-600" },
	unsure: { label: "⚠", className: "text-amber-600" },
	needs_input: { label: "needs input", className: "text-destructive" },
	corrected: { label: "✎", className: "text-primary" },
	not_in_document: {
		label: "not in document",
		className: "text-muted-foreground",
	},
};

function FieldRow({
	name,
	field,
	editable,
	active,
	onHover,
	onPick,
	onSave,
	onAccept,
	onAbsent,
}: {
	name: string;
	field: ReviewField;
	editable: boolean;
	active: boolean;
	onHover: (on: boolean) => void;
	onPick: () => void;
	onSave: (value: string) => void;
	onAccept: () => void;
	onAbsent: () => void;
}) {
	const [value, setValue] = useState(field.value ?? "");
	useEffect(() => setValue(field.value ?? ""), [field.value]);
	const meta = STATE_META[field.state];
	return (
		<div
			onMouseEnter={() => onHover(true)}
			onMouseLeave={() => onHover(false)}
			className={`rounded-md border p-2 ${
				field.state === "needs_input"
					? "border-destructive/40 bg-destructive/5"
					: field.state === "unsure"
						? "border-amber-400/60 bg-amber-50/60 dark:bg-amber-500/5"
						: "border-border"
			} ${active ? "ring-2 ring-primary" : ""}`}
		>
			<div className="flex items-center justify-between gap-2 text-[11px]">
				<span className="font-semibold text-foreground">
					{FIELD_LABELS[name] ?? name}
				</span>
				<span className={meta.className}>
					{meta.label}
					{field.state === "unsure"
						? ` ${Math.round(field.confidence * 100)}%`
						: ""}
					{field.origin !== "ai" ? ` · ${field.origin}` : ""}
				</span>
			</div>
			<div className="mt-1 flex gap-1">
				<input
					value={value}
					disabled={!editable}
					onChange={(event) => setValue(event.target.value)}
					onBlur={() => {
						if (value !== (field.value ?? "")) onSave(value);
					}}
					placeholder={
						field.state === "not_in_document" ? "—" : "Type the value"
					}
					className="h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs"
				/>
				{editable && (
					<button
						type="button"
						onClick={onPick}
						title="Draw a box on the page to read this field"
						className={`rounded border px-1.5 ${active ? "border-primary text-primary" : "border-border text-muted-foreground"} hover:bg-muted`}
					>
						<PenLine className="h-3.5 w-3.5" />
					</button>
				)}
			</div>
			{editable &&
				(field.state === "unsure" || field.state === "needs_input") && (
					<div className="mt-1 flex gap-2 text-[11px]">
						{field.state === "unsure" && (
							<button
								type="button"
								onClick={onAccept}
								className="font-semibold text-primary hover:underline"
							>
								It's correct
							</button>
						)}
						<button
							type="button"
							onClick={onAbsent}
							className="text-muted-foreground hover:underline"
						>
							Not in document
						</button>
					</div>
				)}
			{field.ai_value && field.ai_value !== field.value && (
				<p className="mt-1 text-[10px] text-muted-foreground">
					Read as: {field.ai_value}
				</p>
			)}
		</div>
	);
}

/** Split or merge the clauses the model divided wrongly, and fix their text. */
function ClauseEditor({
	clauses: initial,
	editable,
	saving,
	onSave,
}: {
	clauses: IntakeClause[];
	editable: boolean;
	saving: boolean;
	onSave: (clauses: IntakeClause[]) => void;
}) {
	const [clauses, setClauses] = useState(initial);
	useEffect(() => setClauses(initial), [initial]);
	const update = (index: number, patch: Partial<IntakeClause>) =>
		setClauses((list) =>
			list.map((clause, i) => (i === index ? { ...clause, ...patch } : clause)),
		);
	const mergeNext = (index: number) =>
		setClauses((list) => {
			const next = list[index + 1];
			if (!next) return list;
			const merged = {
				...list[index],
				body: `${list[index].body}\n\n${next.body}`,
			};
			return [...list.slice(0, index), merged, ...list.slice(index + 2)];
		});
	const splitAt = (index: number) =>
		setClauses((list) => {
			const clause = list[index];
			const cut = clause.body.indexOf("\n\n");
			if (cut < 0) return list;
			return [
				...list.slice(0, index),
				{ ...clause, body: clause.body.slice(0, cut).trim() },
				{
					title: `${clause.title ?? ""} (cont.)`,
					body: clause.body.slice(cut).trim(),
				},
				...list.slice(index + 1),
			];
		});
	return (
		<section className="mt-6">
			<div className="flex items-center justify-between">
				<h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					Clauses
				</h3>
				{editable && (
					<button
						type="button"
						disabled={saving}
						onClick={() => onSave(clauses)}
						className="rounded-md border border-border px-2 py-1 text-[11px] font-semibold hover:bg-muted disabled:opacity-50"
					>
						Save clauses
					</button>
				)}
			</div>
			<ol className="mt-2 space-y-2">
				{clauses.map((clause, index) => (
					<li
						key={`${clause.number ?? ""}-${index}`}
						className="rounded-md border border-border p-2"
					>
						<input
							value={`${clause.number ? `${clause.number} ` : ""}${clause.title ?? ""}`}
							disabled={!editable}
							onChange={(event) =>
								update(index, { number: undefined, title: event.target.value })
							}
							className="w-full bg-transparent text-xs font-semibold outline-none"
						/>
						<textarea
							value={clause.body}
							disabled={!editable}
							onChange={(event) => update(index, { body: event.target.value })}
							rows={3}
							className="mt-1 w-full rounded border border-input bg-background p-1 text-xs"
						/>
						{editable && (
							<div className="flex gap-3 text-[11px] text-muted-foreground">
								<button
									type="button"
									onClick={() => splitAt(index)}
									className="hover:underline"
								>
									Split at blank line
								</button>
								{index < clauses.length - 1 && (
									<button
										type="button"
										onClick={() => mergeNext(index)}
										className="hover:underline"
									>
										Merge with next
									</button>
								)}
							</div>
						)}
					</li>
				))}
			</ol>
		</section>
	);
}

/** The drawn region, cut from what the canvas (PDF) or image shows. */
function cropRegion(
	wrapper: HTMLDivElement | null,
	rect: SnipRect,
): string | null {
	if (!wrapper) return null;
	const source =
		wrapper.querySelector("canvas") ?? wrapper.querySelector("img");
	if (!source) return null;
	const width =
		source instanceof HTMLCanvasElement ? source.width : source.naturalWidth;
	const height =
		source instanceof HTMLCanvasElement ? source.height : source.naturalHeight;
	if (!width || !height) return null;
	const out = document.createElement("canvas");
	out.width = Math.max(1, Math.round(rect.w * width));
	out.height = Math.max(1, Math.round(rect.h * height));
	const context = out.getContext("2d");
	if (!context) return null;
	context.drawImage(
		source,
		rect.x * width,
		rect.y * height,
		rect.w * width,
		rect.h * height,
		0,
		0,
		out.width,
		out.height,
	);
	try {
		return out.toDataURL("image/png");
	} catch {
		return null;
	}
}
