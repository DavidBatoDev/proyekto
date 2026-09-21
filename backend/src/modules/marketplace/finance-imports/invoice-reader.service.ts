import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';
/** The global request timeout is 25s; leave room for the PDF work around it. */
const TIMEOUT_MS = 18_000;
const MAX_INPUT_CHARS = 12_000;
/**
 * A phone screenshot of a bank app is well under 1 MB; anything near this is a
 * scan nobody should be paying vision tokens for. Over the cap the document is
 * simply snipped by hand, like every other degradation here.
 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const VISION_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type ReadableDocumentKind = 'invoice' | 'payment_proof' | 'other';

export interface ReadInvoiceField {
  value: string | null;
  /** The reader's own confidence, 0..1. Never treated as fact by the UI. */
  confidence: number;
}

export interface ReadInvoiceFields {
  number: ReadInvoiceField;
  currency: ReadInvoiceField;
  total: ReadInvoiceField;
  issue_date: ReadInvoiceField;
  due_date: ReadInvoiceField;
  client_name: ReadInvoiceField;
  note: string | null;
}

/**
 * What a bank record says about one transfer.
 *
 * `original_*` is the figure the SENDER's bank quoted, which a cross-border
 * narration often carries ("/OCMT/AUD3840,00/" on a PESONet credit). It is the
 * only thing on a PHP credit that ties it to an AUD invoice, so it is read as
 * a field of its own and never folded into the settled amount.
 */
export interface ReadPaymentFields {
  payment_date: ReadInvoiceField;
  settled_amount: ReadInvoiceField;
  settled_currency: ReadInvoiceField;
  reference: ReadInvoiceField;
  original_amount: ReadInvoiceField;
  original_currency: ReadInvoiceField;
  sender: ReadInvoiceField;
  note: string | null;
}

const EMPTY_FIELD: ReadInvoiceField = { value: null, confidence: 0 };

function emptyPaymentFields(note: string | null): ReadPaymentFields {
  return {
    payment_date: { ...EMPTY_FIELD },
    settled_amount: { ...EMPTY_FIELD },
    settled_currency: { ...EMPTY_FIELD },
    reference: { ...EMPTY_FIELD },
    original_amount: { ...EMPTY_FIELD },
    original_currency: { ...EMPTY_FIELD },
    sender: { ...EMPTY_FIELD },
    note,
  };
}

const INVOICE_PROMPT = [
  'You read one invoice and return its header fields as JSON.',
  'Return exactly this shape:',
  '{"number":string|null,"currency":string|null,"total":number|null,',
  '"issue_date":string|null,"due_date":string|null,"client_name":string|null,',
  '"confidence":{"number":0..1,"currency":0..1,"total":0..1,"issue_date":0..1,"due_date":0..1,"client_name":0..1}}',
  'Dates are ISO (YYYY-MM-DD). Currency is a 3-letter ISO code.',
  'total is the grand total due, digits only, no separators or symbols.',
  'When a field is not present in the document, return null and confidence 0.',
  'Never invent a value that is not written in the document.',
].join(' ');

const PAYMENT_PROMPT = [
  'You read one bank record of a single incoming transfer (a bank-app screenshot,',
  'a remittance advice, or a statement line) and return its fields as JSON.',
  'Return exactly this shape:',
  '{"payment_date":string|null,"settled_amount":number|null,"settled_currency":string|null,',
  '"reference":string|null,"original_amount":number|null,"original_currency":string|null,',
  '"sender":string|null,',
  '"confidence":{"payment_date":0..1,"settled_amount":0..1,"settled_currency":0..1,',
  '"reference":0..1,"original_amount":0..1,"original_currency":0..1,"sender":0..1}}',
  'settled_amount and settled_currency are what ARRIVED in the receiving account.',
  'reference is the bank reference or narration, copied verbatim.',
  'original_amount and original_currency are the amount the sender instructed, when the',
  'narration quotes one in another currency (for example "/OCMT/AUD3840,00/" means',
  'AUD 3840.00; a comma there is a decimal separator). Otherwise null.',
  'The phone status-bar clock is not a payment date. Dates are ISO (YYYY-MM-DD).',
  'Currencies are 3-letter ISO codes. Amounts are digits only, no separators or symbols.',
  'When a field is not present, return null and confidence 0.',
  'Never invent a value that is not written in the document.',
].join(' ');

type ChatContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string; detail: 'high' } }
    >;

function emptyFields(note: string | null): ReadInvoiceFields {
  return {
    number: { ...EMPTY_FIELD },
    currency: { ...EMPTY_FIELD },
    total: { ...EMPTY_FIELD },
    issue_date: { ...EMPTY_FIELD },
    due_date: { ...EMPTY_FIELD },
    client_name: { ...EMPTY_FIELD },
    note,
  };
}

/**
 * A first pass at the fields on an uploaded invoice.
 *
 * Follows CvExtractorService exactly: call OpenAI, sanitise everything it
 * returns, and NEVER throw. Every value it produces is a SUGGESTION — the
 * record is only ever committed from the snipping workspace, where a human
 * either accepts a suggestion or draws the region it should have read. With no
 * OPENAI_API_KEY (every dev machine without one) the import still works; the
 * fields simply arrive blank and are snipped by hand.
 *
 * That degradation is the whole design: money must never be booked from a
 * model's guess, so the guess is deliberately kept as a labelled draft rather
 * than a value the form treats as filled.
 */
@Injectable()
export class InvoiceReaderService {
  private readonly logger = new Logger(InvoiceReaderService.name);

  constructor(private readonly config: ConfigService) {}

  /** The text-layer path: a PDF invoice the server already extracted. */
  async read(plainText: string): Promise<ReadInvoiceFields> {
    const text = plainText.slice(0, MAX_INPUT_CHARS).trim();
    if (!text) {
      return emptyFields(
        'No text layer was found in that file, so nothing was pre-filled. Snip the fields from the document.',
      );
    }
    const result = await this.complete(INVOICE_PROMPT, text);
    return result.raw ? this.sanitize(result.raw) : emptyFields(result.note);
  }

  /** The same, for a bank record that arrived as a PDF (a remittance advice). */
  async readPayment(plainText: string): Promise<ReadPaymentFields> {
    const text = plainText.slice(0, MAX_INPUT_CHARS).trim();
    if (!text) {
      return emptyPaymentFields(
        'No text layer was found in that file, so nothing was pre-filled. Type the payment from the document.',
      );
    }
    const result = await this.complete(PAYMENT_PROMPT, text);
    return result.raw
      ? this.sanitizePayment(result.raw)
      : emptyPaymentFields(result.note);
  }

  /** Can this file go down the vision path at all? */
  canReadImage(mimeType: string, sizeBytes: number): boolean {
    return VISION_MIME_TYPES.has(mimeType) && sizeBytes <= MAX_IMAGE_BYTES;
  }

