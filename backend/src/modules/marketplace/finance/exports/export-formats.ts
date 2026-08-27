import * as ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { ExportColumn } from './export-columns';

/**
 * File builders for the finance-book export formats. Each takes the already
 * role-filtered columns plus row records keyed by column key — redaction is
 * decided upstream in `exportColumns`, never here.
 */

export type ExportRow = Record<string, string | number | null>;

function cellText(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

/** Quote a CSV field per RFC 4180 when it carries a quote, comma, or newline. */
export function csvField(value: string | number | null | undefined): string {
  const text = cellText(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** UTF-8 CSV with a BOM prefix so Excel detects the encoding. */
export function buildCsv(columns: ExportColumn[], rows: ExportRow[]): Buffer {
  const lines = [
    columns.map((column) => csvField(column.header)).join(','),
    ...rows.map((row) =>
      columns.map((column) => csvField(row[column.key])).join(','),
    ),
  ];
  return Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(lines.join('\r\n'), 'utf8'),
  ]);
}

export async function buildXlsx(
  columns: ExportColumn[],
  rows: ExportRow[],
  sheetName: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    // Roughly fit each column to its widest cell, clamped to stay readable.
    width: Math.min(
      40,
      Math.max(
        10,
        column.header.length + 2,
        ...rows.map((row) => cellText(row[column.key]).length + 2),
      ),
    ),
  }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    sheet.addRow(
      Object.fromEntries(
        columns.map((column) => [column.key, row[column.key] ?? '']),
      ),
    );
  }
  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

/*
 * PDF: same pdfkit approach as the invoice renderer (small image, fast cold
 * starts) but a plain landscape data table — an export is a ledger, not a
 * designed document.
 */
const MARGIN = 40;
const PAGE_WIDTH = 841.89; // A4 landscape
const PAGE_HEIGHT = 595.28;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const INK = '#111827';
const MUTED = '#6b7280';
const RULE = '#e5e7eb';

export function buildPdf(
  columns: ExportColumn[],
  rows: ExportRow[],
  title: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: MARGIN,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      const colWidth = CONTENT_WIDTH / columns.length;

      const drawHeader = (y: number): number => {
        doc.font('Helvetica-Bold').fontSize(7).fillColor(MUTED);
        columns.forEach((column, index) => {
          doc.text(column.header.toUpperCase(), MARGIN + index * colWidth, y, {
            width: colWidth - 6,
            characterSpacing: 0.5,
          });
        });
        const lineY = y + 12;
        doc
          .moveTo(MARGIN, lineY)
          .lineTo(MARGIN + CONTENT_WIDTH, lineY)
          .strokeColor(INK)
          .lineWidth(1)
          .stroke();
        return lineY + 6;
      };

      doc
        .font('Helvetica-Bold')
        .fontSize(13)
        .fillColor(INK)
        .text(title, MARGIN, MARGIN, { width: CONTENT_WIDTH });
      let y = drawHeader(MARGIN + 26);

      doc.font('Helvetica').fontSize(7.5);
      for (const row of rows) {
        const texts = columns.map((column) => cellText(row[column.key]));
        const height = Math.max(
          10,
          ...texts.map((text) =>
            doc.heightOfString(text, { width: colWidth - 6 }),
          ),
        );
        if (y + height > PAGE_HEIGHT - MARGIN) {
          doc.addPage();
          y = drawHeader(MARGIN);
          doc.font('Helvetica').fontSize(7.5);
        }
        doc.fillColor(INK);
        texts.forEach((text, index) => {
          doc.text(text, MARGIN + index * colWidth, y, {
            width: colWidth - 6,
          });
        });
        y += height + 5;
        doc
          .moveTo(MARGIN, y - 3)
          .lineTo(MARGIN + CONTENT_WIDTH, y - 3)
          .strokeColor(RULE)
          .lineWidth(0.5)
          .stroke();
      }

      if (rows.length === 0) {
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor(MUTED)
          .text('No rows in the selected range.', MARGIN, y + 4);
      }

      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
