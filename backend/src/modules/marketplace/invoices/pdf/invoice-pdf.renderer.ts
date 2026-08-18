import PDFDocument from 'pdfkit';

/**
 * Renders a client invoice to PDF.
 *
 * This and `web/src/components/invoices/InvoicePreview.tsx` are a matched pair:
 * the consultant edits against the preview and the client receives this, so the
 * two layouts have to stay in the same shape. Reading order is issuer, document
 * identity, who owes and by when, the work, then a right-aligned totals stack
 * ending on the balance due — the one figure the reader is looking for.
 *
 * It replaced a tracing of the team's hand-built Canva invoice, whose only
 * emphasis colour was an arbitrary magenta applied to the word INVOICE and the
 * total, and which shouted every line description in upper case.
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
  /** Stored status, so an issued document can say what it is. */
  status?: string | null;
  /** Settled so far, from the payments ledger. */
  amountPaid?: number | null;
  /** Past its due date with a balance outstanding. */
  isOverdue?: boolean | null;
}

/*
 * A printed document is near-black on white with ONE accent, and the accent is
 * the product blue rather than a colour picked per document — an invoice and a
 * service agreement should read as coming from the same company.
 */
const INK = '#111827';
const MUTED = '#6b7280';
const RULE = '#e5e7eb';
const ACCENT = '#2563eb';
const ALARM = '#b91c1c';
const ALARM_BG = '#fef2f2';
const CHIP_BG = '#f3f4f6';

const MARGIN = 56;
const PAGE_WIDTH = 595.28; // A4 portrait
const PAGE_HEIGHT = 841.89;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
/** Rows stop here so the totals stack and footer always have room. */
const TABLE_BOTTOM = PAGE_HEIGHT - MARGIN - 210;

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
  return line.isHours === false ? rendered : `${rendered} hours`;
}

