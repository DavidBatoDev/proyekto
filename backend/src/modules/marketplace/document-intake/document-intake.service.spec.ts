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

  const amendmentJune = documentRow({
    id: 'a-june',
    status: 'confirmed',
    doc_type: 'amendment',
    relationship_id: 'rel-1',
    fields: reviewFieldsFromExtraction({
      effective_date: { value: '2026-06-01', confidence: 1 },
      date_signed: { value: '2026-05-20', confidence: 1 },
      rate_amount: { value: '1200', confidence: 1 },
    }),
  });
  const amendmentSeptember = documentRow({
    id: 'a-sep',
    status: 'confirmed',
    doc_type: 'amendment',
    relationship_id: 'rel-1',
    fields: reviewFieldsFromExtraction({
      effective_date: { value: '2026-09-01', confidence: 1 },
      rate_amount: { value: '1500', confidence: 1 },
    }),
  });

  function harness(
    rel: IntakeRelationshipRow = relationship,
    docs = [contractDoc, invoiceDoc, paymentDoc],
    reply?: (call: {
      table: string;
      op: string;
      filters: unknown[][];
    }) => { data: unknown; error: null } | undefined,
  ) {
    const { client, calls } = fakeSupabase(
      (call) =>
        reply?.(call) ??
        (call.table === 'finance_documents'
          ? {
              data: { id: `fd-${call.filters.length}-${Math.random()}` },
              error: null,
            }
          : call.table === 'projects'
            ? { data: { currency: 'AUD' }, error: null }
            : { data: null, error: null }),
    );
    const intake = {
      requireRelationship: jest.fn().mockResolvedValue(rel),
      requireBatch: jest.fn().mockResolvedValue(BATCH),
      batchDocuments: jest.fn().mockResolvedValue(docs),
      batchRelationships: jest.fn().mockResolvedValue([rel]),
      patchDocument: jest.fn().mockResolvedValue({}),
    };
    const contracts = {
      recordExternalAgreement: jest
        .fn()
        .mockResolvedValue({ id: 'contract-9' }),
      sendContract: jest.fn().mockResolvedValue({}),
      assertAdoptionHolder: jest.fn().mockResolvedValue(undefined),
    };
    const projects = {
      createProject: jest
        .fn()
        .mockResolvedValue({ project: { id: 'project-new' } }),
      updateProject: jest.fn().mockResolvedValue({}),
      inviteByEmail: jest.fn().mockResolvedValue({ id: 'invite-1' }),
      onInviteAccepted: jest.fn(),
    };
    const financeImports = {
      importInvoice: jest.fn().mockResolvedValue({ invoice_id: 'invoice-9' }),
    };
    const service = new IntakeReplicateService(
      client,
      intake as never,
      contracts as never,
      financeImports as never,
      projects as never,
    );
    return { service, intake, contracts, financeImports, projects, calls };
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
      [],
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

  it('holds the agreement for a counterparty with no account, invites them, and still imports the money', async () => {
    const { service, contracts, financeImports, projects } = harness({
      ...relationship,
      counterparty_user_id: null,
    });

    const result = await service.replicate('user-1', 'rel-1');

    expect(contracts.recordExternalAgreement).not.toHaveBeenCalled();
    // Invite first: the project invite is also the attestation request.
    expect(projects.inviteByEmail).toHaveBeenCalledWith(
      'project-1',
      'user-1',
      expect.objectContaining({
        email: 'ap@yachatdac.com',
        message: expect.stringMatching(/confirm our agreement/),
      }),
    );
    expect(result.pending_agreement).toMatchObject({
      email: 'ap@yachatdac.com',
      invite_id: 'invite-1',
      importer_id: 'user-1',
      contract_document_id: 'c',
    });
    expect(result.outcomes.find((o) => o.document_id === 'c')).toMatchObject({
      pending: 'Waiting for Yachatdac to join',
    });
    expect(financeImports.importInvoice).toHaveBeenCalled();
  });

  it('records the held agreement when the invited email joins, and asks them to attest', async () => {
    const pending = {
      email: 'ap@yachatdac.com',
      name: 'Yachatdac',
      invite_id: 'invite-1',
      importer_id: 'user-1',
      contract_document_id: 'c',
      amendment_document_ids: [],
      since: '2026-09-30T00:00:00Z',
    };
    const held = {
      ...relationship,
      counterparty_user_id: null,
      replicated: { pending_agreement: pending },
    };
    const withFinance = {
      ...contractDoc,
      replicated_record: { finance_document_id: 'fd-c' },
    };
    const { service, contracts, calls } = harness(
      held,
      [withFinance, invoiceDoc, paymentDoc],
      (call) =>
        call.table === 'intake_relationships' && call.op === 'select'
          ? { data: [held], error: null }
          : call.table === 'profiles'
            ? { data: { email: 'ap@yachatdac.com' }, error: null }
            : call.table === 'intake_batches'
              ? { data: { importer_capacity: 'consultant' }, error: null }
              : undefined,
    );

    await service.completePendingAgreements('client-new', 'project-1');

    expect(contracts.recordExternalAgreement).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        counterparty_user_id: 'client-new',
        external_document_id: 'fd-c',
      }),
      [],
    );
    // Recording sends it: the new account is asked to attest.
    expect(contracts.sendContract).toHaveBeenCalledWith('user-1', 'contract-9');
    const cleared = calls.find(
      (call) => call.table === 'intake_relationships' && call.op === 'update',
    );
    expect(cleared?.payload).toMatchObject({
      counterparty_user_id: 'client-new',
      replicated: expect.objectContaining({
        contract_id: 'contract-9',
        pending_agreement: null,
      }),
    });
  });

  it('ignores a join by a different email', async () => {
    const held = {
      ...relationship,
      counterparty_user_id: null,
      replicated: {
        pending_agreement: {
          email: 'ap@yachatdac.com',
          name: null,
          invite_id: null,
          importer_id: 'user-1',
          contract_document_id: 'c',
          amendment_document_ids: [],
          since: '',
        },
      },
    };
    const { service, contracts } = harness(held, undefined, (call) =>
      call.table === 'intake_relationships' && call.op === 'select'
        ? { data: [held], error: null }
        : call.table === 'profiles'
          ? { data: { email: 'someone@else.test' }, error: null }
          : undefined,
    );
    await service.completePendingAgreements('other', 'project-1');
    expect(contracts.recordExternalAgreement).not.toHaveBeenCalled();
  });

  it('refuses to record when the consultant seat is not a verified team owner', async () => {
    const { service, contracts } = harness();
    contracts.assertAdoptionHolder.mockRejectedValue(
      new Error(
        'Dev must be a verified consultant to hold a recorded agreement.',
      ),
    );

    const result = await service.replicate('user-1', 'rel-1');

    expect(contracts.assertAdoptionHolder).toHaveBeenCalledWith('user-1');
    expect(contracts.recordExternalAgreement).not.toHaveBeenCalled();
    expect(result.outcomes.find((o) => o.document_id === 'c')?.error).toMatch(
      /verified consultant/,
    );
  });

  it('checks the consultant counterparty when a client imports', async () => {
    const { service, contracts, intake } = harness();
    intake.requireBatch.mockResolvedValue({
      ...BATCH,
      importer_capacity: 'client',
    });
    await service.replicate('user-1', 'rel-1');
    expect(contracts.assertAdoptionHolder).toHaveBeenCalledWith('client-1');
  });

  it('records each past amendment as its own version, oldest first, not folded in', async () => {
    const { service, contracts } = harness(relationship, [
      contractDoc,
      amendmentSeptember,
      amendmentJune,
      invoiceDoc,
      paymentDoc,
    ]);

    await service.replicate('user-1', 'rel-1');

    const [, dto, queue] = contracts.recordExternalAgreement.mock.calls[0];
    // The original is recorded as signed: its own rate, not the latest.
    expect(dto).toMatchObject({ recurring_fee: 1000 });
    expect(queue).toEqual([
      expect.objectContaining({
        effective_from: '2026-06-01',
        agreed_at: '2026-05-20',
        terms: { recurring_fee: 1200 },
      }),
      expect.objectContaining({
        effective_from: '2026-09-01',
        agreed_at: '2026-09-01',
        terms: { recurring_fee: 1500 },
      }),
    ]);
  });

  describe("project currency is the person's choice", () => {
    const usdProject = (call: { table: string }) =>
      call.table === 'projects'
        ? { data: { currency: 'USD' }, error: null as null }
        : undefined;

    it('asks before writing anything when the documents are in another currency', async () => {
      const { service, contracts, financeImports, projects, calls } = harness(
        relationship,
        [invoiceDoc],
        usdProject,
      );
      await expect(service.replicate('user-1', 'rel-1')).rejects.toThrow(
        'The documents are in AUD; the project is in USD. Choose whether to set the project currency to AUD or keep USD.',
      );
      expect(projects.updateProject).not.toHaveBeenCalled();
      expect(financeImports.importInvoice).not.toHaveBeenCalled();
      expect(contracts.recordExternalAgreement).not.toHaveBeenCalled();
      expect(calls.some((call) => call.op === 'insert')).toBe(false);
    });

    it("sets the project currency only when the person picks the documents' currency", async () => {
      const { service, projects, calls } = harness(
        relationship,
        [invoiceDoc],
        usdProject,
      );
      await service.replicate('user-1', 'rel-1', { project_currency: 'aud' });
      expect(projects.updateProject).toHaveBeenCalledWith(
        'project-1',
        'user-1',
        { currency: 'AUD' },
      );
      const saved = calls.find(
        (call) => call.table === 'intake_relationships' && call.op === 'update',
      )?.payload as { replicated: Record<string, unknown> };
      expect(saved.replicated.currency_decision).toEqual({
        project_currency: 'AUD',
        document_currencies: ['AUD'],
      });
    });

    it('keeps the project currency when the person says so', async () => {
      const { service, projects, financeImports } = harness(
        relationship,
        [invoiceDoc],
        usdProject,
      );
      await service.replicate('user-1', 'rel-1', { project_currency: 'USD' });
      expect(projects.updateProject).not.toHaveBeenCalled();
      expect(financeImports.importInvoice).toHaveBeenCalled();
    });

    it('does not ask again once the same currencies were decided', async () => {
      const { service, projects } = harness(
        {
          ...relationship,
          replicated: {
            currency_decision: {
              project_currency: 'USD',
              document_currencies: ['AUD'],
            },
          },
        },
        [invoiceDoc],
        usdProject,
      );
      await expect(service.replicate('user-1', 'rel-1')).resolves.toBeTruthy();
      expect(projects.updateProject).not.toHaveBeenCalled();
    });

    it('a new project takes the confirmed currency, never a guessed one', async () => {
      const newGroup = { ...relationship, project_id: null };
      const first = harness(newGroup, [invoiceDoc]);
      await expect(first.service.replicate('user-1', 'rel-1')).rejects.toThrow(
        'a new project defaults to USD. Confirm the project currency (AUD or USD)',
      );
      expect(first.projects.createProject).not.toHaveBeenCalled();

      const second = harness(newGroup, [invoiceDoc]);
      await second.service.replicate('user-1', 'rel-1', {
        project_currency: 'AUD',
      });
      expect(second.projects.createProject).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ currency: 'AUD' }),
      );
      expect(second.projects.updateProject).not.toHaveBeenCalled();
    });

    it('refuses a currency that was not one of the choices', async () => {
      const { service } = harness(relationship, [invoiceDoc], usdProject);
      await expect(
        service.replicate('user-1', 'rel-1', { project_currency: 'EUR' }),
      ).rejects.toThrow('Choose AUD or USD for the project currency.');
    });
  });

  it('will not run before the group is confirmed', async () => {
    const { service } = harness({ ...relationship, status: 'proposed' });
    await expect(service.replicate('user-1', 'rel-1')).rejects.toThrow(
      /Confirm the counterparty/,
    );
  });
});

