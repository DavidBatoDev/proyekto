import { Injectable, Logger } from '@nestjs/common';
import { pathToFileURL } from 'url';

/**
 * Loads pdfjs-dist into a CommonJS backend.
 *
 * pdfjs-dist v4+ ships ESM only, and this app compiles with
 * `"module": "commonjs"`. Both tsc and SWC rewrite a bare `await import()` into
 * `require()`, which throws ERR_REQUIRE_ESM against an ESM package. Building the
 * dynamic import through `new Function` puts it beyond the compiler's reach --
 * verified by compiling with tsc and confirming the call survives verbatim in
 * the emitted JS rather than becoming a require.
 *
 * We stay on v4+ rather than taking the easier `pdfjs-dist@3` CommonJS build
 * because 3.x carries CVE-2024-4367 (arbitrary script execution via a crafted
 * font), fixed in 4.2.67. This parser runs on files strangers upload, so an
 * awkward import is the cheaper price.
 *
 * `pathToFileURL` is not optional. Node's ESM loader rejects a bare Windows
 * absolute path -- "Received protocol 'd:'" -- so importing the resolved path
 * directly works on Cloud Run and fails on a Windows dev machine. Resolving to
 * an absolute path first also matters: code built by `new Function` has no
 * module context, so a bare specifier would resolve against process.cwd().
 */

/*
 * The Function constructor is the entire point here: it hides the dynamic
 * import from tsc and SWC so neither can downlevel it into require(). The body
 * is a fixed literal with no interpolation and no caller input, so despite the
 * rule's name there is no eval surface.
 */
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<PdfjsModule>;

export interface PdfjsTextItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

export interface PdfjsModule {
  version: string;
  getDocument(options: Record<string, unknown>): {
    promise: Promise<PdfjsDocument>;
  };
}

export interface PdfjsDocument {
  numPages: number;
  getMetadata(): Promise<{ info: Record<string, string | undefined> }>;
  getPage(pageNumber: number): Promise<PdfjsPage>;
  destroy(): Promise<void>;
}

export interface PdfjsPage {
  getViewport(options: { scale: number }): { width: number; height: number };
  getTextContent(
    options?: Record<string, unknown>,
  ): Promise<{ items: PdfjsTextItem[] }>;
}

@Injectable()
export class PdfjsLoaderService {
  private readonly logger = new Logger(PdfjsLoaderService.name);
  private cached: Promise<PdfjsModule> | null = null;

  load(): Promise<PdfjsModule> {
    if (!this.cached) {
      this.cached = (async () => {
        const entry = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
        const mod = await dynamicImport(pathToFileURL(entry).href);
        this.logger.log(`pdfjs-dist ${mod.version} loaded`);
        return mod;
      })().catch((error: unknown) => {
        // Never cache a failed load, or one transient failure disables the
        // importer for the lifetime of the process.
        this.cached = null;
        throw error;
      });
    }
    return this.cached;
  }
}
