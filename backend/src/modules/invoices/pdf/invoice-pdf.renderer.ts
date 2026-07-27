import PDFDocument from 'pdfkit';

/**
 * Renders a client invoice to PDF, reproducing the layout the team currently
 * builds by hand in Canva: provider block with address + TIN, client name, a
 * large INVOICE heading with the number, the covered period, a
 * DESCRIPTION / RATE / HRS-QTY / TOTAL table, an optional note, and a footer
 * carrying payment method, due date, and total due.
 *
 * pdfkit is used rather than a headless browser so the Cloud Run image stays
 * small and cold starts stay fast.
 */

export interface InvoicePdfParty {
  name?: string | null;
  address?: string | null;
  tin?: string | null;
  email?: string | null;
}

export interface InvoicePdfLine {
  description: string;
  quantity: number;
  unit_rate: number;
  amount: number;
  /** Rendered as a bare qty when false, e.g. "1" for a retainer line. */
  isHours?: boolean;
}

export interface InvoicePdfInput {
  number: string;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  issuedBy: InvoicePdfParty;
  billTo: InvoicePdfParty;
  lines: InvoicePdfLine[];
  total: number;
  notes?: string | null;
  paymentMethod?: string | null;
}

const ACCENT = '#e01e5a';
const INK = '#111111';
const MUTED = '#666666';
const RULE = '#dddddd';

