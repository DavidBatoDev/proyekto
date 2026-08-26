import { BadRequestException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FinanceImportsService } from './finance-imports.service';
import { FinanceDocumentKind } from './dto/finance-imports.dto';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const INVOICE_ID = '33333333-3333-4333-8333-333333333333';
const PAYMENT_ID = '44444444-4444-4444-8444-444444444444';

const documentRow = {
  id: DOCUMENT_ID,
  project_id: PROJECT_ID,
  kind: 'invoice',
  file_path: 'finance_documents/user-1/1.pdf',
  file_name: 'YACHATDAC Invoice.pdf',
  mime_type: 'application/pdf',
  size_bytes: 1024,
  page_count: 1,
  extraction: {},
  extraction_status: 'ready',
  extraction_error: null,
  uploaded_by: 'user-1',
  created_at: '2026-08-20T00:00:00.000Z',
};

interface Writes {
  invoices: Array<Record<string, unknown>>;
  invoice_line_items: Array<Record<string, unknown>>;
  invoice_payments: Array<Record<string, unknown>>;
  invoice_events: Array<Record<string, unknown>>;
  finance_document_snips: Array<Record<string, unknown>>;
}

/**
 * Table-keyed stub in the shape of `team-finance-access.service.spec.ts`: each
 * builder records what was written and resolves the row the service reads back.
 */