  /**
   * The OCR path: a photograph or screenshot with no text layer to extract.
   *
   * A bank-app screenshot is the usual proof of payment, and it is an image by
   * nature — so without this, the one document that carries the settled amount
   * and the transfer's own FX evidence was the one document never read. The
   * contract is unchanged from `read`: suggestions only, sanitised, never
   * thrown. A human still commits every figure.
   */
  async readImage(
    image: Buffer,
    mimeType: string,
    kind: ReadableDocumentKind,
  ): Promise<ReadInvoiceFields | ReadPaymentFields> {
    const isPayment = kind === 'payment_proof';
    const empty = (note: string) =>
      isPayment ? emptyPaymentFields(note) : emptyFields(note);

    if (!this.canReadImage(mimeType, image.byteLength)) {
      return empty(
        'That image is too large or of a type that cannot be read automatically. Enter the fields from the document.',
      );
    }

    const result = await this.complete(
      isPayment ? PAYMENT_PROMPT : INVOICE_PROMPT,
      [
        {
          type: 'text',
          text: isPayment
            ? 'Read this bank record.'
            : 'Read this invoice.',
        },
        {
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${image.toString('base64')}`,
            // Figures on a phone screenshot are small; low detail misreads them.
            detail: 'high',
          },
        },
      ],
    );
    if (!result.raw) return empty(result.note);
    return isPayment
      ? this.sanitizePayment(result.raw)
      : this.sanitize(result.raw);
  }

  /**
   * One model call. Follows CvExtractorService exactly: NEVER throws — every
   * failure collapses to a note for the person importing, and the import goes
   * on by hand.
   */
  private async complete(
    system: string,
    content: ChatContent,
  ): Promise<
    { raw: Record<string, unknown>; note: null } | { raw: null; note: string }
  > {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY absent; returning an empty draft.');
      return {
        raw: null,
        note: 'Automatic reading is unavailable, so nothing was pre-filled. Snip the fields from the document.',
      };
    }

    const unreadable = {
      raw: null,
      note: 'The document could not be read automatically. Snip the fields from it.',
    } as const;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(OPENAI_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content },
          ],
        }),
      });

      if (!response.ok) {
        this.logger.warn(`Document read failed: HTTP ${response.status}`);
        return unreadable;
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const reply = payload.choices?.[0]?.message?.content;
      if (!reply) {
        return { raw: null, note: 'The reader returned nothing to pre-fill.' };
      }
      return {
        raw: JSON.parse(reply) as Record<string, unknown>,
        note: null,
      };
    } catch (error) {
      this.logger.warn(
        `Document read failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return unreadable;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Nothing from the model reaches the database unchecked: dates must parse as
   * dates, the total as a positive number, the currency as three letters.
   * Anything else becomes a blank field for a human to snip.
   */
  private sanitize(raw: Record<string, unknown>): ReadInvoiceFields {
    const confidence = (raw.confidence ?? {}) as Record<string, unknown>;
    const score = (key: string): number => {
      const value = Number(confidence[key]);
      return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    };
    const field = (key: string, value: string | null): ReadInvoiceField => ({
      value,
      confidence: value === null ? 0 : score(key),
    });

    return {
      number: field('number', this.text(raw.number, 120)),
      currency: field('currency', this.currency(raw.currency)),
      total: field('total', this.amount(raw.total)),
      issue_date: field('issue_date', this.date(raw.issue_date)),
      due_date: field('due_date', this.date(raw.due_date)),
      client_name: field('client_name', this.text(raw.client_name, 200)),
      note: null,
    };
  }

  /** The same rule for a bank record: every figure re-validated, or blank. */
  private sanitizePayment(raw: Record<string, unknown>): ReadPaymentFields {
    const confidence = (raw.confidence ?? {}) as Record<string, unknown>;
    const field = (key: string, value: string | null): ReadInvoiceField => {
      const score = Number(confidence[key]);
      return {
        value,
        confidence:
          value === null || !Number.isFinite(score)
            ? 0
            : Math.min(1, Math.max(0, score)),
      };
    };

    return {
      payment_date: field('payment_date', this.date(raw.payment_date)),
      settled_amount: field('settled_amount', this.amount(raw.settled_amount)),
      settled_currency: field(
        'settled_currency',
        this.currency(raw.settled_currency),
      ),
      reference: field('reference', this.text(raw.reference, 200)),
      original_amount: field(
        'original_amount',
        this.amount(raw.original_amount),
      ),
      original_currency: field(
        'original_currency',
        this.currency(raw.original_currency),
      ),
      sender: field('sender', this.text(raw.sender, 200)),
      note: null,
    };
  }

  private text(value: unknown, max: number): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, max) : null;
  }

  private currency(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const code = value.trim().toUpperCase();
    return /^[A-Z]{3}$/.test(code) ? code : null;
  }

  private amount(value: unknown): string | null {
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value.replace(/[^0-9.-]/g, ''))
          : Number.NaN;
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return String(Math.round(numeric * 100) / 100);
  }

  private date(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const match = /^\d{4}-\d{2}-\d{2}$/.exec(value.trim());
    if (!match) return null;
    const parsed = new Date(`${value.trim()}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : value.trim();
  }
}
