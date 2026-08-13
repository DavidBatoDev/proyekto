import { ConflictException, NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { contractFixture } from '../contracts/contracts.service.test-fixtures';
import { InvoicesService, type InvoiceWithLines } from './invoices.service';

function invoiceFixture(
  overrides: Partial<InvoiceWithLines> = {},
): InvoiceWithLines {
  return {
    id: 'invoice-1',
    project_id: 'project-1',
    project_title_snapshot: 'Project One',
    contract_id: 'contract-v1',
    issuer_user_id: 'consultant-1',
    recipient_user_id: null,
    number: 'INV-001',
    status: 'draft',
    currency: 'USD',
    issue_date: null,
    due_date: null,
    period_start: '2026-08-01',
    period_end: '2026-08-31',
    origin: 'manual',
    hours_detail_level: 'summary',
    bill_to: {},
    issued_by: {},
    payment_method: null,
    notes: null,
    attach_hours: true,
    subtotal: 100,
    total: 100,
    issued_at: null,
    sent_at: null,
    paid_at: null,
    voided_at: null,
    void_reason: null,
    voided_by: null,
    replaces_invoice_id: null,
    replaced_by_invoice_id: null,
    pdf_path: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    line_items: [
      {
        id: 'manual-1',
        invoice_id: 'invoice-1',
        source_type: 'manual',
        source_log_id: null,
        description: 'Manual item',
        quantity: 1,
        unit_rate: 25,
        amount: 25,
        metadata: {},
        position: 0,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      },
      {
        id: 'time-1',
        invoice_id: 'invoice-1',
        source_type: 'time_log',
        source_log_id: 'log-1',
        description: 'Stored priced hours',
        quantity: 1,
        unit_rate: 75,
        amount: 75,
        metadata: { contract_id: 'contract-v1' },
        position: 1,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      },
    ],
    documents: [],
    payments: [],
    events: [],
    amount_paid: 0,
    balance_due: 100,
    payment_count: 0,
    is_overdue: false,
    ...overrides,
  };
}

function harness(invoice = invoiceFixture()) {
  const query: Record<string, unknown> = {};
  for (const method of ['update', 'eq']) {
    query[method] = jest.fn(() => query);
  }
  query.then = (resolve: (value: object) => void) =>
    Promise.resolve({ data: null, error: null }).then(resolve);
  const supabase = {
    from: jest.fn(() => query),
  } as unknown as SupabaseClient;
  const financeAccess = { assertProject: jest.fn().mockResolvedValue({}) };
  const contracts = {
    getContractById: jest.fn(),
    getLiveContract: jest.fn(),
  };
  const composition = { composeForContract: jest.fn() };
  const qaFixtures = {
    isFixtureProject: jest.fn().mockResolvedValue(false),
    assertProjectSideEffectAllowed: jest.fn().mockResolvedValue(undefined),
  };
  const service = new InvoicesService(
    supabase,
    financeAccess as never,
    {} as never,
    contracts as never,
    composition as never,
    {} as never,
    {} as never,
    {} as never,
    qaFixtures as never,
  );
  jest
    .spyOn(service as never, 'getInvoiceInternal' as never)
    .mockResolvedValue(invoice as never);
  const replace = jest
    .spyOn(service as never, 'replaceInvoiceLineItems' as never)
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(service as never, 'refreshTotals' as never)
    .mockResolvedValue(undefined as never);
  return {
    service,
    contracts,
    composition,
    financeAccess,
    qaFixtures,
    replace,
  };
}

describe('InvoicesService contract provenance', () => {
  it('checks the QA side-effect guard before issuing a draft', async () => {
    const { service, qaFixtures } = harness();
    qaFixtures.assertProjectSideEffectAllowed.mockRejectedValue(
      new Error('fixture blocked'),
    );

    await expect(
      service.issueInvoice('consultant-1', 'invoice-1'),
    ).rejects.toThrow('fixture blocked');
    expect(qaFixtures.assertProjectSideEffectAllowed).toHaveBeenCalledWith(
      'project-1',
      'Invoice issuing',
    );
  });

  it('recomposes using the invoice stored contract_id, never the live contract', async () => {
    const { service, contracts, composition } = harness();
    const contract = contractFixture({ id: 'contract-v1' });
    contracts.getContractById.mockResolvedValue(contract);
    composition.composeForContract.mockResolvedValue({ lines: [], hours: {} });

    await service.updateInvoice('consultant-1', 'invoice-1', {
      hours_to: '2026-08-30',
    });

    expect(contracts.getContractById).toHaveBeenCalledWith('contract-v1');
    expect(contracts.getLiveContract).not.toHaveBeenCalled();
    expect(composition.composeForContract).toHaveBeenCalledWith(
      contract,
      '2026-08-01',
      '2026-08-30',
      'summary',
    );
  });

  it('preserves stored generated pricing when only manual lines change', async () => {
    const { service, contracts, replace } = harness();
    contracts.getContractById.mockResolvedValue(null);

    await service.updateInvoice('consultant-1', 'invoice-1', {
      line_items: [
        { description: 'Changed manual item', quantity: 2, unit_rate: 10 },
      ],
    });

    expect(replace).toHaveBeenCalledWith(
      'invoice-1',
      expect.arrayContaining([
        expect.objectContaining({
          source_type: 'manual',
          description: 'Changed manual item',
        }),
        expect.objectContaining({
          source_type: 'time_log',
          unit_rate: 75,
          amount: 75,
        }),
      ]),
    );
  });

  it('rejects regeneration when the stored pricing contract is missing', async () => {
    const { service, contracts, replace } = harness();
    contracts.getContractById.mockResolvedValue(null);

    await expect(
      service.updateInvoice('consultant-1', 'invoice-1', {
        hours_to: '2026-08-30',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(replace).not.toHaveBeenCalled();
  });

  it('reads a severed invoice through its contract seat', async () => {
    const invoice = invoiceFixture({ project_id: null });
    const { service, contracts, financeAccess } = harness(invoice);
    contracts.getContractById.mockResolvedValue(contractFixture());

    await expect(service.getInvoice('consultant-1', 'invoice-1')).resolves.toBe(
      invoice,
    );
    expect(financeAccess.assertProject).not.toHaveBeenCalled();
  });

  it('hides a severed invoice from strangers', async () => {
    const invoice = invoiceFixture({
      project_id: null,
      issuer_user_id: 'issuer-1',
    });
    const { service, contracts } = harness(invoice);
    contracts.getContractById.mockResolvedValue(contractFixture());

    await expect(
      service.getInvoice('stranger', 'invoice-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
