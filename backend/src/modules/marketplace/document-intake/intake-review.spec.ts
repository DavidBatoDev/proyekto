import { normalizeRanges } from './document-intake.service';
import {
  acceptField,
  blockingFields,
  chargeablePages,
  contractTermsFromIntake,
  correctField,
  currencyQuestion,
  documentCurrencies,
  counterpartyOf,
  groupByCounterparty,
  importerSideCheck,
  invoiceTotalFlags,
  markNotInDocument,
  matchPaymentToInvoice,
  normalizePartyName,
  type ReviewFields,
  reviewFieldsFromExtraction,
} from './intake-review';

const fields = (values: Record<string, string | null>): ReviewFields =>
  reviewFieldsFromExtraction(
    Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, { value: v, confidence: 1 }]),
    ),
  );

describe('review states', () => {
  it('reads, flags as unsure, or asks for input', () => {
    const out = reviewFieldsFromExtraction({
      a: {
        value: 'Yachatdac Pty Ltd',
        confidence: 0.97,
        page: 1,
        box: [0, 0, 1, 1],
      },
      b: { value: '30', confidence: 0.62 },
      c: { value: null, confidence: 0.9 },
    });
    expect(out.a.state).toBe('read');
    expect(out.b.state).toBe('unsure');
    expect(out.c.state).toBe('needs_input');
    expect(out.c.confidence).toBe(0);
    expect(blockingFields(out).sort()).toEqual(['b', 'c']);
  });

  it('keeps the model reading when a person corrects a value', () => {
    const [read] = Object.values(
      reviewFieldsFromExtraction({ x: { value: '3/?/26', confidence: 0.3 } }),
    );
    const typed = correctField(read, '2026-03-02', 'typed');
    expect(typed).toEqual(
      expect.objectContaining({
        value: '2026-03-02',
        state: 'corrected',
        origin: 'typed',
        ai_value: '3/?/26',
      }),
    );
    expect(acceptField(read).state).toBe('corrected');
    expect(markNotInDocument(read).state).toBe('not_in_document');
    expect(blockingFields({ x: markNotInDocument(read), y: typed })).toEqual(
      [],
    );
  });
});

describe('invoice totals are checked, not trusted', () => {
  it('flags lines that miss the subtotal and a total that misses subtotal plus tax', () => {
    const flags = invoiceTotalFlags(
      fields({ subtotal: '100', tax: '10', total: '120' }),
      [{ amount: 60 }, { amount: 30 }],
    );
    expect(flags).toHaveLength(2);
    expect(
      invoiceTotalFlags(fields({ subtotal: '90', tax: '10', total: '100' }), [
        { amount: 60 },
        { amount: 30 },
      ]),
    ).toEqual([]);
  });
});

describe('grouping', () => {
  const importer = ['August Consulting'];
  it('finds the counterparty as the side that is not the importer', () => {
    const doc = {
      id: 'c1',
      doc_type: 'contract' as const,
      fields: fields({
        provider_name: 'August Consulting',
        client_name: 'Yachatdac Pty Ltd',
        client_email: 'ap@yachatdac.com',
      }),
    };
    expect(counterpartyOf(doc, importer)).toEqual({
      name: 'Yachatdac Pty Ltd',
      email: 'ap@yachatdac.com',
    });
  });

  it('reads a trading name the importer is not known by from their capacity', () => {
    // Team "JC Studio" invoicing as PRODIGITALITY: neither side matches, so a
    // consultant is the issuer and the recipient is the counterparty.
    const invoice = {
      id: 'i1',
      doc_type: 'invoice' as const,
      fields: fields({
        issuer: 'PRODIGITALITY',
        recipient: 'First Nations Action Network',
      }),
    };
    expect(counterpartyOf(invoice, ['JC Studio'], 'consultant').name).toBe(
      'First Nations Action Network',
    );
    expect(counterpartyOf(invoice, ['JC Studio'], 'client').name).toBe(
      'PRODIGITALITY',
    );
    expect(importerSideCheck([invoice], ['JC Studio'], 'consultant')).toEqual({
      read_name: 'PRODIGITALITY',
      matches: false,
    });
  });

  it('a group that names the importer as they are known needs no suggestion', () => {
    const invoice = {
      id: 'i1',
      doc_type: 'invoice' as const,
      fields: fields({ issuer: 'JC Studio Digital Inc.', recipient: 'Acme' }),
    };
    expect(
      importerSideCheck([invoice], ['JC Studio Digital Inc.'], 'consultant'),
    ).toEqual({ read_name: null, matches: true });
  });

  it('groups a contract and invoices with the same counterparty, legal suffixes aside', () => {
    const groups = groupByCounterparty(
      [
        {
          id: 'c1',
          doc_type: 'contract',
          fields: fields({
            provider_name: 'August Consulting',
            client_name: 'Yachatdac Pty Ltd',
          }),
        },
        {
          id: 'i1',
          doc_type: 'invoice',
          fields: fields({
            issuer: 'August Consulting',
            recipient: 'YACHATDAC',
          }),
        },
        {
          id: 'i2',
          doc_type: 'invoice',
          fields: fields({
            issuer: 'August Consulting',
            recipient: 'Other Co',
          }),
        },
      ],
      importer,
    );
    expect([...groups.values()].map((g) => g.ids.sort())).toEqual([
      ['c1', 'i1'],
      ['i2'],
    ]);
    expect(normalizePartyName('Yachatdac Pty. Ltd.')).toBe('yachatdac');
  });

  it('matches a payment by the invoice number it mentions, else by a unique amount', () => {
    const invoices = [
      {
        id: 'i1',
        doc_type: 'invoice' as const,
        fields: fields({ number: 'INV-7', total: '3840', currency: 'AUD' }),
      },
      {
        id: 'i2',
        doc_type: 'invoice' as const,
        fields: fields({ number: 'INV-8', total: '1000', currency: 'AUD' }),
      },
    ];
    expect(
      matchPaymentToInvoice(
        {
          id: 'p',
          doc_type: 'receipt',
          fields: fields({ reference: 'pay inv-8 thanks', amount: '5' }),
        },
        invoices,
      ),
    ).toEqual({ invoice_id: 'i2', basis: 'reference' });
    expect(
      matchPaymentToInvoice(
        {
          id: 'p',
          doc_type: 'receipt',
          fields: fields({ amount: '3,840.00', currency: 'AUD' }),
        },
        invoices,
      ),
    ).toEqual({ invoice_id: 'i1', basis: 'amount' });
    expect(
      matchPaymentToInvoice(
        { id: 'p', doc_type: 'receipt', fields: fields({ amount: '42' }) },
        invoices,
      ),
    ).toBeNull();
  });
});

