import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { findColumnBoundary } from '../lib/column-boundary';
import {
  groupIntoLines,
  isPageFooter,
  mergeWrappedLines,
  normalizeText,
  type PdfLine,
  type PdfTextItem,
} from '../lib/pdf-layout';
import { PdfjsLoaderService } from './pdfjs-loader.service';

export interface PdfDocumentText {
  info: {
    author?: string;
    producer?: string;
    title?: string;
    subject?: string;
  };
  pageCount: number;
  pageWidth: number;
  /** True when a two-column layout was detected on page 1. */
  twoColumn: boolean;
  /** Left-hand column lines, wrap-merged. Empty for single-column documents. */
  sidebar: PdfLine[];
  /** Main column lines, wrap-merged. */
  main: PdfLine[];
  /** Everything, newline-joined — the input for the generic CV route. */
  plainText: string;
}

/** Guards against decompression bombs on a 1Gi Cloud Run instance. */
const MAX_PAGES = 20;
const MAX_ITEMS = 20_000;

@Injectable()
export class PdfTextExtractorService {
  private readonly logger = new Logger(PdfTextExtractorService.name);

  constructor(private readonly loader: PdfjsLoaderService) {}

  async extract(buffer: Buffer): Promise<PdfDocumentText> {
    if (!buffer?.length) {
      throw new BadRequestException('The uploaded file is empty.');
    }
    // Trust the bytes, not the declared mime type.
    if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new BadRequestException('That file is not a PDF.');
    }

    const pdfjs = await this.loader.load();
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      // Defence in depth: this parser runs on files strangers upload.
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      verbosity: 0,
    }).promise;

    try {
      const metadata = await doc
        .getMetadata()
        .catch(() => ({ info: {} as Record<string, string | undefined> }));
      const pageCount = Math.min(doc.numPages, MAX_PAGES);

      const perPage: { width: number; items: PdfTextItem[] }[] = [];
      let total = 0;

      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const page = await doc.getPage(pageNumber);
        const width = page.getViewport({ scale: 1 }).width;
        const content = await page.getTextContent();
        const items: PdfTextItem[] = [];

        for (const raw of content.items) {
          const text = normalizeText(raw.str ?? '');
          if (!text) continue;
          const transform = raw.transform ?? [];
          const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = transform;
          void a;
          void d;
          items.push({
            x: e,
            y: f,
            w: raw.width ?? 0,
            // Sign-safe under the y-flip these documents apply.
            size: Math.hypot(c, b) || Math.abs(raw.height ?? 0),
            text,
            page: pageNumber,
          });
          total += 1;
          if (total > MAX_ITEMS) break;
        }
        perPage.push({ width, items });
        if (total > MAX_ITEMS) {
          this.logger.warn(
            `Text item cap hit at page ${pageNumber}; truncating.`,
          );
          break;
        }
      }

      // The boundary is calibrated on page 1 and reused: later pages of a
      // LinkedIn export drop the sidebar entirely, so re-clustering per page
      // would find no split and silently reclassify the main column.
      const boundary = perPage.length
        ? findColumnBoundary(perPage[0].items)
        : null;

      const sidebarItems: PdfTextItem[] = [];
      const mainItems: PdfTextItem[] = [];
      for (const page of perPage) {
        for (const item of page.items) {
          if (boundary !== null && item.x < boundary) sidebarItems.push(item);
          else mainItems.push(item);
        }
      }

      // Footers are stripped at LINE level, not item level: "Page 1 of 5" is
      // emitted as several separate runs, so no individual run ever matches
      // the pattern. Filtered per item, the footer survives and lands in
      // whatever field the parser is populating when it reaches it -- which
      // showed up as a role whose location was "Page 1 of 5".
      const dropFooters = (lines: PdfLine[]) =>
        lines.filter((line) => !isPageFooter(line.text));

      const sidebar = dropFooters(
        mergeWrappedLines(groupIntoLines(sidebarItems)),
      );
      const main = dropFooters(mergeWrappedLines(groupIntoLines(mainItems)));

      return {
        info: {
          author: metadata.info?.Author,
          producer: metadata.info?.Producer,
          title: metadata.info?.Title,
          subject: metadata.info?.Subject,
        },
        pageCount: doc.numPages,
        pageWidth: perPage[0]?.width ?? 612,
        twoColumn: boundary !== null,
        sidebar,
        main,
        plainText: [...main, ...sidebar].map((l) => l.text).join('\n'),
      };
    } finally {
      // pdfjs holds worker state and buffers; leaking it on a long-lived
      // Cloud Run instance is how memory limits get hit under load.
      await doc.destroy().catch(() => undefined);
    }
  }
}
