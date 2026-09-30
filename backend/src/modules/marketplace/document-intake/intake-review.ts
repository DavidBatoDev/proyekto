/**
 * The pure rules of document intake: what a field's state is, when a
 * document may be confirmed, whether an invoice adds up, how documents group
 * into relationships and how a confirmed contract becomes contract terms.
 * (docs/13-proposals/document-intake.md)
 *
 * No I/O here, so every rule is unit-tested directly.
 */

export type IntakeDocType =
  | 'contract'
  | 'amendment'
  | 'invoice'
  | 'receipt'
  | 'proof_of_payment'
  | 'other';

/** The four review states, plus the person's "this document has no such field". */
export type FieldState =
  | 'read'
  | 'unsure'
  | 'needs_input'
  | 'corrected'
  | 'not_in_document';

export type FieldOrigin = 'ai' | 'snip' | 'typed';

export interface ReviewField {
  value: string | null;
  state: FieldState;
  origin: FieldOrigin;
  confidence: number;
  /** The model's reading, kept when a person changes the value. */
  ai_value: string | null;
  page: number | null;
  box: number[] | null;
}

export type ReviewFields = Record<string, ReviewField>;

export interface ExtractedFieldInput {
  value?: unknown;
  confidence?: number;
  page?: number | null;
  box?: number[] | null;
  status?: 'read' | 'unsure' | 'missing';
}

export const CONFIDENCE_THRESHOLD = 0.85;

function text(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const out = value.trim();
  return out ? out : null;
}

/** The review state of every field the model returned. */
export function reviewFieldsFromExtraction(
  fields: Record<string, ExtractedFieldInput>,
): ReviewFields {
  const out: ReviewFields = {};
  for (const [name, raw] of Object.entries(fields)) {
    const value = text(raw.value);
    const confidence = Math.max(0, Math.min(1, Number(raw.confidence ?? 0)));
    out[name] = {
      value,
      state:
        value === null
          ? 'needs_input'
          : confidence >= CONFIDENCE_THRESHOLD
            ? 'read'
            : 'unsure',
      origin: 'ai',
      confidence: value === null ? 0 : confidence,
      ai_value: value,
      page: typeof raw.page === 'number' ? raw.page : null,
      box: Array.isArray(raw.box) && raw.box.length === 4 ? raw.box : null,
    };
  }
  return out;
}

/** A person typed or fixed a value (or read it by drawing a box). */
export function correctField(
  field: ReviewField | undefined,
  value: string | null,
  origin: 'typed' | 'snip',
  location?: { page?: number | null; box?: number[] | null },
): ReviewField {
  const clean = text(value);
  return {
    value: clean,
    state: clean === null ? 'needs_input' : 'corrected',
    origin,
    confidence: clean === null ? 0 : 1,
    ai_value: field?.ai_value ?? null,
    page: location?.page ?? field?.page ?? null,
    box: location?.box ?? field?.box ?? null,
  };
}

/** The person accepts an Unsure reading as it stands. */
export function acceptField(field: ReviewField): ReviewField {
  if (field.value === null) return field;
  return { ...field, state: 'corrected' };
}

export function markNotInDocument(field: ReviewField | undefined): ReviewField {
  return {
    value: null,
    state: 'not_in_document',
    origin: 'typed',
    confidence: 0,
    ai_value: field?.ai_value ?? null,
    page: null,
    box: null,
  };
}

/** Fields that still block Confirm. */
export function blockingFields(fields: ReviewFields): string[] {
  return Object.entries(fields)
    .filter(([, f]) => f.state === 'unsure' || f.state === 'needs_input')
    .map(([name]) => name);
}

