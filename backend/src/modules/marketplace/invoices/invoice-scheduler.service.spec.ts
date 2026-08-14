import type { ContractRow } from '../contracts/contracts.service';
import { InvoiceSchedulerService } from './invoice-scheduler.service';

describe('InvoiceSchedulerService notifications', () => {
  const notifications = {
    createNotification: jest.fn().mockResolvedValue(undefined),
  };
  const projectAuth = {
    getProjectConsultantId: jest.fn(),
  };
  const service = new InvoiceSchedulerService(
    {} as never,
    {} as never,
    {} as never,
    notifications as never,
    {} as never,
    {} as never,
    projectAuth as never,
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
  const contract = { project_id: 'project-1' } as ContractRow;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('notifies the consultant resolved from project access', async () => {
    projectAuth.getProjectConsultantId.mockResolvedValue('consultant-1');

    await notifyDraftReady(
      contract,
      'invoice-1',
      'INV-001',
      '2026-08-01',
      '2026-08-31',
    );

    expect(projectAuth.getProjectConsultantId).toHaveBeenCalledWith(
      'project-1',
    );
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'consultant-1',
        project_id: 'project-1',
        type_name: 'invoice_draft_ready',
      }),
    );
  });

  it('keeps the null guard for consultant-less projects', async () => {
    projectAuth.getProjectConsultantId.mockResolvedValue(null);

    await notifyDraftReady(
      contract,
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

    expect(projectAuth.getProjectConsultantId).not.toHaveBeenCalled();
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
    const eq = jest.fn().mockReturnValue({ lte });
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
    expect(eq).toHaveBeenCalledWith('status', 'signed');
    expect(qaFixtures.isFixtureProject).toHaveBeenCalledWith('project-1');
  });
});