const MARGIN = 56;
const PAGE_WIDTH = 595.28; // A4 portrait
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function money(currency: string, amount: number): string {
  const formatted = Number(amount ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${formatted}`;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function quantityLabel(line: InvoicePdfLine): string {
  const qty = Number(line.quantity ?? 0);
  const rendered = Number.isInteger(qty) ? String(qty) : qty.toFixed(2);
  return line.isHours === false ? rendered : `${rendered} HOURS`;
}

export function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      drawInvoice(doc, input);
      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function drawInvoice(doc: PDFKit.PDFDocument, input: InvoicePdfInput): void {
  // ── Header: provider identity ─────────────────────────────────────────────
  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(18)
    .text(
      (input.issuedBy.name ?? 'Service Provider').toUpperCase(),
      MARGIN,
      MARGIN,
    );

  doc.font('Helvetica').fontSize(8).fillColor(MUTED);
  const providerLines = [
    input.issuedBy.address?.trim(),
    input.issuedBy.tin ? `TIN: ${input.issuedBy.tin}` : null,
    input.issuedBy.email?.trim(),
  ].filter(Boolean) as string[];
  for (const line of providerLines) {
    doc.text(line, MARGIN, doc.y, { width: CONTENT_WIDTH * 0.55 });
  }

  // ── Client + invoice identity ─────────────────────────────────────────────
  const blockTop = MARGIN + 78;
  doc
    .fillColor(MUTED)
    .font('Helvetica')
    .fontSize(9)
    .text('Client Name :', MARGIN, blockTop);
  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text((input.billTo.name ?? '—').toUpperCase(), MARGIN, blockTop + 13, {
      width: CONTENT_WIDTH * 0.5,
    });

  const rightX = MARGIN + CONTENT_WIDTH * 0.5;
  const rightWidth = CONTENT_WIDTH * 0.5;
  doc
    .fillColor(ACCENT)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text('I N V O I C E', rightX, blockTop, {
      width: rightWidth,
      align: 'right',
    });
  doc
    .fillColor(INK)
    .fontSize(12)
    .text(`#${input.number}`, rightX, blockTop + 28, {
      width: rightWidth,
      align: 'right',
    });

  // ── Covered period ────────────────────────────────────────────────────────
  const periodTop = blockTop + 62;
  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('DATE COVERED:', MARGIN, periodTop);
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(INK)
    .text(
      input.periodStart && input.periodEnd
        ? `${formatDate(input.periodStart)} – ${formatDate(input.periodEnd)}`
        : formatDate(input.issueDate),
      MARGIN,
      periodTop + 14,
    );

  // ── Line-item table ───────────────────────────────────────────────────────
  const tableTop = periodTop + 52;
  // Column geometry. The money columns need real room: at 8.5pt Helvetica a
  // value like "USD 15,000.00" is ~60pt wide, and an earlier 12%-wide rate
  // column (~58pt) wrapped it onto a second line, so the rendered invoice
  // showed a bare "USD" against the amount. Keep rate/total at 18% each.
  const cols = {
    description: MARGIN,
    rate: MARGIN + CONTENT_WIDTH * 0.44,
    qty: MARGIN + CONTENT_WIDTH * 0.64,
    total: MARGIN + CONTENT_WIDTH * 0.8,
  };
  const colWidths = {
    description: CONTENT_WIDTH * 0.42,
    rate: CONTENT_WIDTH * 0.18,
    qty: CONTENT_WIDTH * 0.14,
    total: CONTENT_WIDTH * 0.18,
  };

  doc.font('Helvetica-Bold').fontSize(8).fillColor(INK);
  doc.text('DESCRIPTION', cols.description, tableTop, {
    width: colWidths.description,
  });
  doc.text('RATE', cols.rate, tableTop, {
    width: colWidths.rate,
    align: 'right',
  });
  doc.text('HRS/QTY', cols.qty, tableTop, {
    width: colWidths.qty,
    align: 'right',
  });
  doc.text('TOTAL', cols.total, tableTop, {
    width: colWidths.total,
    align: 'right',
  });

  let y = tableTop + 16;
  doc
    .moveTo(MARGIN, y)
    .lineTo(MARGIN + CONTENT_WIDTH, y)
    .strokeColor(INK)
    .lineWidth(1)
    .stroke();
  y += 10;

  doc.font('Helvetica').fontSize(8.5).fillColor(INK);
  for (const line of input.lines) {
    const height = doc.heightOfString(line.description.toUpperCase(), {
      width: colWidths.description,
    });
    doc.text(line.description.toUpperCase(), cols.description, y, {
      width: colWidths.description,
    });
    doc.text(money(input.currency, line.unit_rate), cols.rate, y, {
      width: colWidths.rate,
      align: 'right',
    });
    doc.text(quantityLabel(line), cols.qty, y, {
      width: colWidths.qty,
      align: 'right',
    });
    doc.text(money(input.currency, line.amount), cols.total, y, {
      width: colWidths.total,
      align: 'right',
    });
    y += Math.max(height, 12) + 8;

    if (y > 640) {
      doc.addPage();
      y = MARGIN;
    }
  }

  doc
    .moveTo(MARGIN, y)
    .lineTo(MARGIN + CONTENT_WIDTH, y)
    .strokeColor(RULE)
    .lineWidth(0.7)
    .stroke();
  y += 12;

  if (input.notes?.trim()) {
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(INK)
      .text('*Note:', MARGIN, y, { width: CONTENT_WIDTH });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(input.notes.trim(), MARGIN, doc.y, { width: CONTENT_WIDTH });
  }

  // ── Footer totals ─────────────────────────────────────────────────────────
  const footerTop = 700;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(INK);
  doc.text('PAYMENT METHOD :', MARGIN, footerTop, {
    width: CONTENT_WIDTH * 0.34,
  });
  doc.text('DUE DATE :', MARGIN + CONTENT_WIDTH * 0.36, footerTop, {
    width: CONTENT_WIDTH * 0.28,
  });
  doc.text('TOTAL DUE :', MARGIN + CONTENT_WIDTH * 0.68, footerTop, {
    width: CONTENT_WIDTH * 0.32,
    align: 'right',
  });

  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK);
  doc.text(
    (input.paymentMethod ?? 'Online payment').toUpperCase(),
    MARGIN,
    footerTop + 14,
    { width: CONTENT_WIDTH * 0.34 },
  );
  doc.text(
    formatDate(input.dueDate).toUpperCase(),
    MARGIN + CONTENT_WIDTH * 0.36,
    footerTop + 14,
    { width: CONTENT_WIDTH * 0.28 },
  );
  doc
    .fillColor(ACCENT)
    .fontSize(16)
    .text(
      money(input.currency, input.total),
      MARGIN + CONTENT_WIDTH * 0.6,
      footerTop + 10,
      {
        width: CONTENT_WIDTH * 0.4,
        align: 'right',
      },
    );
}
