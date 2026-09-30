import { ConflictException, NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DocumentIntakeService,
  type IntakeBatchRow,
  type IntakeDocumentRow,
  type IntakeRelationshipRow,
} from './document-intake.service';
import { IntakeReplicateService } from './intake-replicate.service';
import { reviewFieldsFromExtraction } from './intake-review';

type Op = 'select' | 'insert' | 'update' | 'delete';
type Call = { table: string; op: Op; payload?: unknown; filters: unknown[][] };
type Reply = {
  data: unknown;
  error: { message: string } | null;
  count?: number;
};

function fakeSupabase(reply: (call: Call) => Reply) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: 'select', filters: [] };
    const builder: Record<string, unknown> = {};
    const chain =
      (name: string) =>
      (...args: unknown[]) => {
        if (name === 'insert' || name === 'update' || name === 'delete') {
          call.op = name;
          call.payload = args[0];
        } else if (name !== 'select') {
          call.filters.push([name, ...args]);
        }
        return builder;
      };
    for (const name of [
      'select',
      'insert',
      'update',
      'delete',
      'eq',
      'neq',
      'in',
      'is',
      'not',
      'order',
      'limit',
      'gt',
      'gte',
    ]) {
      builder[name] = chain(name);
    }
    const settle = () => {
      calls.push(call);
      return Promise.resolve(reply(call));
    };
    builder.single = settle;
    builder.maybeSingle = settle;
    builder.then = (resolve: (v: Reply) => void, reject: () => void) =>
      settle().then(resolve, reject);
    return builder;
  };
  return {
    client: { from: jest.fn(from) } as unknown as SupabaseClient,
    calls,
  };
}

const BATCH: IntakeBatchRow = {
  id: 'batch-1',
  workspace_id: 'ws-1',
  created_by: 'user-1',
  importer_capacity: 'consultant',
  status: 'open',
  created_at: '2026-09-30T00:00:00Z',
  updated_at: '2026-09-30T00:00:00Z',
};

function documentRow(
  overrides: Partial<IntakeDocumentRow> = {},
): IntakeDocumentRow {
  return {
    id: 'doc-1',
    batch_id: 'batch-1',
    file_path: 'intake/batch-1/x.pdf',
    file_name: 'scan.pdf',
    mime_type: 'application/pdf',
    size_bytes: 10,
    file_sha256: 'a'.repeat(64),
    page_count: 6,
    page_start: 1,
    page_end: 6,
    doc_type: null,
    language: null,
    extraction: {},
    confidence: {},
    fields: {},
    flags: [],
    relationship_id: null,
    duplicate_of: null,
    status: 'uploaded',
    replicated_record: {},
    created_at: '2026-09-30T00:00:00Z',
    updated_at: '2026-09-30T00:00:00Z',
    ...overrides,
  };
}

function build(options: {
  document?: IntakeDocumentRow;
  reply?: (call: Call) => Reply | undefined;
  agent?: Record<string, jest.Mock>;
  entitlements?: Record<string, jest.Mock>;
}) {
  const document = options.document ?? documentRow();
  const { client, calls } = fakeSupabase((call) => {
    const custom = options.reply?.(call);
    if (custom) return custom;
    if (call.table === 'intake_batches') return { data: BATCH, error: null };
    if (call.table === 'intake_documents' && call.op === 'select') {
      return { data: document, error: null };
    }
    if (call.table === 'intake_documents') {
      return {
        data: { ...document, ...(call.payload as object) },
        error: null,
      };
    }
    return { data: null, error: null };
  });
  const uploads = {
    putPrivateObject: jest.fn().mockResolvedValue({}),
    getPrivateObject: jest.fn().mockResolvedValue(Buffer.from('%PDF-')),
  };
  const agent = { isConfigured: true, post: jest.fn(), ...options.agent };
  const pdf = { extract: jest.fn().mockResolvedValue({ pageCount: 3 }) };
  const service = new DocumentIntakeService(
    client,
    uploads as never,
    agent as never,
    pdf as never,
    options.entitlements as never,
  );
  return { service, calls, uploads, agent };
}

