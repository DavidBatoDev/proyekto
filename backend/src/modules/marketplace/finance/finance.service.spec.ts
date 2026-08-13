import type { SupabaseClient } from '@supabase/supabase-js';
import { FinanceService } from './finance.service';

function builderResult(data: unknown[]) {
  const builder: Record<string, unknown> = {};
  for (const method of [
    'select',
    'order',
    'range',
    'or',
    'in',
    'is',
    'eq',
    'gte',
    'lte',
  ]) {
    builder[method] = jest.fn(() => builder);
  }
  builder.then = (resolve: (value: object) => void) =>
    Promise.resolve({ data, error: null, count: data.length }).then(resolve);
  return builder as Record<string, jest.Mock> & PromiseLike<unknown>;
}

const defaultQuery = {
  page: 1,
  limit: 25,
};

describe('FinanceService severed records', () => {
  it('lists live and caller-seated severed contracts in one filter', async () => {
    const contracts = builderResult([
      {
        id: 'contract-removed',
        project_id: null,
        project_title_snapshot: 'Removed Project',
      },
    ]);
    const supabase = {
      from: jest.fn(() => contracts),
    } as unknown as SupabaseClient;
    const access = {
      listProjects: jest
        .fn()
        .mockResolvedValue([
          { id: '11111111-1111-4111-8111-111111111111', title: 'Live' },
        ]),
    };
    const service = new FinanceService(supabase, access as never);

    const result = await service.listContracts(
      '22222222-2222-4222-8222-222222222222',
      defaultQuery,
    );

    expect(contracts.or).toHaveBeenCalledWith(
      'project_id.in.(11111111-1111-4111-8111-111111111111),and(project_id.is.null,consultant_user_id.eq.22222222-2222-4222-8222-222222222222)',
    );
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        project: null,
        project_title_snapshot: 'Removed Project',
      }),
    );
  });

  it('includes severed invoices owned by a contract seat or issuer', async () => {
    const seatedContracts = builderResult([{ id: 'contract-seat-1' }]);
    const invoices = builderResult([
      {
        id: 'invoice-removed',
        project_id: null,
        project_title_snapshot: 'Removed Project',
      },
    ]);
    const supabase = {
      from: jest.fn((table: string) =>
        table === 'contracts' ? seatedContracts : invoices,
      ),
    } as unknown as SupabaseClient;
    const access = { listProjects: jest.fn().mockResolvedValue([]) };
    const service = new FinanceService(supabase, access as never);

    const result = await service.listInvoices('consultant-1', defaultQuery);

    expect(invoices.or).toHaveBeenCalledWith(
      'and(project_id.is.null,issuer_user_id.eq.consultant-1),and(project_id.is.null,contract_id.in.(contract-seat-1))',
    );
    expect(result.items[0]).toEqual(expect.objectContaining({ project: null }));
  });

  it('does not add severed records to a project-filtered request', async () => {
    const contracts = builderResult([]);
    const from = jest.fn(() => contracts);
    const supabase = {
      from,
    } as unknown as SupabaseClient;
    const access = { listProjects: jest.fn().mockResolvedValue([]) };
    const service = new FinanceService(supabase, access as never);

    const result = await service.listContracts('consultant-1', {
      ...defaultQuery,
      project_id: 'project-1',
    });

    expect(result).toEqual({ items: [], total: 0 });
    expect(from).not.toHaveBeenCalled();
  });
});
