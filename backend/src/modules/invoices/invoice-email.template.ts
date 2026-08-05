import { escapeHtml as esc } from '../../common/mail/templates/escape';
import {
  renderDetailRows,
  renderEmailLayout,
  renderParagraph,
} from '../../common/mail/templates/layout';
import type { InvoiceWithLines } from './invoices.service';

/**
 * The invoice email a client receives.
 *
 * Chrome comes from `common/mail/templates/layout` — this file used to carry
 * its own copy of a near-identical layout, which is exactly how it and the
 * invite email drifted apart. The figures are rendered as plain label/value
 * lines rather than inside a bordered panel: the numbers are the content, and
 * the box around them was decoration.
 */
export function buildInvoiceEmailHtml(input: {
  invoice: InvoiceWithLines;
  /** Accepted for backwards-compatible previews; client emails no longer link into finance. */
  link?: string;
  hasAttachment: boolean;
}): string {
  const { invoice, hasAttachment } = input;
  const provider = esc(invoice.issued_by?.name ?? 'Your service provider');
  const number = esc(invoice.number);
  const amount = esc(formatMoney(Number(invoice.total ?? 0), invoice.currency));
  const due = invoice.due_date ? esc(formatDate(invoice.due_date)) : null;
  const period =
    invoice.period_start && invoice.period_end
      ? `${esc(formatDate(invoice.period_start))} – ${esc(formatDate(invoice.period_end))}`
      : null;

  const rows = [{ label: 'Amount due', value: amount }];
  if (due) rows.push({ label: 'Due date', value: due });
  if (period) rows.push({ label: 'Period covered', value: period });

  const bodyHtml = [
    renderParagraph(`<strong>${provider}</strong> has issued you an invoice.`),
    renderDetailRows(rows),
    renderParagraph(
      hasAttachment
        ? 'The full invoice is attached to this email as a PDF.'
        : 'Ask your service provider for a copy of the full invoice.',
    ),
    invoice.payment_method
      ? renderParagraph(
          `<strong>How to pay:</strong> ${esc(invoice.payment_method)}`,
        )
      : null,
  ]
    .filter((block): block is string => block !== null)
    .join('\n');

  return renderEmailLayout({
    preheader: `Invoice ${number} for ${amount}${due ? `, due ${due}` : ''}`,
    title: `Invoice ${number}`,
    bodyHtml,
    cta: null,
    footerNote:
      'You received this email because an invoice was issued to you on Proyekto.',
  });
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      currencyDisplay: 'code',
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatDate(value: string): string {
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