describe('DocumentIntakeService', () => {
  it('keeps an intake private to whoever started it', async () => {
    const { service } = build({});
    await expect(
      service.getBatch('someone-else', 'batch-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('flags a file already imported and does not store or read it again', async () => {
    const assertCountedLimit = jest.fn();
    const { service, uploads, calls } = build({
      entitlements: {
        getLimit: jest.fn().mockResolvedValue(30),
        assertCountedLimit,
      },
      reply: (call) => {
        if (
          call.table === 'intake_documents' &&
          call.op === 'select' &&
          call.filters.some((f) => f[0] === 'eq' && f[1] === 'file_sha256')
        ) {
          return {
            data: [
              {
                id: 'old',
                batch: { created_by: 'user-1', workspace_id: 'ws-1' },
              },
            ],
            error: null,
          };
        }
        if (call.table === 'intake_documents' && call.op === 'select') {
          return { data: [], error: null };
        }
        return undefined;
      },
    });

    const [row] = await service.uploadFiles('user-1', 'batch-1', [
      {
        originalname: 'a.pdf',
        mimetype: 'application/pdf',
        size: 5,
        buffer: Buffer.from('%PDF-x'),
      },
    ]);

    expect(uploads.putPrivateObject).not.toHaveBeenCalled();
    const insert = calls.find(
      (call) => call.table === 'intake_documents' && call.op === 'insert',
    );
    expect(insert?.payload).toEqual(
      expect.objectContaining({ status: 'skipped', duplicate_of: 'old' }),
    );
    expect(row.status).toBe('skipped');
    // A skipped duplicate costs no pages.
    expect(assertCountedLimit).not.toHaveBeenCalled();
  });

  it('counts pages, not files, against the intake quota', async () => {
    const assertCountedLimit = jest.fn().mockResolvedValue(undefined);
    const { service, uploads } = build({
      entitlements: {
        getLimit: jest.fn().mockResolvedValue(0),
        assertCountedLimit,
      },
      reply: (call) =>
        call.table === 'intake_documents' && call.op === 'select'
          ? { data: [], error: null }
          : undefined,
    });

    await service.uploadFiles('user-1', 'batch-1', [
      {
        originalname: 'a.pdf',
        mimetype: 'application/pdf',
        size: 5,
        buffer: Buffer.from('%PDF-a'),
      },
      {
        originalname: 'b.png',
        mimetype: 'image/png',
        size: 5,
        buffer: Buffer.from('png'),
      },
    ]);

    expect(assertCountedLimit).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', exempt: false },
      'document_intake_pages_monthly',
      { used: 0, adding: 4, context: 'write' },
    );
    expect(uploads.putPrivateObject).toHaveBeenCalledTimes(2);
  });

  it('splits one scan into the documents the model detected', async () => {
    const post = jest.fn().mockResolvedValue({
      model: 'm',
      documents: [
        {
          doc_type: 'contract',
          page_start: 1,
          page_end: 4,
          language: 'en',
          confidence: 0.9,
        },
        {
          doc_type: 'invoice',
          page_start: 5,
          page_end: 6,
          language: 'en',
          confidence: 0.9,
        },
      ],
    });
    const { service, calls } = build({ agent: { post } });

    const rows = await service.classify('user-1', 'doc-1');

    expect(rows).toHaveLength(2);
    expect(post).toHaveBeenCalledWith(
      '/intake/classify',
      expect.objectContaining({
        mime_type: 'application/pdf',
        file_data_url: expect.stringMatching(/^data:application\/pdf;base64,/),
        page_count: 6,
      }),
      expect.any(Object),
    );
    const inserted = calls.find(
      (call) => call.table === 'intake_documents' && call.op === 'insert',
    );
    expect(inserted?.payload).toEqual(
      expect.objectContaining({
        doc_type: 'invoice',
        page_start: 5,
        page_end: 6,
      }),
    );
  });

  it('flags a document in another language instead of extracting it', async () => {
    const post = jest.fn();
    const { service } = build({
      agent: { post },
      document: documentRow({
        status: 'classified',
        doc_type: 'invoice',
        language: 'fil',
      }),
    });

    const row = await service.extract('user-1', 'doc-1');

    expect(post).not.toHaveBeenCalled();
    expect(row.flags[0]).toMatch(/not in English/);
  });

  it('will not confirm while a field is Unsure or Needs input', async () => {
    const fields = reviewFieldsFromExtraction({
      number: { value: 'INV-1', confidence: 0.99 },
      total: { value: '10', confidence: 0.5 },
    });
    const { service } = build({
      document: documentRow({
        status: 'extracted',
        doc_type: 'invoice',
        language: 'en',
        fields,
      }),
    });
    await expect(service.confirm('user-1', 'doc-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('confirms once every field is read, corrected or marked absent', async () => {
    const fields = reviewFieldsFromExtraction({
      number: { value: 'INV-1', confidence: 0.99 },
    });
    const { service } = build({
      document: documentRow({
        status: 'extracted',
        doc_type: 'invoice',
        language: 'en',
        fields,
      }),
    });
    const row = await service.confirm('user-1', 'doc-1');
    expect(row.status).toBe('confirmed');
  });
});

describe('IntakeReplicateService', () => {
  const relationship: IntakeRelationshipRow = {
    id: 'rel-1',
    batch_id: 'batch-1',
    counterparty_name: 'Yachatdac',
    counterparty_email: 'ap@yachatdac.com',
    counterparty_user_id: 'client-1',
    relationship_kind: 'client_services',
    project_id: 'project-1',
    project_title: null,
    status: 'confirmed',
    replicated: {},
    created_at: '',
    updated_at: '',
  };
  const contractDoc = documentRow({
    id: 'c',
    status: 'confirmed',
    doc_type: 'contract',
    relationship_id: 'rel-1',
    fields: reviewFieldsFromExtraction({
      date_signed: { value: '2026-01-10', confidence: 1 },
      billing_mode: { value: 'retainer', confidence: 1 },
      rate_amount: { value: '1000', confidence: 1 },
      currency: { value: 'AUD', confidence: 1 },
    }),
  });
  const invoiceDoc = documentRow({
    id: 'i',
    status: 'confirmed',
    doc_type: 'invoice',
    relationship_id: 'rel-1',
    fields: reviewFieldsFromExtraction({
      number: { value: 'INV-7', confidence: 1 },
      total: { value: '1000', confidence: 1 },
      currency: { value: 'AUD', confidence: 1 },
      issue_date: { value: '2026-02-01', confidence: 1 },
    }),
  });
  const paymentDoc = documentRow({
    id: 'p',
    status: 'confirmed',
    doc_type: 'receipt',
    relationship_id: 'rel-1',
    extraction: { match: { invoice_id: 'i', basis: 'reference' } },
    fields: reviewFieldsFromExtraction({
      amount: { value: '1000', confidence: 1 },
      currency: { value: 'AUD', confidence: 1 },
      payment_date: { value: '2026-02-10', confidence: 1 },
    }),
  });

  function harness(rel: IntakeRelationshipRow = relationship) {
    const { client } = fakeSupabase((call) =>
      call.table === 'finance_documents'
        ? { data: { id: `fd-${Math.random()}` }, error: null }
        : { data: null, error: null },
    );
    const intake = {
      requireRelationship: jest.fn().mockResolvedValue(rel),
      requireBatch: jest.fn().mockResolvedValue(BATCH),
      batchDocuments: jest
        .fn()
        .mockResolvedValue([contractDoc, invoiceDoc, paymentDoc]),
      batchRelationships: jest.fn().mockResolvedValue([rel]),
      patchDocument: jest.fn().mockResolvedValue({}),
    };
    const contracts = {
      recordExternalAgreement: jest
        .fn()
        .mockResolvedValue({ id: 'contract-9' }),
      sendContract: jest.fn().mockResolvedValue({}),
    };
    const financeImports = {
      importInvoice: jest.fn().mockResolvedValue({ invoice_id: 'invoice-9' }),
    };
    const service = new IntakeReplicateService(
      client,
      intake as never,
      contracts as never,
      financeImports as never,
      { createProject: jest.fn() } as never,
    );
    return { service, intake, contracts, financeImports };
  }

  it('records the agreement for attestation and imports invoices with their payments', async () => {
    const { service, contracts, financeImports } = harness();

    const result = await service.replicate('user-1', 'rel-1');

    expect(contracts.recordExternalAgreement).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        project_id: 'project-1',
        counterparty_user_id: 'client-1',
        external_agreed_at: '2026-01-10',
        recurring_fee: 1000,
        author_capacity: 'consultant',
      }),
    );
    // Sent at once: the counterparty is asked to attest.
    expect(contracts.sendContract).toHaveBeenCalledWith('user-1', 'contract-9');
    expect(financeImports.importInvoice).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        number: 'INV-7',
        total: 1000,
        payments: [
          expect.objectContaining({ amount: 1000, payment_date: '2026-02-10' }),
        ],
      }),
    );
    expect(result.outcomes.every((o) => o.created)).toBe(true);
  });

  it('cannot record against a counterparty with no account, but still imports the money', async () => {
    const { service, contracts, financeImports } = harness({
      ...relationship,
      counterparty_user_id: null,
    });

    const result = await service.replicate('user-1', 'rel-1');

    expect(contracts.recordExternalAgreement).not.toHaveBeenCalled();
    expect(result.outcomes.find((o) => o.document_id === 'c')?.error).toMatch(
      /no Proyekto account/,
    );
    expect(financeImports.importInvoice).toHaveBeenCalled();
  });

  it('will not run before the group is confirmed', async () => {
    const { service } = harness({ ...relationship, status: 'proposed' });
    await expect(service.replicate('user-1', 'rel-1')).rejects.toThrow(
      /Confirm the counterparty/,
    );
  });
});
