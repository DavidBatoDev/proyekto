import { formatCurrency } from "@/lib/currency";

/**
 * A live, on-screen facsimile of the server invoice PDF
 * (`backend/src/modules/marketplace/invoices/pdf/invoice-pdf.renderer.ts`).
 * The two are a matched pair: the consultant edits against this and the client
 * receives that, so any change here has to land there in the same shape.
 *
 * The layout follows the conventions a bookkeeper expects, in reading order:
 * issuer, then the document's own identity, then who owes and by when, then the
 * work, then a right-aligned totals stack ending on the one figure that matters
 * — the balance due. It replaced a Canva tracing whose only emphasis colour was
 * an arbitrary magenta applied to the word INVOICE and the total, which put the
 * loudest thing on the page on a heading rather than on the amount owed.
 */

export interface InvoicePreviewParty {
	name?: string | null;
	address?: string | null;
	tin?: string | null;
	email?: string | null;
}

export interface InvoicePreviewLine {
	description: string;
	quantity: number;
	unit_rate: number;
	/** Renders "N hours" when true, a bare count otherwise. */
	isHours?: boolean;
}

export interface InvoicePreviewProps {
	number: string;
	currency: string;
	issueDate: string | null;
	dueDate: string | null;
	periodStart: string | null;
	periodEnd: string | null;
	issuedBy: InvoicePreviewParty;
	billTo: InvoicePreviewParty;
	paymentMethod?: string | null;
	notes?: string | null;
	lines: InvoicePreviewLine[];
	/** Shown when approved hours will be appended server-side on save. */
	hoursNote?: string | null;
	/** Stored status, so an issued document can say what it is. */
	status?: string | null;
	/** Settled so far, from the payments ledger. Omitted on an unsaved draft. */
	amountPaid?: number | null;
	/** Past its due date with a balance outstanding. */
	isOverdue?: boolean | null;
}

/* ── Document ink ──────────────────────────────────────────────────────────
 * A printed document is near-black on white with ONE accent. The accent is the
 * product blue rather than a colour chosen per document, so an invoice and a
 * service agreement read as coming from the same company.
 */
const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#e5e7eb";
const ACCENT = "#2563eb";

function formatDate(value: string | null): string {
	if (!value) return "—";
	const parsed = new Date(`${value.slice(0, 10)}T12:00:00Z`);
	if (Number.isNaN(parsed.getTime())) return value;
	return parsed.toLocaleDateString("en-US", {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	});
}

function quantityLabel(line: InvoicePreviewLine): string {
	const qty = Number(line.quantity ?? 0);
	const rendered = Number.isInteger(qty) ? String(qty) : qty.toFixed(2);
	return line.isHours ? `${rendered} hours` : rendered;
}

/** The word a reader needs, plus whether it should alarm them. */
function statusLabel(
	status: string | null | undefined,
	isOverdue: boolean | null | undefined,
): { label: string; alarming: boolean } | null {
	if (!status) return null;
	if (status === "void") return { label: "Void", alarming: true };
	if (status === "paid") return { label: "Paid in full", alarming: false };
	if (isOverdue) return { label: "Overdue", alarming: true };
	if (status === "partially_paid")
		return { label: "Partially paid", alarming: false };
	if (status === "draft") return { label: "Draft", alarming: false };
	return null;
}

