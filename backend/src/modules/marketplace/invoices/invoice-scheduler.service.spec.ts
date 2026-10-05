import type { ContractRow } from '../contracts/contracts.service';
import { InvoiceSchedulerService } from './invoice-scheduler.service';

describe('InvoiceSchedulerService notifications', () => {
  const notifications = {
    createNotification: jest.fn().mockResolvedValue(undefined),
  };
  const service = new InvoiceSchedulerService(
    {} as never,
    {} as never,
    {} as never,
    notifications as never,
    {} as never,
    {} as never,
    {} as never,
    { isFixtureProject: jest.fn().mockResolvedValue(false) } as never,
  );
  const notifyDraftReady = (
    service as unknown as {
      notifyDraftReady(
        contract: ContractRow,
        invoiceId: string,
        invoiceNumber: string,
        periodStart: string,
        periodEnd: string,
      ): Promise<void>;
    }
  ).notifyDraftReady.bind(service);
  const contract = {
    project_id: 'project-1',
    consultant_user_id: 'provider-1',
    created_by: 'creator-1',
  } as ContractRow;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // The recipient comes off the contract that generated the draft. It used to be
  // resolved by asking the execution layer who the consultant was on the project
  // (project_access.origin) — an odd question when the contract is already in hand.
  it('notifies the provider named on the contract', async () => {
    await notifyDraftReady(
      contract,
      'invoice-1',
      'INV-001',
      '2026-08-01',
      '2026-08-31',
    );

    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'provider-1',
        project_id: 'project-1',
        type_name: 'invoice_draft_ready',
      }),
    );
  });

  // Same fallback the contract service itself uses for an older contract with no
  // provider seat recorded.
  it('falls back to the contract creator when no provider is named', async () => {
    await notifyDraftReady(
      { ...contract, consultant_user_id: null } as ContractRow,
      'invoice-1',
      'INV-001',
      '2026-08-01',
      '2026-08-31',
    );

    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'creator-1' }),
    );
  });

  it('sends nothing when the contract names nobody', async () => {
    await notifyDraftReady(
      {
        ...contract,
        consultant_user_id: null,
        created_by: null,
      } as ContractRow,
      'invoice-1',
      'INV-001',
      '2026-08-01',
      '2026-08-31',
    );

    expect(notifications.createNotification).not.toHaveBeenCalled();
  });

  it('does not notify for a severed contract', async () => {
    await notifyDraftReady(
      { ...contract, project_id: null },
      'invoice-1',
      'INV-001',
      '2026-08-01',
      '2026-08-31',
    );

    expect(notifications.createNotification).not.toHaveBeenCalled();
  });
});

describe('InvoiceSchedulerService contract selection', () => {
  it('uses signed contracts without consulting project lifecycle status', async () => {
    const contract = {
      id: 'contract-1',
      project_id: 'project-1',
      status: 'signed',
      service_end_date: '2026-12-31',
      contract_end_date: '2026-12-31',
    } as ContractRow;
    const lte = jest.fn().mockResolvedValue({ data: [contract], error: null });
    const chain = { eq: jest.fn(), lte };
    chain.eq.mockReturnValue(chain);
    const eq = chain.eq;
    const select = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ select });
    const qaFixtures = {
      isFixtureProject: jest.fn().mockResolvedValue(false),
    };
    const service = new InvoiceSchedulerService(
      { from } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      qaFixtures as never,
    );
    const findBillableContracts = (
      service as unknown as {
        findBillableContracts(today: string): Promise<ContractRow[]>;
      }
    ).findBillableContracts.bind(service);

    await expect(findBillableContracts('2026-08-14')).resolves.toEqual([
      contract,
    ]);
    expect(select).toHaveBeenCalledWith('*');
    expect(eq).toHaveBeenNthCalledWith(1, 'status', 'signed');
    expect(eq).toHaveBeenNthCalledWith(
      2,
      'relationship_kind',
      'client_services',
    );
    expect(qaFixtures.isFixtureProject).toHaveBeenCalledWith('project-1');
  });

  it('leaves fixed-price client contracts for manual invoicing', async () => {
    const fixed = {
      id: 'fixed-contract',
      project_id: 'project-1',
      billing_mode: 'fixed',
      service_end_date: '2026-12-31',
      contract_end_date: '2026-12-31',
    } as ContractRow;
    const lte = jest.fn().mockResolvedValue({ data: [fixed], error: null });
    const chain = { eq: jest.fn(), lte };
    chain.eq.mockReturnValue(chain);
    const select = jest.fn().mockReturnValue({ eq: chain.eq });
    const from = jest.fn().mockReturnValue({ select });
    const qaFixtures = { isFixtureProject: jest.fn() };
    const service = new InvoiceSchedulerService(
      { from } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      qaFixtures as never,
    );
    const findBillableContracts = (
      service as unknown as {
        findBillableContracts(today: string): Promise<ContractRow[]>;
      }
    ).findBillableContracts.bind(service);

    await expect(findBillableContracts('2026-08-14')).resolves.toEqual([]);
    expect(qaFixtures.isFixtureProject).not.toHaveBeenCalled();
  });
});

