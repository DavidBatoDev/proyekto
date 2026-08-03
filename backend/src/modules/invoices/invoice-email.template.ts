import { escapeHtml as esc } from '../../common/mail/templates/escape';
import type { InvoiceWithLines } from './invoices.service';

/**
 * The invoice email a client receives. Table-based, inline-styled layout —
 * the only thing mail clients render consistently — and mirrors the invite
 * email's look so Proyekto's mail reads as one family.
 */
export function buildInvoiceEmailHtml(input: {
  invoice: InvoiceWithLines;
  link: string;
  hasAttachment: boolean;
}): string {
  const { invoice, link, hasAttachment } = input;
  const provider = esc(invoice.issued_by?.name ?? 'Your service provider');
  const number = esc(invoice.number);
  const amount = esc(formatMoney(Number(invoice.total ?? 0), invoice.currency));
  const due = invoice.due_date ? esc(formatDate(invoice.due_date)) : null;
  const period =
    invoice.period_start && invoice.period_end
      ? `${esc(formatDate(invoice.period_start))} – ${esc(formatDate(invoice.period_end))}`
      : null;
  const safeLink = esc(link);

  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:6px 0;color:#64748b;font-size:13px;">${label}</td>
      <td style="padding:6px 0;color:#0f172a;font-size:13px;font-weight:600;text-align:right;">${value}</td>
    </tr>`;

  return `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Invoice ${number}</title></head>
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Invoice ${number} for ${amount}${due ? `, due ${due}` : ''}</div>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f1f5f9;padding:28px 12px;">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
          <tr>
            <td style="padding:26px 32px;background-color:#0f172a;">
              <p style="margin:0 0 14px;color:#93c5fd;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">Proyekto</p>
              <h1 style="margin:0 0 8px;color:#ffffff;font-size:26px;line-height:1.2;font-weight:700;">Invoice ${number}</h1>
              <p style="margin:0;color:#cbd5e1;font-size:15px;line-height:1.5;">from <strong style="color:#ffffff;">${provider}</strong></p>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 22px;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
                <tr><td style="padding:16px 18px;">
                  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                    ${row('Amount due', amount)}
                    ${due ? row('Due date', due) : ''}
                    ${period ? row('Period covered', period) : ''}
                  </table>
                </td></tr>
              </table>
              ${
                hasAttachment
                  ? `<p style="margin:0 0 18px;color:#334155;font-size:15px;line-height:1.6;">The full invoice is attached to this email as a PDF.</p>`
                  : `<p style="margin:0 0 18px;color:#334155;font-size:15px;line-height:1.6;">You can view and download the full invoice from your project.</p>`
              }
              <div style="margin:26px 0;text-align:center;">
                <a href="${safeLink}" style="display:inline-block;padding:14px 28px;background-color:#2563eb;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;">View invoice</a>
              </div>
              ${
                invoice.payment_method
                  ? `<p style="margin:0 0 12px;color:#475569;font-size:13px;line-height:1.6;"><strong>How to pay:</strong> ${esc(invoice.payment_method)}</p>`
                  : ''
              }
              <p style="margin:0 0 8px;color:#64748b;font-size:12px;line-height:1.5;">Button not working? Copy and paste this link:</p>
              <p style="margin:0;line-height:1.6;">
                <a href="${safeLink}" style="color:#1d4ed8;font-size:12px;text-decoration:underline;word-break:break-all;">${safeLink}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 24px;background-color:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;">You received this email because an invoice was issued to you on Proyekto.</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
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
