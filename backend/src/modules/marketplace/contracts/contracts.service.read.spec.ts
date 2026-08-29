import { NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ContractsService, type ContractRow } from './contracts.service';
import { contractFixture } from './contracts.service.test-fixtures';

function serviceFor(contract: ContractRow, ownerId: string | null = null) {
  const query = (data: unknown) => {
    const builder = {
      select: jest.fn(() => builder),
      eq: jest.fn(() => builder),
      order: jest.fn(() => builder),
      maybeSingle: jest.fn().mockResolvedValue({ data, error: null }),
    };
    return builder;
  };
  const supabase = {
    from: jest.fn((table: string) =>
      table === 'contracts'
        ? query(contract)
        : table === 'contract_positions'
          ? query([])
          : query({ owner_id: ownerId }),
    ),
  } as unknown as SupabaseClient;
  const financeAccess = { assertProject: jest.fn().mockResolvedValue({}) };
  return {
    service: new ContractsService(
      supabase,
      financeAccess as never,
      { createNotification: jest.fn() } as never,
      { getProjectConsultantId: jest.fn() } as never,
      // Initials are not exercised by these specs.
      { listForContract: async () => [] } as never,
    ),
    financeAccess,
  };
}

describe('ContractsService position-based reads', () => {
  it('lets the consultant seat read a severed contract', async () => {
    const { service } = serviceFor(contractFixture({ project_id: null }));

    await expect(
      service.getContract('consultant-1', 'contract-1'),
    ).resolves.toEqual(
      expect.objectContaining({ id: 'contract-1', project_id: null }),
    );
  });

  it('lets the durable client seat read a severed contract', async () => {
    const { service } = serviceFor(contractFixture({ project_id: null }));

    await expect(
      service.getContract('client-1', 'contract-1'),
    ).resolves.toEqual(expect.objectContaining({ id: 'contract-1' }));
  });

  it('lets a distinct live project owner read', async () => {
    const { service } = serviceFor(contractFixture(), 'project-owner');

    await expect(
      service.getContract('project-owner', 'contract-1'),
    ).resolves.toEqual(expect.objectContaining({ id: 'contract-1' }));
  });

  it('hides a contract from a caller with no party position', async () => {
    const { service } = serviceFor(contractFixture({ project_id: null }));

    await expect(
      service.getContract('stranger', 'contract-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps severed contract writes project-scoped', async () => {
    const { service, financeAccess } = serviceFor(
      contractFixture({ project_id: null }),
    );

    await expect(
      service.updateContract('consultant-1', 'contract-1', { notes: 'No' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(financeAccess.assertProject).not.toHaveBeenCalled();
  });
});