/**
 * Time rebuild edge cases (edge-cases-and-tests.md › invoice-scheduler row; L13, L14, L33): the scheduler only
 * drafts invoices. It never submits or approves timesheets at a period end (time cron job 3 does that), it
 * still derives `team_config` periods from the team's pay-period cut-offs, and it never consults the plan, so
 * a signed hourly contract on a Free or downgraded workspace keeps drafting (E59).
 */
describe('InvoiceSchedulerService and time tracking', () => {
  const TEAM_CONFIG = {
    cadence: 'monthly' as const,
    periods: [
      {
        id: 'a',
        label: '1-10',
        start_day: 1,
        end_day: 10,
        pay_day: 15,
        pay_month_offset: 0,
      },
      {
        id: 'b',
        label: '11-20',
        start_day: 11,
        end_day: 20,
        pay_day: 25,
        pay_month_offset: 0,
      },
      {
        id: 'c',
        label: '21-EOM',
        start_day: 21,
        end_day: 'EOM' as const,
        pay_day: 5,
        pay_month_offset: 1,
      },
    ],
  };
  const hourly = {
    id: 'contract-hourly',
    project_id: 'project-1',
    status: 'signed',
    relationship_kind: 'client_services',
    billing_mode: 'time_based',
    billing_timing: 'arrears',
    invoice_cadence: 'semi_monthly',
    period_source: 'team_config',
    invoice_offset_days: 1,
    due_days: 14,
    service_start_date: '2026-08-01',
    service_end_date: '2027-07-31',
    contract_end_date: '2027-07-31',
    consultant_user_id: 'provider-1',
    created_by: 'provider-1',
    // A Free workspace: nothing here may read it.
    workspace_id: 'ws-free',
  } as unknown as ContractRow;

  function runHarness() {
    const tables: string[] = [];
    const builder = (table: string) => {
      tables.push(table);
      const b: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'lte', 'not', 'order', 'limit']) {
        b[method] = jest.fn(() => b);
      }
      b.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data: table === 'contracts' ? [hourly] : [],
          error: null,
        }).then(resolve);
      return b;
    };
    const supabase = { from: jest.fn(builder) };
    const contracts = {
      getTeamPayPeriodConfig: jest.fn().mockResolvedValue(TEAM_CONFIG),
    };
    const invoices = {
      createScheduledInvoice: jest
        .fn()
        .mockResolvedValue({ id: 'invoice-1', number: 'INV-0001' }),
      renderAndStorePdf: jest.fn().mockResolvedValue(undefined),
    };
    const notifications = {
      createNotification: jest.fn().mockResolvedValue(undefined),
    };
    const service = new InvoiceSchedulerService(
      supabase as never,
      contracts as never,
      invoices as never,
      notifications as never,
      { get: () => 'true' } as never,
      {} as never,
      {} as never,
      { isFixtureProject: jest.fn().mockResolvedValue(false) } as never,
    );
    return { service, tables, contracts, invoices };
  }

  it('drafts the closed period from the team pay-period cut-offs (team_config unchanged)', async () => {
    const { service, contracts, invoices } = runHarness();

    const result = await service.runDueInvoices('2026-08-12');

    expect(contracts.getTeamPayPeriodConfig).toHaveBeenCalledWith('project-1');
    // The team's 1–10 cut-off is closed on 08-12; the default 1–15 half would not be.
    expect(invoices.createScheduledInvoice).toHaveBeenCalledWith(
      hourly,
      '2026-08-01',
      '2026-08-10',
      '2026-08-25',
      '2026-08-11',
    );
    expect(result).toMatchObject({ created: 1, failed: 0 });
  });

  it('never submits or approves timesheets at a period end (time cron job 3 owns that)', async () => {
    const { service, tables } = runHarness();

    await service.runDueInvoices('2026-08-12');

    expect(tables.every((table) => table === 'contracts')).toBe(true);
    expect(tables).not.toContain('timesheets');
    expect(tables).not.toContain('time_entries');
  });

  it('drafts a signed hourly contract without consulting the plan (E59)', async () => {
    const { service, invoices } = runHarness();

    await service.runDueInvoices('2026-08-12');

    // No entitlements collaborator exists to ask: the eight constructor slots are data, contracts,
    // invoices, notifications, config, finance access, project auth and QA fixtures.
    expect(InvoiceSchedulerService.length).toBe(8);
    expect(invoices.createScheduledInvoice).toHaveBeenCalledTimes(1);
  });
});
