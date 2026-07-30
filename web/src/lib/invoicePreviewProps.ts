import type {
	InvoicePreviewLine,
	InvoicePreviewProps,
} from "@/components/invoices/InvoicePreview";
import type { Invoice, InvoiceLineItem } from "@/services/invoice.service";

/**
 * Maps a SAVED invoice onto the props `InvoicePreview` renders.
 *
 * This exists so every surface that shows a stored invoice — today the
 * pre-send confirmation, tomorrow anything else — renders it identically, and
 * so the "which lines are hours" rule has exactly one definition on the web
 * side. That rule mirrors `renderInvoiceBuffer` in
 * `backend/src/modules/invoices/invoices.service.ts`; the two must agree or the
 * confirmation shows something the emailed PDF does not.
 *
 * The invoice BUILDER deliberately does not use this: it previews unsaved draft
 * state, which has no line ids or source types yet.
 */

/**
 * Retainer and manual lines are counts; only logged time is billed in hours.
 * Mirrors the same expression in the backend PDF renderer.
 */
export function lineIsHours(
	sourceType: InvoiceLineItem["source_type"],
): boolean {
	return sourceType === "time_log" || sourceType === "overage";
}

export function invoiceToPreviewProps(invoice: Invoice): InvoicePreviewProps {
	const lines: InvoicePreviewLine[] = invoice.line_items
		.slice()
		.sort((a, b) => a.position - b.position)
		.map((item) => ({
			description: item.description,
			quantity: Number(item.quantity ?? 0),
			unit_rate: Number(item.unit_rate ?? 0),
			isHours: lineIsHours(item.source_type),
		}));

	return {
		number: invoice.number,
		currency: invoice.currency,
		issueDate: invoice.issue_date,
		dueDate: invoice.due_date,
		periodStart: invoice.period_start,
		periodEnd: invoice.period_end,
		issuedBy: invoice.issued_by ?? {},
		billTo: invoice.bill_to ?? {},
		paymentMethod: invoice.payment_method,
		notes: invoice.notes,
		lines,
	};
}