describe('contract terms from a confirmed contract', () => {
  it('transcribes terms and clauses and folds in the latest amendment', () => {
    const terms = contractTermsFromIntake(
      fields({
        date_signed: '2026-01-10',
        service_start: '2026-01-15',
        service_end: '2027-01-14',
        currency: 'aud',
        billing_mode: 'time_based',
        rate_amount: '80',
        notice_days: '60',
        payment_terms_days: '14',
      }),
      [
        { number: '1', title: 'Scope', body: 'Build things.' },
        { number: '2', title: 'Empty', body: '  ' },
      ],
      [
        fields({
          effective_date: '2026-06-01',
          rate_amount: '95',
          notice_days: null,
        }),
      ],
    );
    expect(terms).toEqual(
      expect.objectContaining({
        external_agreed_at: '2026-01-10',
        // The latest amendment's terms govern from its effective date.
        service_start_date: '2026-06-01',
        currency: 'AUD',
        billing_mode: 'time_based',
        client_hourly_rate: 95,
        notice_days: 60,
        due_days: 14,
      }),
    );
    expect(terms.clauses).toEqual([
      { key: 'intake_1', title: '1 Scope', body: 'Build things.', position: 0 },
    ]);
  });
});

describe('page quota', () => {
  it('spends onboarding pages first, then the monthly quota', () => {
    // 150 onboarding pages used last month; 50 remain for this month.
    expect(
      chargeablePages({
        usedEver: 150,
        usedThisMonth: 0,
        adding: 80,
        onboarding: 200,
      }),
    ).toEqual({ used: 0, adding: 30, unlimited: false });
    expect(
      chargeablePages({
        usedEver: 260,
        usedThisMonth: 60,
        adding: 10,
        onboarding: 200,
      }),
    ).toEqual({ used: 60, adding: 10, unlimited: false });
    expect(
      chargeablePages({
        usedEver: 0,
        usedThisMonth: 0,
        adding: 10,
        onboarding: null,
      }).unlimited,
    ).toBe(true);
  });
});

describe('detected page ranges', () => {
  it('cover the file once, in order, closing gaps and overlaps', () => {
    expect(
      normalizeRanges(
        [
          { doc_type: 'invoice', page_start: 5, page_end: 6 },
          { doc_type: 'contract', page_start: 1, page_end: 3 },
          { doc_type: 'invoice', page_start: 6, page_end: 9 },
        ],
        8,
      ).map((d) => [d.doc_type, d.page_start, d.page_end]),
    ).toEqual([
      ['contract', 1, 4],
      ['invoice', 5, 6],
      ['invoice', 7, 8],
    ]);
  });
});

describe('project currency question', () => {
  it('asks only when the documents are in another currency', () => {
    expect(
      currencyQuestion({ documentCurrencies: ['AUD'], projectCurrency: 'AUD' }),
    ).toBeNull();
    expect(
      currencyQuestion({ documentCurrencies: ['AUD'], projectCurrency: 'USD' }),
    ).toEqual({
      document_currencies: ['AUD'],
      project_currency: 'USD',
      project_is_new: false,
      suggested: null,
    });
  });

  it("preselects the documents' currency for a new project", () => {
    expect(
      currencyQuestion({ documentCurrencies: ['AUD'], projectCurrency: null }),
    ).toMatchObject({ project_currency: 'USD', suggested: 'AUD' });
    expect(
      currencyQuestion({ documentCurrencies: ['USD'], projectCurrency: null }),
    ).toBeNull();
  });

  it('asks again only when the currencies changed since the last answer', () => {
    const previous = { project_currency: 'USD', document_currencies: ['AUD'] };
    expect(
      currencyQuestion({
        documentCurrencies: ['AUD'],
        projectCurrency: 'USD',
        previous,
      }),
    ).toBeNull();
    expect(
      currencyQuestion({
        documentCurrencies: ['AUD', 'NZD'],
        projectCurrency: 'USD',
        previous,
      }),
    ).not.toBeNull();
  });

  it('reads currencies from money documents only, most used first', () => {
    const doc = (doc_type: 'invoice' | 'receipt', currency: string) => ({
      doc_type,
      fields: fields({ currency }),
    });
    expect(
      documentCurrencies([
        doc('invoice', 'nzd'),
        doc('invoice', 'AUD'),
        doc('invoice', 'AUD'),
        doc('receipt', 'EUR'),
      ]),
    ).toEqual(['AUD', 'NZD']);
  });
});