export function InvoicePreview({
	number,
	currency,
	issueDate,
	dueDate,
	periodStart,
	periodEnd,
	issuedBy,
	billTo,
	paymentMethod,
	notes,
	lines,
	hoursNote,
	status,
	amountPaid,
	isOverdue,
}: InvoicePreviewProps) {
	const total = lines.reduce(
		(sum, l) => sum + Number(l.quantity ?? 0) * Number(l.unit_rate ?? 0),
		0,
	);
	const paid = Number(amountPaid ?? 0);
	const balance = Math.max(0, total - paid);
	const badge = statusLabel(status, isOverdue);

	return (
		<div
			// A4 proportion (1 : 1.414). The document should look like the sheet it
			// becomes, not like a card that happens to hold invoice fields.
			className="mx-auto w-full max-w-[560px] bg-white px-10 py-9 shadow-sm ring-1 ring-black/10"
			style={{ color: INK, aspectRatio: "1 / 1.414" }}
		>
			{/* ── Issuer ─────────────────────────────────────────────────────── */}
			<header
				className="flex items-start justify-between gap-6 border-b pb-5"
				style={{ borderColor: RULE }}
			>
				<div className="min-w-0">
					<p className="truncate text-[15px] font-semibold leading-tight">
						{issuedBy.name || "Service provider"}
					</p>
					<div
						className="mt-1.5 space-y-0.5 text-[10px] leading-relaxed"
						style={{ color: MUTED }}
					>
						{issuedBy.address && <p>{issuedBy.address}</p>}
						{issuedBy.tin && <p>TIN {issuedBy.tin}</p>}
						{issuedBy.email && <p>{issuedBy.email}</p>}
					</div>
				</div>
				<div className="shrink-0 text-right">
					<p
						className="text-[10px] font-semibold uppercase tracking-[0.2em]"
						style={{ color: MUTED }}
					>
						Invoice
					</p>
					<p className="mt-0.5 text-lg font-semibold tabular-nums">
						{number || "Draft"}
					</p>
					{badge && (
						<span
							className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
							style={
								badge.alarming
									? { background: "#fef2f2", color: "#b91c1c" }
									: { background: "#f3f4f6", color: MUTED }
							}
						>
							{badge.label}
						</span>
					)}
				</div>
			</header>

			{/* ── Who owes, and by when ──────────────────────────────────────── */}
			<section className="mt-5 flex items-start justify-between gap-6">
				<div className="min-w-0">
					<p
						className="text-[9px] font-semibold uppercase tracking-[0.14em]"
						style={{ color: MUTED }}
					>
						Billed to
					</p>
					<p className="mt-1 truncate text-[13px] font-semibold">
						{billTo.name || "—"}
					</p>
					<div
						className="mt-0.5 space-y-0.5 text-[10px]"
						style={{ color: MUTED }}
					>
						{billTo.address && <p>{billTo.address}</p>}
						{billTo.tin && <p>TIN {billTo.tin}</p>}
						{billTo.email && <p>{billTo.email}</p>}
					</div>
				</div>
				<dl className="shrink-0 space-y-1.5 text-right text-[10px]">
					<Meta label="Issued" value={formatDate(issueDate)} />
					<Meta label="Due" value={formatDate(dueDate)} />
					{periodStart && periodEnd && (
						<Meta
							label="Period"
							value={`${formatDate(periodStart)} – ${formatDate(periodEnd)}`}
						/>
					)}
				</dl>
			</section>

			{/* ── The work ───────────────────────────────────────────────────── */}
			<section className="mt-6">
				<div
					className="grid grid-cols-[minmax(0,1fr)_92px_48px_96px] gap-2 border-b pb-1.5 text-[9px] font-semibold uppercase tracking-[0.12em]"
					style={{ borderColor: INK, color: MUTED }}
				>
					<span>Description</span>
					<span className="text-right">Rate</span>
					<span className="text-right">Qty</span>
					<span className="text-right">Amount</span>
				</div>
				{lines.length === 0 ? (
					<p className="py-6 text-center text-[11px]" style={{ color: MUTED }}>
						No line items yet.
					</p>
				) : (
					lines.map((line, i) => (
						<div
							key={`${line.description}-${i}`}
							className="grid grid-cols-[minmax(0,1fr)_92px_48px_96px] gap-2 border-b py-2.5 text-[11px]"
							style={{ borderColor: RULE }}
						>
							{/* Never upper-cased: this is the consultant's own wording. */}
							<span className="leading-snug">{line.description || "—"}</span>
							<span className="text-right tabular-nums">
								{formatCurrency(line.unit_rate, currency)}
							</span>
							<span
								className="text-right tabular-nums"
								style={{ color: MUTED }}
							>
								{quantityLabel(line)}
							</span>
							<span className="text-right font-medium tabular-nums">
								{formatCurrency(
									Number(line.quantity ?? 0) * Number(line.unit_rate ?? 0),
									currency,
								)}
							</span>
						</div>
					))
				)}
				{hoursNote && (
					<p className="mt-2 text-[10px] italic" style={{ color: MUTED }}>
						{hoursNote}
					</p>
				)}
			</section>

			{/* ── Totals ─────────────────────────────────────────────────────── */}
			<section className="mt-5 flex justify-end">
				<dl className="w-[240px] space-y-1.5 text-[11px]">
					<Total label="Subtotal" value={formatCurrency(total, currency)} />
					{paid > 0 && (
						<Total
							label="Paid to date"
							value={`− ${formatCurrency(paid, currency)}`}
						/>
					)}
					<div
						className="flex items-baseline justify-between border-t pt-2"
						style={{ borderColor: INK }}
					>
						<dt className="text-[10px] font-semibold uppercase tracking-[0.12em]">
							{paid > 0 ? "Balance due" : "Total due"}
						</dt>
						<dd
							className="text-base font-semibold tabular-nums"
							style={{ color: ACCENT }}
						>
							{formatCurrency(balance, currency)}
						</dd>
					</div>
				</dl>
			</section>

			{/* ── Terms and notes ────────────────────────────────────────────── */}
			<footer
				className="mt-6 space-y-3 border-t pt-4 text-[10px]"
				style={{ borderColor: RULE, color: MUTED }}
			>
				<div>
					<p className="font-semibold" style={{ color: INK }}>
						Payment method
					</p>
					<p className="mt-0.5">{paymentMethod || "Online payment"}</p>
				</div>
				{notes && (
					<div>
						<p className="font-semibold" style={{ color: INK }}>
							Notes
						</p>
						<p className="mt-0.5 whitespace-pre-wrap leading-relaxed">
							{notes}
						</p>
					</div>
				)}
			</footer>
		</div>
	);
}

function Meta({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-baseline justify-end gap-3">
			<dt
				className="font-semibold uppercase tracking-[0.12em]"
				style={{ color: MUTED }}
			>
				{label}
			</dt>
			<dd className="min-w-[110px] tabular-nums">{value}</dd>
		</div>
	);
}

function Total({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-baseline justify-between">
			<dt style={{ color: MUTED }}>{label}</dt>
			<dd className="tabular-nums">{value}</dd>
		</div>
	);
}
