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