function amount(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Totals are checked, not trusted: line items must sum to the subtotal and
 * subtotal plus tax to the total. Returns the flags to show in review.
 */
export function invoiceTotalFlags(
  fields: ReviewFields,
  lineItems: Array<{ amount?: number | null }>,
): string[] {
  const flags: string[] = [];
  const subtotal = amount(fields.subtotal?.value);
  const tax = amount(fields.tax?.value) ?? 0;
  const total = amount(fields.total?.value);
  const lines = lineItems
    .map((line) => Number(line.amount))
    .filter((n) => Number.isFinite(n));
  const round = (n: number) => Math.round(n * 100) / 100;
  if (lines.length > 0 && subtotal !== null) {
    const sum = round(lines.reduce((a, b) => a + b, 0));
    if (Math.abs(sum - subtotal) > 0.01) {
      flags.push(`Line items add up to ${sum}, not the subtotal ${subtotal}.`);
    }
  }
  if (subtotal !== null && total !== null) {
    if (Math.abs(round(subtotal + tax) - total) > 0.01) {
      flags.push(
        `Subtotal ${subtotal} plus tax ${tax} is ${round(subtotal + tax)}, not the total ${total}.`,
      );
    }
  }
  return flags;
}

const LEGAL_SUFFIX =
  /\b(pty|ltd|limited|inc|incorporated|llc|corp|corporation|co|company|gmbh|plc|opc)\b\.?/g;

/** A name reduced to what two spellings of the same party share. */
export function normalizePartyName(name: string | null | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(LEGAL_SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface GroupableDocument {
  id: string;
  doc_type: IntakeDocType | null;
  fields: ReviewFields;
}

/**
 * The counterparty a document names: whichever side is not the importer.
 * `importerNames` are the importer's own names (profile, teams), normalized.
 */
export function counterpartyOf(
  doc: GroupableDocument,
  importerNames: string[],
): { name: string | null; email: string | null } {
  const v = (key: string) => doc.fields[key]?.value ?? null;
  const sides: Array<{ name: string | null; email: string | null }> =
    doc.doc_type === 'contract' || doc.doc_type === 'amendment'
      ? [
          { name: v('provider_name'), email: v('provider_email') },
          { name: v('client_name'), email: v('client_email') },
        ]
      : doc.doc_type === 'invoice'
        ? [
            { name: v('issuer'), email: null },
            { name: v('recipient'), email: null },
          ]
        : doc.doc_type === 'receipt' || doc.doc_type === 'proof_of_payment'
          ? [
              { name: v('payer'), email: null },
              { name: v('payee'), email: null },
            ]
          : [];
  const mine = new Set(importerNames.map(normalizePartyName).filter(Boolean));
  const isMine = (name: string | null) => {
    const n = normalizePartyName(name);
    return (
      Boolean(n) &&
      [...mine].some((m) => n === m || n.includes(m) || m.includes(n))
    );
  };
  const other = sides.find((side) => side.name && !isMine(side.name));
  return other ?? { name: null, email: null };
}

/**
 * Groups documents into relationships by counterparty. Returns the group key
 * (a normalized name) for each document; unmatched documents get null and
 * are left for the person to assign.
 */
export function groupByCounterparty(
  docs: GroupableDocument[],
  importerNames: string[],
): Map<string, { name: string; email: string | null; ids: string[] }> {
  const groups = new Map<
    string,
    { name: string; email: string | null; ids: string[] }
  >();
  for (const doc of docs) {
    const party = counterpartyOf(doc, importerNames);
    const key = normalizePartyName(party.name);
    if (!key) continue;
    const match =
      [...groups.keys()].find(
        (existing) => existing.includes(key) || key.includes(existing),
      ) ?? key;
    const group = groups.get(match) ?? {
      name: party.name as string,
      email: null,
      ids: [],
    };
    group.ids.push(doc.id);
    if (!group.email && party.email) group.email = party.email;
    groups.set(match, group);
  }
  return groups;
}

/**
 * Matches a payment to one of the invoices: by an invoice number the payment
 * mentions, else by the same amount and currency. Returns the invoice id and
 * the basis, or null.
 */
export function matchPaymentToInvoice(
  payment: GroupableDocument,
  invoices: GroupableDocument[],
): { invoice_id: string; basis: 'reference' | 'amount' } | null {
  const mentioned = (payment.fields.invoice_numbers?.value ?? '')
    .concat(' ', payment.fields.reference?.value ?? '')
    .toLowerCase();
  for (const invoice of invoices) {
    const number = invoice.fields.number?.value?.toLowerCase();
    if (number && mentioned.includes(number)) {
      return { invoice_id: invoice.id, basis: 'reference' };
    }
  }
  const paid = amount(payment.fields.amount?.value);
  const currency = payment.fields.currency?.value?.toUpperCase() ?? null;
  const byAmount = invoices.filter((invoice) => {
    const total = amount(invoice.fields.total?.value);
    const invoiceCurrency =
      invoice.fields.currency?.value?.toUpperCase() ?? null;
    return (
      paid !== null &&
      total !== null &&
      Math.abs(total - paid) <= 0.01 &&
      (!currency || !invoiceCurrency || currency === invoiceCurrency)
    );
  });
  return byAmount.length === 1
    ? { invoice_id: byAmount[0].id, basis: 'amount' }
    : null;
}

function isoDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^\d{4}-\d{2}-\d{2}/.exec(value.trim());
  return match ? match[0] : undefined;
}

function monthsBetween(start: string, end: string): number {
  const a = new Date(`${start}T00:00:00Z`);
  const b = new Date(`${end}T00:00:00Z`);
  const months =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    (b.getUTCMonth() - a.getUTCMonth()) +
    (b.getUTCDate() >= a.getUTCDate() ? 1 : 0);
  return Math.max(1, months);
}

const BILLING_MODES = ['fixed', 'retainer', 'time_based', 'hybrid'] as const;

/**
 * The contract terms a confirmed contract document transcribes to, with any
 * later confirmed amendments folded in: the latest amendment's terms govern
 * from its effective date, which becomes the recorded service start (an
 * adopted agreement can only be dated back to when those terms applied).
 */
export function contractTermsFromIntake(
  contract: ReviewFields,
  clauses: Array<{ number?: string; title?: string; body?: string }>,
  amendments: ReviewFields[] = [],
): {
  external_agreed_at: string | undefined;
  service_start_date: string | undefined;
  term_count: number;
  term_unit: 'month';
  currency?: string;
  billing_mode?: (typeof BILLING_MODES)[number];
  billing_timing?: 'advance' | 'arrears';
  recurring_fee?: number;
  client_hourly_rate?: number;
  fixed_fee?: number;
  due_days?: number;
  notice_days?: number;
  clauses: Array<{
    key: string;
    title: string;
    body: string;
    position: number;
  }>;
} {
  const v = (fields: ReviewFields, key: string) => fields[key]?.value ?? null;
  const ordered = [...amendments].sort((a, b) =>
    (isoDate(v(a, 'effective_date')) ?? '').localeCompare(
      isoDate(v(b, 'effective_date')) ?? '',
    ),
  );
  const pick = (key: string) => {
    for (const amendment of [...ordered].reverse()) {
      const value = v(amendment, key);
      if (value !== null) return value;
    }
    return v(contract, key);
  };

  const agreedAt = isoDate(v(contract, 'date_signed'));
  const latestEffective = isoDate(
    ordered.length ? v(ordered[ordered.length - 1], 'effective_date') : null,
  );
  const rootStart = isoDate(v(contract, 'service_start')) ?? agreedAt;
  const start =
    latestEffective && (!rootStart || latestEffective > rootStart)
      ? latestEffective
      : rootStart;
  const end = isoDate(v(contract, 'service_end'));
  const modeRaw = (pick('billing_mode') ?? '').toLowerCase();
  const mode = BILLING_MODES.find((m) => m === modeRaw);
  const rate = amount(pick('rate_amount'));
  const timing = (v(contract, 'billing_timing') ?? '').toLowerCase();
  const due = amount(v(contract, 'payment_terms_days'));
  const notice = amount(pick('notice_days'));
  const currency = pick('currency')?.toUpperCase();

  return {
    external_agreed_at: agreedAt,
    service_start_date: start,
    term_count: start && end && end > start ? monthsBetween(start, end) : 12,
    term_unit: 'month',
    ...(currency && /^[A-Z]{3}$/.test(currency) ? { currency } : {}),
    ...(mode ? { billing_mode: mode } : {}),
    ...(timing === 'advance' || timing === 'arrears'
      ? { billing_timing: timing }
      : {}),
    ...(rate !== null && mode === 'retainer' ? { recurring_fee: rate } : {}),
    ...(rate !== null && (mode === 'time_based' || mode === 'hybrid')
      ? { client_hourly_rate: rate }
      : {}),
    ...(rate !== null && mode === 'fixed' ? { fixed_fee: rate } : {}),
    ...(due !== null && due >= 0 && due <= 365
      ? { due_days: Math.round(due) }
      : {}),
    ...(notice !== null && notice >= 0 && notice <= 365
      ? { notice_days: Math.round(notice) }
      : {}),
    clauses: clauses
      .filter((clause) => (clause.body ?? '').trim())
      .map((clause, index) => ({
        key: `intake_${index + 1}`,
        title:
          [clause.number, clause.title].filter(Boolean).join(' ').trim() ||
          `Clause ${index + 1}`,
        body: (clause.body ?? '').trim(),
        position: index,
      })),
  };
}

/** Pages a set of documents costs: the pages each one covers. */
export function pagesOf(
  docs: Array<{ page_start: number; page_end: number; status?: string }>,
): number {
  return docs
    .filter((doc) => doc.status !== 'skipped')
    .reduce((sum, doc) => sum + (doc.page_end - doc.page_start + 1), 0);
}

/**
 * The quota rule: every workspace gets `onboarding` pages once, then
 * `monthly` pages a month. `usedEver` includes `usedThisMonth`. Null limits
 * are unlimited. Returns the pages that count against the monthly quota
 * before and after the upload.
 */
export function chargeablePages(input: {
  usedEver: number;
  usedThisMonth: number;
  adding: number;
  onboarding: number | null;
}): { used: number; adding: number; unlimited: boolean } {
  if (input.onboarding === null) {
    return { used: 0, adding: 0, unlimited: true };
  }
  const beforeMonth = Math.max(0, input.usedEver - input.usedThisMonth);
  const remainingAtMonthStart = Math.max(0, input.onboarding - beforeMonth);
  const used = Math.max(0, input.usedThisMonth - remainingAtMonthStart);
  const after = Math.max(
    0,
    input.usedThisMonth + input.adding - remainingAtMonthStart,
  );
  return { used, adding: after - used, unlimited: false };
}
