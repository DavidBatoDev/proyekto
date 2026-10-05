import { ConflictException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { timeError } from '../../execution/time/time-errors';
import type { ContractRow } from '../contracts/contracts.service';
import { contractFixture } from '../contracts/contracts.service.test-fixtures';
import type { ComposedLine } from './invoice-composition.service';
import { InvoicesService, type InvoiceWithLines } from './invoices.service';

/**
 * Time reservations through the invoice lifecycle (E37, E73; backend.md › Invoices): compose reserves under
 * the invoice id and its own period (D38), a recompose or detach releases, issue verifies, void-and-replace
 * moves the rows, delete relies on the FK cascade, and a refused composition never leaves an empty draft.
 */

type Row = Record<string, unknown>;
interface Call {
  table: string;
  op: string;
  payload?: Row;
  filters: Array<[string, unknown]>;
  order: number;
}

let sequence = 0;
const tick = () => ++sequence;

function fakeSupabase(inserted: (payload: Row) => Row) {
  const calls: Call[] = [];
  const from = jest.fn((table: string) => {
    const call: Call = { table, op: 'select', filters: [], order: tick() };
    calls.push(call);
    const b: Record<string, unknown> = {};
    b.insert = (payload: Row) => {
      call.op = 'insert';
      call.payload = payload;
      return b;
    };
    b.update = (payload: Row) => {
      call.op = 'update';
      call.payload = payload;
      call.order = tick();
      return b;
    };
    b.delete = () => {
      call.op = 'delete';
      return b;
    };
    b.select = () => b;
    b.eq = (column: string, value: unknown) => {
      call.filters.push([column, value]);
      return b;
    };
    b.single = () =>
      Promise.resolve({
        data: call.op === 'insert' ? inserted(call.payload ?? {}) : null,
        error: null,
      });
    b.then = (
      resolve: (value: unknown) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve({ data: null, error: null }).then(resolve, reject);
    return b;
  });
  return { client: { from } as unknown as SupabaseClient, calls };
}

function invoiceFixture(
  overrides: Partial<InvoiceWithLines> = {},
): InvoiceWithLines {
  return {
    id: 'invoice-1',
    project_id: 'project-1',
    project_title_snapshot: 'Project One',
    contract_id: 'contract-1',
    issuer_user_id: 'consultant-1',
    recipient_user_id: 'client-1',
    number: 'INV-0001',
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
        id: 'time-1',
        invoice_id: 'invoice-1',
        source_type: 'time_log',
        source_log_id: null,
        description: 'Services (2026-08-01 to 2026-08-31)',
        quantity: 1,
        unit_rate: 100,
        amount: 100,
        metadata: { time_key: 'hours|*|100.00' },
        position: 0,
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

const HOURLY: ContractRow = contractFixture({
  id: 'contract-1',
  project_id: 'project-1',
  status: 'signed',
  billing_mode: 'time_based',
  client_hourly_rate: 100,
});

const LINE: ComposedLine = {
  source_type: 'time_log',
  source_log_id: null,
  description: 'Services',
  quantity: 1,
  unit_rate: 100,
  amount: 100,
  metadata: { time_key: 'hours|*|100.00' },
  position: 0,
};

function harness(
  o: {
    invoice?: InvoiceWithLines;
    byId?: Record<string, InvoiceWithLines>;
    contract?: ContractRow | null;
  } = {},
) {
  sequence = 0;
  const order: string[] = [];
  const db = fakeSupabase((payload) => ({
    ...invoiceFixture(),
    line_items: undefined,
    ...payload,
    id: payload.replaces_invoice_id ? 'replacement-1' : 'invoice-new',
  }));
  const financeAccess = {
    assertProjectFinanceActor: jest
      .fn()
      .mockResolvedValue({ id: 'project-1', title: 'Project One' }),
  };
  const contracts = {
    getContractById: jest
      .fn()
      .mockResolvedValue(o.contract === undefined ? HOURLY : o.contract),
    getSignedContract: jest.fn().mockResolvedValue(null),
  };
  const composition = {
    composeForContract: jest.fn(() => {
      order.push('compose');
      return Promise.resolve({ lines: [LINE], hours: {} });
    }),
    releaseReservations: jest.fn(() => {
      order.push('release');
      return Promise.resolve();
    }),
    verifyReservations: jest.fn(() => {
      order.push('verify');
      return Promise.resolve();
    }),
    moveReservations: jest.fn(() => {
      order.push(`move@${tick()}`);
      return Promise.resolve(1);
    }),
  };
  const qaFixtures = {
    isFixtureProject: jest.fn().mockResolvedValue(false),
    assertProjectSideEffectAllowed: jest.fn().mockResolvedValue(undefined),
  };
  const service = new InvoicesService(
    db.client,
    financeAccess as never,
    { createNotification: jest.fn() } as never,
    contracts as never,
    composition as never,
    {} as never,
    {} as never,
    {} as never,
    qaFixtures as never,
  );
  const invoice = o.invoice ?? invoiceFixture();
  jest
    .spyOn(service as never, 'getInvoiceInternal' as never)
    .mockImplementation(((id: string) =>
      Promise.resolve(o.byId?.[id] ?? invoice)) as never);
  const replace = jest
    .spyOn(service as never, 'replaceInvoiceLineItems' as never)
    .mockImplementation((() => {
      order.push('replace');
      return Promise.resolve();
    }) as never);
  jest
    .spyOn(service as never, 'refreshTotals' as never)
    .mockImplementation((() => {
      order.push(`totals@${tick()}`);
      return Promise.resolve();
    }) as never);
  jest
    .spyOn(service as never, 'recordEvent' as never)
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(service as never, 'nextInvoiceNumber' as never)
    .mockResolvedValue('INV-0002' as never);
  const render = jest
    .spyOn(service, 'renderAndStorePdf')
    .mockImplementation(() => {
      order.push('render');
      return Promise.reject(new Error('stop after render'));
    });
  return { service, db, composition, contracts, replace, render, order };
}

const deletesOf = (db: ReturnType<typeof fakeSupabase>, table: string) =>
  db.calls.filter((c) => c.table === table && c.op === 'delete');

describe('InvoicesService time reservations', () => {
  it('composes a new draft under its own id and period, ignoring hours_from/hours_to (D38)', async () => {
    const { service, composition, replace } = harness();

    await service.createInvoice('consultant-1', {
      project_id: 'project-1',
      contract_id: 'contract-1',
      attach_hours: true,
      period_start: '2026-08-01',
      period_end: '2026-08-15',
      hours_from: '2026-07-01',
      hours_to: '2026-07-31',
    });

    expect(composition.composeForContract).toHaveBeenCalledWith(
      HOURLY,
      'invoice-new',
      { start: '2026-08-01', end: '2026-08-15' },
      'summary',
    );
    expect(replace).toHaveBeenCalledWith('invoice-new', [
      expect.objectContaining({ source_type: 'time_log', quantity: 1 }),
    ]);
  });

  it('discards the new draft when composition is refused, and rethrows', async () => {
    const { service, composition, db, replace } = harness();
    composition.composeForContract.mockRejectedValueOnce(
      timeError('LEGACY_CONTRACT_AMBIGUOUS'),
    );

    await expect(
      service.createInvoice('consultant-1', {
        project_id: 'project-1',
        contract_id: 'contract-1',
        attach_hours: true,
        period_start: '2026-08-01',
        period_end: '2026-08-15',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const [discard] = deletesOf(db, 'invoices');
    expect(discard.filters).toEqual([
      ['id', 'invoice-new'],
      ['status', 'draft'],
    ]);
    expect(replace).not.toHaveBeenCalled();
  });

  it('refuses hours without a billing period before it composes', async () => {
    const { service, composition, db } = harness();

    await expect(
      service.createInvoice('consultant-1', {
        project_id: 'project-1',
        contract_id: 'contract-1',
        attach_hours: true,
        hours_from: '2026-08-01',
        hours_to: '2026-08-15',
      }),
    ).rejects.toThrow(/billing period/);
    expect(composition.composeForContract).not.toHaveBeenCalled();
    expect(deletesOf(db, 'invoices')).toHaveLength(1);
  });

  it('composes a scheduled draft under its id, and discards it when composition is refused', async () => {
    const { service, composition, db } = harness();
    await service.createScheduledInvoice(
      HOURLY,
      '2026-08-01',
      '2026-08-15',
      '2026-08-30',
      '2026-08-16',
    );
    expect(composition.composeForContract).toHaveBeenCalledWith(
      HOURLY,
      'invoice-new',
      { start: '2026-08-01', end: '2026-08-15' },
      'summary',
    );
    expect(deletesOf(db, 'invoices')).toHaveLength(0);

    composition.composeForContract.mockRejectedValueOnce(
      timeError('LEGACY_CONTRACT_AMBIGUOUS'),
    );
    await expect(
      service.createScheduledInvoice(
        HOURLY,
        '2026-08-16',
        '2026-08-31',
        '2026-09-14',
        '2026-09-01',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    // Otherwise the unique period index would block every retry of this period.
    expect(deletesOf(db, 'invoices')).toHaveLength(1);
  });

  it('releases the reservations when hours are detached from a draft (E73)', async () => {
    const { service, composition } = harness();

    await service.updateInvoice('consultant-1', 'invoice-1', {
      attach_hours: false,
    });

    expect(composition.releaseReservations).toHaveBeenCalledWith('invoice-1');
    expect(composition.composeForContract).not.toHaveBeenCalled();
  });

  it('recomposes over the moved period when a draft with hours changes its period (E37)', async () => {
    const { service, composition } = harness();

    await service.updateInvoice('consultant-1', 'invoice-1', {
      period_end: '2026-08-20',
    });

    expect(composition.composeForContract).toHaveBeenCalledWith(
      HOURLY,
      'invoice-1',
      { start: '2026-08-01', end: '2026-08-20' },
      'summary',
    );
    // composeForContract releases its own reservations; the service does not release first.
    expect(composition.releaseReservations).not.toHaveBeenCalled();
  });

  it('does not recompose a draft without hours when only its period moves', async () => {
    const { service, composition, replace } = harness({
      invoice: invoiceFixture({ attach_hours: false, line_items: [] }),
    });

    await service.updateInvoice('consultant-1', 'invoice-1', {
      period_end: '2026-08-20',
    });

    expect(composition.composeForContract).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('verifies the reservations before anything is rendered or issued', async () => {
    const { service, composition, order } = harness();

    await expect(
      service.issueInvoice('consultant-1', 'invoice-1'),
    ).rejects.toThrow('stop after render');

    expect(composition.verifyReservations).toHaveBeenCalledWith(
      'invoice-1',
      invoiceFixture().line_items,
    );
    expect(order.indexOf('verify')).toBeLessThan(order.indexOf('render'));
  });

  it('leaves the draft unissued when the reservations no longer match', async () => {
    const { service, composition, db, render } = harness();
    composition.verifyReservations.mockRejectedValueOnce(
      timeError('INVOICE_TIME_ENTRY_NOT_BILLABLE', 'mismatch', {
        reason: 'reservation_mismatch',
      }),
    );

    await expect(
      service.issueInvoice('consultant-1', 'invoice-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(render).not.toHaveBeenCalled();
    expect(
      db.calls.filter((c) => c.table === 'invoices' && c.op === 'update'),
    ).toHaveLength(0);
  });

  it('moves the reservations to the replacement before the original is voided (E37)', async () => {
    const issued = invoiceFixture({ status: 'issued' });
    const { service, composition, db, order } = harness({
      invoice: issued,
      byId: { 'replacement-1': invoiceFixture({ id: 'replacement-1' }) },
    });

    const result = await service.voidAndReplaceInvoice(
      'consultant-1',
      'invoice-1',
      'Wrong client',
    );

    expect(composition.moveReservations).toHaveBeenCalledWith(
      'invoice-1',
      'replacement-1',
    );
    const at = (prefix: string) =>
      Number(order.find((step) => step.startsWith(prefix))?.split('@')[1]);
    const voided = db.calls.find(
      (c) => c.table === 'invoices' && c.payload?.status === 'void',
    );
    expect(at('totals')).toBeLessThan(at('move'));
    expect(at('move')).toBeLessThan(voided?.order ?? 0);
    expect(result.replacement.id).toBe('replacement-1');
  });

  it('leaves the reservation cleanup of a deleted draft to the FK cascade', async () => {
    const { service, composition, db } = harness();

    await service.deleteInvoice('consultant-1', 'invoice-1');

    expect(deletesOf(db, 'invoices')).toHaveLength(1);
    expect(composition.releaseReservations).not.toHaveBeenCalled();
    expect(db.calls.some((c) => c.table === 'invoice_time_entries')).toBe(
      false,
    );
  });
});
