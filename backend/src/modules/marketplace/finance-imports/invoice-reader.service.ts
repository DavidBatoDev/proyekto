import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';
/** The global request timeout is 25s; leave room for the PDF work around it. */
const TIMEOUT_MS = 18_000;
const MAX_INPUT_CHARS = 12_000;

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

const EMPTY_FIELD: ReadInvoiceField = { value: null, confidence: 0 };

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

  async read(plainText: string): Promise<ReadInvoiceFields> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY absent; returning an empty draft.');
      return emptyFields(
        'Automatic reading is unavailable, so nothing was pre-filled. Snip the fields from the document.',
      );
    }

    const text = plainText.slice(0, MAX_INPUT_CHARS).trim();
    if (!text) {
      return emptyFields(
        'No text layer was found in that file, so nothing was pre-filled. Snip the fields from the document.',
      );
    }

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
            {
              role: 'system',
              content: [
                'You read one invoice and return its header fields as JSON.',
                'Return exactly this shape:',
                '{"number":string|null,"currency":string|null,"total":number|null,',
                '"issue_date":string|null,"due_date":string|null,"client_name":string|null,',
                '"confidence":{"number":0..1,"currency":0..1,"total":0..1,"issue_date":0..1,"due_date":0..1,"client_name":0..1}}',
                'Dates are ISO (YYYY-MM-DD). Currency is a 3-letter ISO code.',
                'total is the grand total due, digits only, no separators or symbols.',
                'When a field is not present in the text, return null and confidence 0.',
                'Never invent a value that is not written in the document.',
              ].join(' '),
            },
            { role: 'user', content: text },
          ],
        }),
      });

      if (!response.ok) {
        this.logger.warn(`Invoice read failed: HTTP ${response.status}`);
        return emptyFields(
          'The document could not be read automatically. Snip the fields from it.',
        );
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) {
        return emptyFields('The reader returned nothing to pre-fill.');
      }
      return this.sanitize(JSON.parse(content) as Record<string, unknown>);
    } catch (error) {
      this.logger.warn(
        `Invoice read failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return emptyFields(
        'The document could not be read automatically. Snip the fields from it.',
      );
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
