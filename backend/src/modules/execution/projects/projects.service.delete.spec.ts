import { BadRequestException } from '@nestjs/common';
import { ProjectsService } from './projects.service';

type QueryResponse = {
  data?: unknown;
  error?: { message: string } | null;
  count?: number;
};

type QueryCall = {
  table: string;
  operations: Array<[string, ...unknown[]]>;
};

function queryStub(
  table: string,
  response: QueryResponse,
  calls: QueryCall[],
  sequence: string[],
) {
  const call: QueryCall = { table, operations: [] };
  calls.push(call);
  const builder: Record<string, jest.Mock | ((...args: unknown[]) => unknown)> =
    {};
  for (const method of ['select', 'eq', 'in']) {
    builder[method] = jest.fn((...args: unknown[]) => {
      call.operations.push([method, ...args]);
      return builder;
    });
  }
  builder.delete = jest.fn(() => {
    call.operations.push(['delete']);
    sequence.push(`delete:${table}`);
    return builder;
  });
  builder.then = (resolve: (value: QueryResponse) => unknown) =>
    Promise.resolve(response).then(resolve);
  return builder;
}

function buildHarness(input: {
  contractBlockers?: number;
  invoiceBlockers?: number;
}) {
  const sequence: string[] = [];
  const calls: QueryCall[] = [];
  const responses: Record<string, QueryResponse[]> = {
    contracts: [
      { data: null, error: null, count: input.contractBlockers ?? 0 },
      { data: null, error: null },
    ],
    invoices: [
      { data: null, error: null, count: input.invoiceBlockers ?? 0 },
      { data: null, error: null },
    ],
  };
  const supabase = {
    from: jest.fn((table: string) => {
      const response = responses[table]?.shift();
      if (!response) throw new Error(`Unexpected query for ${table}`);
      return queryStub(table, response, calls, sequence);
    }),
  };
  const projectsRepo = {
    findById: jest.fn().mockResolvedValue({
      id: 'project-1',
      title: 'Durable project',
      owner_id: 'owner-1',
    }),
    deleteProject: jest.fn().mockImplementation(() => {
      sequence.push('delete:project');
      return Promise.resolve();
    }),
  };
  const teamTime = {
    stopRunningLogsForProject: jest.fn().mockImplementation(() => {
      sequence.push('stop:timers');
      return Promise.resolve(2);
    }),
  };
  const cacheInvalidation = {
    invalidateAllDashboardCache: jest.fn().mockResolvedValue(undefined),
  };

  const service = new ProjectsService(
    projectsRepo as any,
    { createNotification: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
    supabase as any,
    {} as any,
    cacheInvalidation as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    teamTime as any,
  );
  return {
    service,
    projectsRepo,
    teamTime,
    cacheInvalidation,
    calls,
    sequence,
  };
}

describe('ProjectsService.deleteProject', () => {
  it('blocks deletion when a sent or signed contract exists', async () => {
    const harness = buildHarness({ contractBlockers: 1 });

    await expect(
      harness.service.deleteProject('project-1', 'owner-1'),
    ).rejects.toThrow(BadRequestException);
    expect(harness.teamTime.stopRunningLogsForProject).not.toHaveBeenCalled();
    expect(harness.projectsRepo.deleteProject).not.toHaveBeenCalled();
  });

  it('blocks deletion when an issued or sent invoice exists', async () => {
    const harness = buildHarness({ invoiceBlockers: 1 });

    await expect(
      harness.service.deleteProject('project-1', 'owner-1'),
    ).rejects.toThrow(/pay or void invoices/i);
    expect(harness.teamTime.stopRunningLogsForProject).not.toHaveBeenCalled();
    expect(harness.projectsRepo.deleteProject).not.toHaveBeenCalled();
  });

  it('allows terminal-only finance history, stops timers, and deletes drafts', async () => {
    const harness = buildHarness({});

    await expect(
      harness.service.deleteProject('project-1', 'owner-1'),
    ).resolves.toBeUndefined();

    expect(harness.teamTime.stopRunningLogsForProject).toHaveBeenCalledWith(
      'project-1',
    );
    const invoiceDelete = harness.calls.find(
      (call) =>
        call.table === 'invoices' &&
        call.operations.some(([operation]) => operation === 'delete'),
    );
    const contractDelete = harness.calls.find(
      (call) =>
        call.table === 'contracts' &&
        call.operations.some(([operation]) => operation === 'delete'),
    );
    expect(invoiceDelete?.operations).toContainEqual(['eq', 'status', 'draft']);
    expect(contractDelete?.operations).toContainEqual([
      'eq',
      'status',
      'draft',
    ]);
    expect(harness.sequence).toEqual([
      'stop:timers',
      'delete:invoices',
      'delete:contracts',
      'delete:project',
    ]);
    expect(
      harness.cacheInvalidation.invalidateAllDashboardCache,
    ).toHaveBeenCalledTimes(1);
  });
});