function fakeSupabase(
  writes: Writes,
  document: Record<string, unknown> | null = documentRow,
): SupabaseClient {
  return {
    from(table: string) {
      let updated: Record<string, unknown> = {};
      const builder = {
        insert(payload: unknown) {
          const rows = Array.isArray(payload) ? payload : [payload];
          if (table in writes) {
            writes[table as keyof Writes].push(
              ...(rows as Array<Record<string, unknown>>),
            );
          }
          return builder;
        },
        upsert(payload: unknown) {
          return builder.insert(payload);
        },
        update(payload: Record<string, unknown>) {
          updated = payload;
          return builder;
        },
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({ data: document, error: null });
        },
        single() {
          if (table === 'finance_documents') {
            return Promise.resolve({
              data: { ...documentRow, ...updated },
              error: null,
            });
          }
          return Promise.resolve({
            data: { id: table === 'invoices' ? INVOICE_ID : PAYMENT_ID },
            error: null,
          });
        },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

function buildService(writes: Writes, document = documentRow as unknown) {
  return new FinanceImportsService(
    fakeSupabase(writes, document as Record<string, unknown> | null),
    { uploadFile: jest.fn(), getPrivateSignedUrl: jest.fn() } as never,
    { assertProjectFinanceActor: jest.fn() } as never,
    { refreshPaymentState: jest.fn() } as never,
    { extract: jest.fn() } as never,
    { read: jest.fn() } as never,
  );
}

function emptyWrites(): Writes {
  return {
    invoices: [],
    invoice_line_items: [],
    invoice_payments: [],
    invoice_events: [],
    finance_document_snips: [],
  };
}

const baseInvoice = {
  project_id: PROJECT_ID,
  source_document_id: DOCUMENT_ID,
  number: 'BS2026-DM-054',
  currency: 'AUD',
  total: 10000,
  issue_date: '2026-07-01',
  due_date: '2026-08-15',
};

describe('FinanceImportsService import', () => {
  it('books the invoice as issued and imported, against its document', async () => {
    const writes = emptyWrites();
    await buildService(writes).importInvoice('user-1', { ...baseInvoice });

    expect(writes.invoices[0]).toMatchObject({
      project_id: PROJECT_ID,
      number: 'BS2026-DM-054',
      currency: 'AUD',
      status: 'issued',
      origin: 'imported',
      source_document_id: DOCUMENT_ID,
      total: 10000,
    });
    // A committed import always says which document it was read from.
    expect(writes.invoice_events[0]).toMatchObject({
      event_type: 'created',
      data: expect.objectContaining({ origin: 'imported' }),
    });
  });

  it('records the settlement that actually landed, with its own rate', async () => {
    const writes = emptyWrites();
    await buildService(writes).importInvoice('user-1', {
      ...baseInvoice,
      payments: [
        {
          amount: 10000,
          payment_date: '2026-08-14',
          settled_currency: 'php',
          settled_amount: 421650,
          reference: 'NATAAU33033/033/NATAAU33/30',
        },
      ],
    });

    // 421,650 PHP for AUD 10,000 is the rate that transfer cleared at; it is
    // derived rather than assumed, and stored so a later rounding cannot move it.
    expect(writes.invoice_payments[0]).toMatchObject({
      amount: 10000,
      settled_currency: 'PHP',
      settled_amount: 421650,
      fx_rate: 42.165,
    });
  });

  it('derives a different rate for a different transfer', async () => {
    const writes = emptyWrites();
    await buildService(writes).importInvoice('user-1', {
      ...baseInvoice,
      number: 'BS2026-DM-053',
      total: 3840,
      payments: [
        {
          amount: 3840,
          payment_date: '2026-06-26',
          settled_currency: 'PHP',
          settled_amount: 158870.12,
        },
      ],
    });

    expect(writes.invoice_payments[0]).toMatchObject({ fx_rate: 41.372427 });
  });

  it('stores no settlement when the money arrived in the invoice currency', async () => {
    const writes = emptyWrites();
    await buildService(writes).importInvoice('user-1', {
      ...baseInvoice,
      payments: [
        {
          amount: 10000,
          payment_date: '2026-08-14',
          settled_currency: 'AUD',
          settled_amount: 10000,
        },
      ],
    });

    // Otherwise every domestic payment would carry a meaningless rate of 1.
    expect(writes.invoice_payments[0]).toMatchObject({
      settled_currency: null,
      settled_amount: null,
      fx_rate: null,
    });
  });

  it('refuses half a settlement', async () => {
    const writes = emptyWrites();
    await expect(
      buildService(writes).importInvoice('user-1', {
        ...baseInvoice,
        payments: [
          { amount: 10000, payment_date: '2026-08-14', settled_amount: 421650 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses lines that do not add up to the invoice total', async () => {
    const writes = emptyWrites();
    await expect(
      buildService(writes).importInvoice('user-1', {
        ...baseInvoice,
        lines: [
          { description: 'Branding guidelines', amount: 6000 },
          { description: 'Website build', amount: 3000 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(writes.invoices).toHaveLength(0);
  });

  it('falls back to a single line when the document had none to snip', async () => {
    const writes = emptyWrites();
    await buildService(writes).importInvoice('user-1', { ...baseInvoice });

    expect(writes.invoice_line_items).toHaveLength(1);
    expect(writes.invoice_line_items[0]).toMatchObject({ amount: 10000 });
  });

  it('refuses a document that belongs to another project', async () => {
    const writes = emptyWrites();
    const service = buildService(writes, {
      ...documentRow,
      project_id: 'another-project',
    });

    await expect(
      service.importInvoice('user-1', { ...baseInvoice }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clamps a snip that was dragged past the edge of the page', async () => {
    const writes = emptyWrites();
    await buildService(writes).importInvoice('user-1', {
      ...baseInvoice,
      snips: [
        {
          field_key: 'total',
          document_id: DOCUMENT_ID,
          page: 1,
          rect: { x: 0.8, y: 0.9, w: 0.5, h: 0.4 },
          value_text: 'AUD 10,000',
        },
      ],
    });

    // A rectangle running off the page would highlight nothing on re-render.
    expect(writes.finance_document_snips[0]).toMatchObject({
      invoice_id: INVOICE_ID,
      field_key: 'total',
      rect: { x: 0.8, y: 0.9, w: 0.2, h: 0.1 },
    });
  });
});

describe('FinanceImportsService documents', () => {
  it('marks an image as skipped rather than failed', async () => {
    const writes = emptyWrites();
    const service = buildService(writes, {
      ...documentRow,
      kind: FinanceDocumentKind.PaymentProof,
      mime_type: 'image/png',
    });

    const row = await service.readDocument('user-1', DOCUMENT_ID);

    // There is nothing wrong with a bank screenshot; it just has no text layer.
    expect(row.extraction_status).toBe('skipped');
  });
});