describe('DocumentIntakeService: the counterparty name is the person’s to edit', () => {
  const relationship: IntakeRelationshipRow = {
    id: 'rel-1',
    batch_id: 'batch-1',
    counterparty_name: 'PRODIGITALITY',
    counterparty_email: null,
    counterparty_user_id: null,
    relationship_kind: 'client_services',
    project_id: null,
    project_title: null,
    status: 'proposed',
    replicated: {},
    created_at: '2026-09-30T00:00:00Z',
    updated_at: '2026-09-30T00:00:00Z',
  };
  const invoice = (id: string, relationshipId: string | null) =>
    documentRow({
      id,
      doc_type: 'invoice',
      status: 'extracted',
      relationship_id: relationshipId,
      fields: reviewFieldsFromExtraction({
        issuer: { value: 'PRODIGITALITY', confidence: 1 },
        recipient: { value: 'First Nations Action Network', confidence: 1 },
      }),
    });

  it('saves the edited name, tidied, and refuses a blank one', async () => {
    const { service, calls } = build({
      reply: (call) =>
        call.table === 'intake_relationships'
          ? call.op === 'update'
            ? {
                data: { ...relationship, ...(call.payload as object) },
                error: null,
              }
            : {
                data: { ...relationship, batch: BATCH },
                error: null,
              }
          : undefined,
    });
    const saved = await service.updateRelationship('user-1', 'rel-1', {
      counterparty_name: '  First Nations   Action Network ',
    });
    expect(saved.counterparty_name).toBe('First Nations Action Network');
    expect(
      calls.find(
        (call) => call.table === 'intake_relationships' && call.op === 'update',
      )?.payload,
    ).toMatchObject({ counterparty_name: 'First Nations Action Network' });
    await expect(
      service.updateRelationship('user-1', 'rel-1', {
        counterparty_name: '   ',
      }),
    ).rejects.toThrow('Name the other party.');
  });

  it('regrouping keeps documents in the group the person renamed', async () => {
    const renamed = { ...relationship, counterparty_name: 'FNAN' };
    const { service, calls } = build({
      reply: (call) => {
        if (call.table === 'intake_documents' && call.op === 'select') {
          return {
            data: [invoice('i1', 'rel-1'), invoice('i2', null)],
            error: null,
          };
        }
        if (call.table === 'intake_relationships' && call.op === 'select') {
          return { data: [renamed], error: null };
        }
        if (call.table === 'teams') {
          return {
            data: [{ name: 'JC Studio', legal_name: null }],
            error: null,
          };
        }
        return undefined;
      },
    });
    await service.group('user-1', 'batch-1');
    expect(
      calls.some(
        (call) => call.table === 'intake_relationships' && call.op === 'insert',
      ),
    ).toBe(false);
    const assign = calls.find(
      (call) => call.table === 'intake_documents' && call.op === 'update',
    );
    expect(assign?.payload).toEqual({ relationship_id: 'rel-1' });
  });

  it('suggests the team name when the paper names the importer differently', async () => {
    const { service } = build({
      reply: (call) => {
        if (call.table === 'intake_documents' && call.op === 'select') {
          return { data: [invoice('i1', 'rel-1')], error: null };
        }
        if (call.table === 'intake_relationships' && call.op === 'select') {
          return { data: [relationship], error: null };
        }
        if (call.table === 'teams') {
          return {
            data: [{ name: 'JC Studio', legal_name: null }],
            error: null,
          };
        }
        return undefined;
      },
    });
    const batch = await service.getBatch('user-1', 'batch-1');
    expect(batch.relationships[0].party_check).toEqual({
      read_name: 'PRODIGITALITY',
      team_name: 'JC Studio',
      matches: false,
    });
  });
});
