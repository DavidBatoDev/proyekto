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

function writeHarness(options: { ownerId?: string } = {}) {
  const ownerId = options.ownerId ?? 'client-1';
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
          id: 'client-1',
          display_name: 'Consultant One',
          first_name: null,
          last_name: null,
          email: 'consultant@example.com',
        });
      }
      if (table === 'projects') {
        return awaitable({ owner_id: ownerId, title: 'Project One' });
      }
      if (table === 'contract_positions') {
        return {
          select: jest.fn(() => awaitable([])),
          insert: jest.fn(() => ({ error: null })),
        };
      }
      return awaitable(null);
    }),
  } as unknown as SupabaseClient;
  const service = new ContractsService(
    supabase,
    { assertProject: jest.fn() } as never,
    {} as never,
    {} as never,
    // Initials are not exercised by these specs.
    { listForContract: async () => [] } as never,
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

describe('ContractsService client counterparty rules', () => {
  /**
   * A project-scoped client contract used to be impossible to create.
   *
   * `createContract` requires the CALLER to own the project, and the old rule
   * additionally required the Client seat to BE the project owner — so the two
   * could only agree by seating one person on both sides, which
   * `contract_positions` forbids. Every client agreement was pushed to
   * `flexible`, which in turn meant no project invoice could carry contract
   * provenance.
   */
  it('accepts a named Client who does not own the project', async () => {
    const { service, inserted } = writeHarness({ ownerId: 'consultant-1' });

    await service.createContractInternal('consultant-1', {
      project_id: 'project-1',
      relationship_kind: 'client_services',
      counterparty_user_id: 'client-1',
    });

    expect(inserted()).toEqual(
      expect.objectContaining({
        project_id: 'project-1',
        relationship_kind: 'client_services',
        consultant_user_id: 'consultant-1',
      }),
    );
  });

  it('still falls back to the project owner when no Client is named', async () => {
    const { service, inserted } = writeHarness({ ownerId: 'client-1' });

    await service.createContractInternal('consultant-1', {
      project_id: 'project-1',
      relationship_kind: 'client_services',
    });

    expect(inserted()).toEqual(
      expect.objectContaining({ consultant_user_id: 'consultant-1' }),
    );
  });

  it('refuses to seat the caller on both sides', async () => {
    const { service } = writeHarness({ ownerId: 'consultant-1' });

    // The owner fallback must not resolve to the caller — that is the shape
    // that produced the deadlock.
    await expect(
      service.createContractInternal('consultant-1', {
        project_id: 'project-1',
        relationship_kind: 'client_services',
      }),
    ).rejects.toThrow('Choose a Client account before creating this contract.');
  });

  it('still requires an explicit Talent account', async () => {
    const { service } = writeHarness({ ownerId: 'client-1' });

    await expect(
      service.createContractInternal('consultant-1', {
        project_id: 'project-1',
        relationship_kind: 'talent_services',
      }),
    ).rejects.toThrow('Choose a Talent account before creating this contract.');
  });
});
