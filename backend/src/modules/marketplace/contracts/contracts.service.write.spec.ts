import type { SupabaseClient } from '@supabase/supabase-js';
import { ContractsService, type ContractRow } from './contracts.service';
import { contractFixture } from './contracts.service.test-fixtures';
import type { AmendContractDto } from './dto/contracts.dto';

function awaitable(data: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'limit']) {
    builder[method] = jest.fn(() => builder);
  }
  builder.maybeSingle = jest.fn().mockResolvedValue({ data, error: null });
  builder.then = (resolve: (value: object) => void) =>
    Promise.resolve({ data, error: null }).then(resolve);
  return builder;
}

function writeHarness() {
  let inserted: Record<string, unknown> | null = null;
  const insertedRow = contractFixture();
  const contractsTable = {
    select: jest.fn(() => awaitable([])),
    insert: jest.fn((payload: Record<string, unknown>) => {
      inserted = payload;
      return {
        select: () => ({
          single: jest.fn().mockResolvedValue({
            data: { ...insertedRow, ...payload },
            error: null,
          }),
        }),
      };
    }),
  };
  const supabase = {
    from: jest.fn((table: string) => {
      if (table === 'contracts') return contractsTable;
      if (table === 'profiles') {
        return awaitable({
          display_name: 'Consultant One',
          first_name: null,
          last_name: null,
          email: 'consultant@example.com',
        });
      }
      if (table === 'projects') {
        return awaitable({ owner_id: 'consultant-1', title: 'Project One' });
      }
      return awaitable(null);
    }),
  } as unknown as SupabaseClient;
  const service = new ContractsService(
    supabase,
    { assertProject: jest.fn() } as never,
    {} as never,
    {} as never,
  );
  return { service, inserted: () => inserted };
}

describe('ContractsService consultant seat writes', () => {
  it('stores the creating consultant as the contract seat', async () => {
    const { service, inserted } = writeHarness();

    await service.createContractInternal('consultant-1', {
      project_id: 'project-1',
      provider_kind: 'individual',
    });

    expect(inserted()).toEqual(
      expect.objectContaining({ consultant_user_id: 'consultant-1' }),
    );
  });

  it('carries the consultant seat into an amendment', async () => {
    const { service, inserted } = writeHarness();
    const existing = contractFixture({
      consultant_user_id: 'seat-1',
      status: 'signed',
    });
    const insertAmendedVersion = (
      service as unknown as {
        insertAmendedVersion(
          contract: ContractRow,
          dto: AmendContractDto,
          effectiveFrom: string,
          callerId: string,
        ): Promise<ContractRow>;
      }
    ).insertAmendedVersion.bind(service);

    await insertAmendedVersion(
      existing,
      { scope: 'following' },
      '2026-09-01',
      'consultant-2',
    );

    expect(inserted()).toEqual(
      expect.objectContaining({
        consultant_user_id: 'seat-1',
        created_by: 'consultant-2',
      }),
    );
  });
});
