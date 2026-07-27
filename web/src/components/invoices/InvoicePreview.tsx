import { formatCurrency } from "@/lib/currency";

/**
 * A live, on-screen facsimile of the server invoice PDF
 * (`backend/src/modules/invoices/pdf/invoice-pdf.renderer.ts`). It mirrors that
 * layout — provider block, Client Name, big INVOICE heading, DATE COVERED, the
 * DESCRIPTION / RATE / HRS-QTY / TOTAL table, notes, and the PAYMENT METHOD /
 * DUE DATE / TOTAL DUE footer — so what the consultant sees while editing is
 * what the downloaded PDF will look like.
 *
 * Totals are computed here for immediacy; the server remains authoritative
 * (`refreshTotals`) once the invoice is saved.
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
	/** Renders "N HOURS" when true, a bare count otherwise. */
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
}

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
	return line.isHours ? `${rendered} HOURS` : rendered;
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
}: InvoicePreviewProps) {
	const total = lines.reduce(
		(sum, l) => sum + Number(l.quantity ?? 0) * Number(l.unit_rate ?? 0),
		0,
	);
	const coveredLabel =
		periodStart && periodEnd
			? `${formatDate(periodStart)} – ${formatDate(periodEnd)}`
			: formatDate(issueDate);

	return (
		<div className="mx-auto w-full max-w-[520px] rounded-lg bg-white p-8 text-[#111] shadow-sm ring-1 ring-black/5">
			{/* Provider identity */}
			<p className="text-lg font-bold uppercase tracking-tight">
				{issuedBy.name || "Service Provider"}
			</p>
			<div className="mt-1 space-y-0.5 text-[11px] text-[#666]">
				{issuedBy.address && <p>{issuedBy.address}</p>}
				{issuedBy.tin && <p>TIN: {issuedBy.tin}</p>}
				{issuedBy.email && <p>{issuedBy.email}</p>}
			</div>

			{/* Client + invoice identity */}
			<div className="mt-8 flex items-start justify-between">
				<div>
					<p className="text-[11px] text-[#666]">Client Name :</p>
					<p className="mt-1 text-sm font-bold uppercase">
						{billTo.name || "—"}
					</p>
				</div>
				<div className="text-right">
					<p className="text-2xl font-bold tracking-[0.25em] text-[#e01e5a]">
						INVOICE
					</p>
					<p className="mt-1 text-sm">#{number || "Draft"}</p>
				</div>
			</div>

			{/* Covered period */}
			<div className="mt-6">
				<p className="text-[11px] font-bold">DATE COVERED:</p>
				<p className="mt-1 text-sm">{coveredLabel}</p>
			</div>

			{/* Line items */}
			<div className="mt-6">
				<div className="grid grid-cols-[1fr_90px_90px_100px] border-b-2 border-[#111] pb-1.5 text-[10px] font-bold">
					<span>DESCRIPTION</span>
					<span className="text-right">RATE</span>
					<span className="text-right">HRS/QTY</span>
					<span className="text-right">TOTAL</span>
				</div>
				{lines.length === 0 ? (
					<p className="py-4 text-center text-xs text-[#999]">
						No line items yet.
					</p>
				) : (
					lines.map((line, i) => (
						<div
							key={`${line.description}-${i}`}
							className="grid grid-cols-[1fr_90px_90px_100px] gap-2 border-b border-[#eee] py-2 text-[11px]"
						>
							<span className="uppercase">{line.description || "—"}</span>
							<span className="text-right tabular-nums">
								{formatCurrency(line.unit_rate, currency)}
							</span>
							<span className="text-right tabular-nums">
								{quantityLabel(line)}
							</span>
							<span className="text-right tabular-nums">
								{formatCurrency(
									Number(line.quantity ?? 0) * Number(line.unit_rate ?? 0),
									currency,
								)}
							</span>
						</div>
					))
				)}
				{hoursNote && (
					<p className="mt-2 text-[11px] italic text-[#666]">{hoursNote}</p>
				)}
			</div>

			{notes && (
				<div className="mt-4 text-[11px] text-[#666]">
					<p className="font-bold text-[#111]">*Note:</p>
					<p className="whitespace-pre-wrap">{notes}</p>
				</div>
			)}

			{/* Footer totals */}
			<div className="mt-10 flex items-end justify-between">
				<div className="space-y-3 text-[10px] font-bold">
					<div>
						<p>PAYMENT METHOD :</p>
						<p className="mt-0.5 text-sm">
							{(paymentMethod || "Online payment").toUpperCase()}
						</p>
					</div>
				</div>
				<div className="text-center text-[10px] font-bold">
					<p>DUE DATE :</p>
					<p className="mt-0.5 text-sm">{formatDate(dueDate).toUpperCase()}</p>
				</div>
				<div className="text-right text-[10px] font-bold">
					<p>TOTAL DUE :</p>
					<p className="mt-0.5 text-lg font-bold text-[#e01e5a]">
						{formatCurrency(total, currency)}
					</p>
				</div>
			</div>
		</div>
	);
}
