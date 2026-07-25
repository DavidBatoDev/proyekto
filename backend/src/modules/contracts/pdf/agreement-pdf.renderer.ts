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
  signedByConsultant?: { name: string; at: string } | null;
  signedByClient?: { name: string; at: string } | null;
}

const HEADING = '#1f3a93';
const INK = '#111111';
const MUTED = '#666666';
const MARGIN = 56;
const PAGE_WIDTH = 595.28;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const PAGE_BOTTOM = 780;

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
    signed?: { name: string; at: string } | null;
  }> = [
    { heading: 'For Client', signed: input.signedByClient },
    {
      heading: `For ${input.providerName ?? 'Service Provider'}`,
      signed: input.signedByConsultant,
    },
  ];

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
        rowTop + 14,
        { width: half - 12 },
      );
  });
}
