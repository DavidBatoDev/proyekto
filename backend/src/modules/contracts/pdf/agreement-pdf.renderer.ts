import PDFDocument from 'pdfkit';
import { renderClauseBody } from '../contract-clause-template';

/**
 * Renders the Service Agreement to PDF: provider header, numbered clauses, the
 * commercial-terms summary, and the two-column signature block — matching the
 * document the team currently maintains by hand.
 */

export interface AgreementPdfInput {
  title: string;
  subtitle?: string | null;
  providerName?: string | null;
  providerAddress?: string | null;
  providerEmail?: string | null;
  clientName?: string | null;
  contractNumber?: string | null;
  terms: Array<{ label: string; value: string }>;
  clauses: Array<{ title: string; body: string }>;
  signedByConsultant?: {
    name: string;
    at: string;
    image?: Buffer;
    /** Display multiplier for the image; 1 = SIGNATURE_BASE_HEIGHT. */
    imageScale?: number;
    /** Placement offsets in base-height multiples; +x right, +y up. */
    imageOffsetX?: number;
    imageOffsetY?: number;
  } | null;
  signedByClient?: {
    name: string;
    at: string;
    image?: Buffer;
    imageScale?: number;
    imageOffsetX?: number;
    imageOffsetY?: number;
  } | null;
}

const HEADING = '#1f3a93';
const INK = '#111111';
const MUTED = '#666666';
const MARGIN = 56;
const PAGE_WIDTH = 595.28;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const PAGE_BOTTOM = 780;
/** Height of a signature image at scale 1, in points. */
const SIGNATURE_BASE_HEIGHT = 32;
/** Reserved height of the signature field — fixed, whatever the image does. */
const SIGNATURE_FIELD_HEIGHT = 36;

function formatStamp(at: string): string {
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return at;
  return parsed.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function renderAgreementPdf(input: AgreementPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      drawAgreement(doc, input);
      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > PAGE_BOTTOM) doc.addPage();
}

function drawAgreement(
  doc: PDFKit.PDFDocument,
  input: AgreementPdfInput,
): void {
  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(14)
    .text(
      (input.providerName ?? 'Service Provider').toUpperCase(),
      MARGIN,
      MARGIN,
      {
        width: CONTENT_WIDTH,
        align: 'right',
      },
    );
  if (input.providerEmail) {
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(input.providerEmail, MARGIN, doc.y, {
        width: CONTENT_WIDTH,
        align: 'right',
      });
  }

  doc.moveDown(2);
  doc
    .fillColor(HEADING)
    .font('Helvetica-Bold')
    .fontSize(20)
    .text(input.title, MARGIN, doc.y, {
      width: CONTENT_WIDTH,
      align: 'center',
    });

  const subtitle = [
    input.subtitle,
    input.contractNumber ? `#${input.contractNumber}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  if (subtitle) {
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(9)
      .text(subtitle, MARGIN, doc.y + 4, {
        width: CONTENT_WIDTH,
        align: 'center',
      });
  }

  // ── Commercial terms summary ──────────────────────────────────────────────
  if (input.terms.length > 0) {
    doc.moveDown(2);
    ensureSpace(doc, 40 + input.terms.length * 14);
    doc
      .fillColor(HEADING)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text('Commercial Terms', MARGIN, doc.y);
    doc.moveDown(0.4);
    for (const term of input.terms) {
      const y = doc.y;
      doc
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(9)
        .text(term.label, MARGIN, y, { width: CONTENT_WIDTH * 0.4 });
      doc
        .fillColor(INK)
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(term.value, MARGIN + CONTENT_WIDTH * 0.4, y, {
          width: CONTENT_WIDTH * 0.6,
        });
      doc.moveDown(0.3);
    }
  }

  // ── Numbered clauses ──────────────────────────────────────────────────────
  const parties = { provider: input.providerName, client: input.clientName };
  input.clauses.forEach((clause, index) => {
    doc.moveDown(1.2);
    const body = renderClauseBody(clause.body, parties);
    const bodyHeight = doc
      .font('Helvetica')
      .fontSize(9)
      .heightOfString(body, { width: CONTENT_WIDTH });
    ensureSpace(doc, bodyHeight + 34);

    doc
      .fillColor(HEADING)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(`${index + 1}. ${clause.title}`, MARGIN, doc.y, {
        width: CONTENT_WIDTH,
      });
    doc
      .fillColor(INK)
      .font('Helvetica')
      .fontSize(9)
      .text(body, MARGIN, doc.y + 3, { width: CONTENT_WIDTH });
  });

  // ── Signatures ────────────────────────────────────────────────────────────
  doc.moveDown(2);
  ensureSpace(doc, 90);
  doc
    .fillColor(HEADING)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(`${input.clauses.length + 1}. Signature`, MARGIN, doc.y);
  doc.moveDown(0.6);

  const rowTop = doc.y;
  const half = CONTENT_WIDTH / 2;
  const columns: Array<{
    heading: string;
    signed?: {
      name: string;
      at: string;
      image?: Buffer;
      imageScale?: number;
      imageOffsetX?: number;
      imageOffsetY?: number;
    } | null;
  }> = [
    { heading: 'For Client', signed: input.signedByClient },
    {
      heading: `For ${input.providerName ?? 'Service Provider'}`,
      signed: input.signedByConsultant,
    },
  ];

  // The signature field is a FIXED block: the heading, the rule and the typed
  // name occupy the same space whether or not a signature image exists and
  // whatever size it is. The image is an overlay stamped onto that field, so
  // resizing or repositioning it never changes the document's length.
  const clamp = (
    value: number | undefined,
    lo: number,
    hi: number,
    dflt: number,
  ) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(hi, Math.max(lo, value))
      : dflt;

  const ruleY = rowTop + 14 + SIGNATURE_FIELD_HEIGHT;
  const textY = ruleY + 4;

  columns.forEach((column, index) => {
    const x = MARGIN + index * half;
    doc
      .fillColor(MUTED)
      .font('Helvetica-Bold')
      .fontSize(8)
      .text(column.heading, x, rowTop, { width: half - 12 });
    doc
      .fillColor(INK)
      .font('Helvetica')
      .fontSize(9)
      .text(
        column.signed
          ? `${column.signed.name}\nSigned ${formatStamp(column.signed.at)}`
          : 'Name / Signature / Date',
        x,
        textY,
        { width: half - 12 },
      );
  });

  // Signature images are drawn LAST so they sit on top of the page content,
  // and are positioned rather than laid out — nothing below them moves.
  columns.forEach((column, index) => {
    if (!column.signed?.image) return;
    const x = MARGIN + index * half;
    const scale = clamp(column.signed.imageScale, 0.5, 3, 1);
    const height = SIGNATURE_BASE_HEIGHT * scale;
    const offsetX = clamp(column.signed.imageOffsetX, -3, 3, 0);
    const offsetY = clamp(column.signed.imageOffsetY, -3, 3, 0);
    try {
      doc.image(
        column.signed.image,
        x + offsetX * SIGNATURE_BASE_HEIGHT,
        // Anchored so the ink sits on the rule, then nudged by the offset
        // (+y is up, matching the on-screen editor).
        ruleY - height - offsetY * SIGNATURE_BASE_HEIGHT,
        { fit: [half - 12, height] },
      );
    } catch {
      // A malformed image must never break the whole document.
    }
  });

  // Keep the cursor below the fixed field regardless of signature size.
  doc.y = textY + 24;
}