/** The word a reader needs, plus whether it should alarm them. */
function statusLabel(
  status: string | null | undefined,
  isOverdue: boolean | null | undefined,
): { label: string; alarming: boolean } | null {
  if (!status) return null;
  if (status === 'void') return { label: 'VOID', alarming: true };
  if (status === 'paid') return { label: 'PAID IN FULL', alarming: false };
  if (isOverdue) return { label: 'OVERDUE', alarming: true };
  if (status === 'partially_paid')
    return { label: 'PARTIALLY PAID', alarming: false };
  if (status === 'draft') return { label: 'DRAFT', alarming: false };
  return null;
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

function rule(doc: PDFKit.PDFDocument, y: number, color: string, width = 0.7) {
  doc
    .moveTo(MARGIN, y)
    .lineTo(MARGIN + CONTENT_WIDTH, y)
    .strokeColor(color)
    .lineWidth(width)
    .stroke();
}

/** A small filled pill with centred caps, used for the status chip. */
function chip(
  doc: PDFKit.PDFDocument,
  text: string,
  rightEdge: number,
  y: number,
  fg: string,
  bg: string,
): void {
  doc.font('Helvetica-Bold').fontSize(7);
  const w = doc.widthOfString(text) + 12;
  const h = 14;
  const x = rightEdge - w;
  doc.roundedRect(x, y, w, h, 7).fill(bg);
  doc.fillColor(fg).text(text, x, y + 4, { width: w, align: 'center' });
}

function drawInvoice(doc: PDFKit.PDFDocument, input: InvoicePdfInput): void {
  const paid = Number(input.amountPaid ?? 0);
  const balance = Math.max(0, Number(input.total ?? 0) - paid);
  const badge = statusLabel(input.status, input.isOverdue);
  const rightEdge = MARGIN + CONTENT_WIDTH;

  // ── Issuer ────────────────────────────────────────────────────────────────
  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text(input.issuedBy.name ?? 'Service provider', MARGIN, MARGIN, {
      width: CONTENT_WIDTH * 0.6,
    });

  doc.font('Helvetica').fontSize(8).fillColor(MUTED);
  const providerLines = [
    input.issuedBy.address?.trim(),
    input.issuedBy.tin ? `TIN ${input.issuedBy.tin}` : null,
    input.issuedBy.email?.trim(),
  ].filter(Boolean) as string[];
  let providerY = MARGIN + 18;
  for (const line of providerLines) {
    doc.text(line, MARGIN, providerY, { width: CONTENT_WIDTH * 0.55 });
    providerY = doc.y;
  }

  // Document identity, right-aligned against the issuer.
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(MUTED)
    .text('INVOICE', MARGIN + CONTENT_WIDTH * 0.6, MARGIN, {
      width: CONTENT_WIDTH * 0.4,
      align: 'right',
      characterSpacing: 2,
    });
  doc
    .font('Helvetica-Bold')
    .fontSize(15)
    .fillColor(INK)
    .text(input.number, MARGIN + CONTENT_WIDTH * 0.6, MARGIN + 12, {
      width: CONTENT_WIDTH * 0.4,
      align: 'right',
    });
  if (badge) {
    chip(
      doc,
      badge.label,
      rightEdge,
      MARGIN + 32,
      badge.alarming ? ALARM : MUTED,
      badge.alarming ? ALARM_BG : CHIP_BG,
    );
  }

  const headerBottom = Math.max(providerY, MARGIN + 52) + 12;
  rule(doc, headerBottom, RULE);

  // ── Who owes, and by when ─────────────────────────────────────────────────
  const partyTop = headerBottom + 16;
  doc
    .font('Helvetica-Bold')
    .fontSize(7)
    .fillColor(MUTED)
    .text('BILLED TO', MARGIN, partyTop, { characterSpacing: 1 });
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(INK)
    .text(input.billTo.name ?? '—', MARGIN, partyTop + 12, {
      width: CONTENT_WIDTH * 0.5,
    });
  doc.font('Helvetica').fontSize(8).fillColor(MUTED);
  let billToY = doc.y + 2;
  for (const line of [
    input.billTo.address?.trim(),
    input.billTo.tin ? `TIN ${input.billTo.tin}` : null,
    input.billTo.email?.trim(),
  ].filter(Boolean) as string[]) {
    doc.text(line, MARGIN, billToY, { width: CONTENT_WIDTH * 0.5 });
    billToY = doc.y;
  }

  // Dates, as a right-aligned label/value pair list.
  const metaRows: Array<[string, string]> = [
    ['ISSUED', formatDate(input.issueDate)],
    ['DUE', formatDate(input.dueDate)],
  ];
  if (input.periodStart && input.periodEnd) {
    metaRows.push([
      'PERIOD',
      `${formatDate(input.periodStart)} – ${formatDate(input.periodEnd)}`,
    ]);
  }
  let metaY = partyTop;
  for (const [label, value] of metaRows) {
    doc
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(MUTED)
      .text(label, MARGIN + CONTENT_WIDTH * 0.5, metaY, {
        width: CONTENT_WIDTH * 0.16,
        align: 'right',
        characterSpacing: 1,
      });
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(INK)
      .text(value, MARGIN + CONTENT_WIDTH * 0.68, metaY - 1, {
        width: CONTENT_WIDTH * 0.32,
        align: 'right',
      });
    metaY += 15;
  }

  // ── The work ──────────────────────────────────────────────────────────────
  const tableTop = Math.max(billToY, metaY) + 22;
  const cols = {
    description: MARGIN,
    rate: MARGIN + CONTENT_WIDTH * 0.44,
    qty: MARGIN + CONTENT_WIDTH * 0.64,
    total: MARGIN + CONTENT_WIDTH * 0.8,
  };
  const colWidths = {
    description: CONTENT_WIDTH * 0.42,
    // Money columns need real room: at 8.5pt a value like "USD 15,000.00" is
    // ~60pt wide, and a narrower column wrapped it, printing a bare "USD".
    rate: CONTENT_WIDTH * 0.18,
    qty: CONTENT_WIDTH * 0.14,
    total: CONTENT_WIDTH * 0.18,
  };

  doc.font('Helvetica-Bold').fontSize(7).fillColor(MUTED);
  doc.text('DESCRIPTION', cols.description, tableTop, {
    width: colWidths.description,
    characterSpacing: 1,
  });
  doc.text('RATE', cols.rate, tableTop, {
    width: colWidths.rate,
    align: 'right',
    characterSpacing: 1,
  });
  doc.text('QTY', cols.qty, tableTop, {
    width: colWidths.qty,
    align: 'right',
    characterSpacing: 1,
  });
  doc.text('AMOUNT', cols.total, tableTop, {
    width: colWidths.total,
    align: 'right',
    characterSpacing: 1,
  });

  let y = tableTop + 13;
  rule(doc, y, INK, 1);
  y += 10;

  for (const line of input.lines) {
    doc.font('Helvetica').fontSize(8.5).fillColor(INK);
    // Descriptions keep the consultant's own casing — upper-casing arbitrary
    // prose is shouting, and it mangles product names and dates.
    const height = doc.heightOfString(line.description, {
      width: colWidths.description,
    });
    doc.text(line.description, cols.description, y, {
      width: colWidths.description,
    });
    doc.text(money(input.currency, line.unit_rate), cols.rate, y, {
      width: colWidths.rate,
      align: 'right',
    });
    doc.fillColor(MUTED).text(quantityLabel(line), cols.qty, y, {
      width: colWidths.qty,
      align: 'right',
    });
    doc
      .font('Helvetica-Bold')
      .fillColor(INK)
      .text(money(input.currency, line.amount), cols.total, y, {
        width: colWidths.total,
        align: 'right',
      });
    y += Math.max(height, 12) + 9;
    rule(doc, y - 4, RULE, 0.5);

    if (y > TABLE_BOTTOM) {
      doc.addPage();
      y = MARGIN;
    }
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  const totalsX = MARGIN + CONTENT_WIDTH * 0.55;
  const totalsWidth = CONTENT_WIDTH * 0.45;
  let ty = y + 12;

  const totalRow = (label: string, value: string) => {
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(MUTED)
      .text(label, totalsX, ty, { width: totalsWidth * 0.5 });
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(INK)
      .text(value, totalsX + totalsWidth * 0.5, ty, {
        width: totalsWidth * 0.5,
        align: 'right',
      });
    ty += 15;
  };

  totalRow('Subtotal', money(input.currency, input.total));
  if (paid > 0) {
    totalRow('Paid to date', `- ${money(input.currency, paid)}`);
  }

  doc
    .moveTo(totalsX, ty + 2)
    .lineTo(MARGIN + CONTENT_WIDTH, ty + 2)
    .strokeColor(INK)
    .lineWidth(1)
    .stroke();
  ty += 12;

  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(INK)
    .text(paid > 0 ? 'BALANCE DUE' : 'TOTAL DUE', totalsX, ty + 4, {
      width: totalsWidth * 0.5,
      characterSpacing: 1,
    });
  doc
    .font('Helvetica-Bold')
    .fontSize(14)
    .fillColor(ACCENT)
    .text(money(input.currency, balance), totalsX + totalsWidth * 0.4, ty, {
      width: totalsWidth * 0.6,
      align: 'right',
    });
  ty += 30;

  // ── Terms and notes ───────────────────────────────────────────────────────
  rule(doc, ty, RULE);
  ty += 12;
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(INK)
    .text('Payment method', MARGIN, ty, { width: CONTENT_WIDTH });
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(MUTED)
    .text(input.paymentMethod ?? 'Online payment', MARGIN, doc.y + 1, {
      width: CONTENT_WIDTH,
    });

  if (input.notes?.trim()) {
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(INK)
      .text('Notes', MARGIN, doc.y + 8, { width: CONTENT_WIDTH });
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(input.notes.trim(), MARGIN, doc.y + 1, { width: CONTENT_WIDTH });
  }
}
