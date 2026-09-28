import { ConflictException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ContractsService, type ContractRow } from './contracts.service';
import { contractFixture } from './contracts.service.test-fixtures';

type Call = { method: string; args: unknown[] };

/** A chainable builder that records every call made on it. */
function recorder(result: object) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of [
    'select',
    'update',
    'delete',
    'eq',
    'is',
    'in',
    'neq',
    'not',
    'or',
    'order',
    'limit',
  ]) {
    builder[method] = jest.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    });
  }
  builder.maybeSingle = jest.fn(() => Promise.resolve(result));
  builder.single = jest.fn(() => Promise.resolve(result));
  builder.then = (resolve: (value: object) => void) => resolve(result);
  return { builder, calls };
}

function harness(options: {
  contract: ContractRow;
  updated?: ContractRow | null;
  rpcError?: { message: string } | null;
}) {
  // Reads return the existing row; the guarded update returns `updated`.
  const reads = recorder({ data: options.contract, error: null });
  const writes = recorder({
    data: options.updated === undefined ? options.contract : options.updated,
    error: null,
  });
  let contractsCalls = 0;
  const positions = recorder({ data: [], error: null });
  const initials = recorder({ data: null, error: null });
  const enrollment = recorder({ data: null, count: 1, error: null });
  const rpc = jest.fn().mockResolvedValue({
    data: options.contract,
    error: options.rpcError ?? null,
  });
  const supabase = {
    from: jest.fn((table: string) => {
      if (table === 'contracts') {
        contractsCalls += 1;
        return contractsCalls === 1 ? reads.builder : writes.builder;
      }
      if (table === 'contract_positions') return positions.builder;
      if (table === 'contract_page_initials') return initials.builder;
      if (table === 'consultant_profiles') return enrollment.builder;
      return recorder({ data: null, error: null }).builder;
    }),
    rpc,
  } as unknown as SupabaseClient;
  const service = new ContractsService(
    supabase,
    { assertProject: jest.fn().mockResolvedValue({}) } as never,
    { createNotification: jest.fn() } as never,
    {} as never,
    { listForContract: async () => [] } as never,
  );
  return { service, rpc, writes, positions, initials };
}

describe('ContractsService — signatures are pinned to a revision', () => {
  it('an edit raises the revision and clears both legacy signatures in the same update', async () => {
    const contract = contractFixture({
      revision: 4,
      signed_by_client_at: '2026-09-01T00:00:00.000Z',
      signed_by_client_name: 'Client One',
    });
    const { service, writes } = harness({ contract });

    await service.updateContract('consultant-1', contract.id, {
      recurring_fee: 1200,
    });

    const update = writes.calls.find((call) => call.method === 'update');
    expect(update?.args[0]).toEqual(
      expect.objectContaining({
        recurring_fee: 1200,
        revision: 5,
        signed_by_client_at: null,
        signed_by_client_name: null,
        signed_by_client_signature_url: null,
        signed_by_consultant_at: null,
        signed_by_consultant_name: null,
        signed_by_consultant_signature_url: null,
      }),
    );
    // Guarded on the revision the caller read.
    expect(writes.calls).toContainEqual({ method: 'eq', args: ['revision', 4] });
  });

  it('refuses an edit when someone else changed the contract first', async () => {
    const contract = contractFixture({ revision: 2 });
    const { service } = harness({ contract, updated: null });

    await expect(
      service.updateContract('consultant-1', contract.id, {
        recurring_fee: 1200,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('clears seat signatures made before the new revision, and page initials', async () => {
    const contract = contractFixture({ revision: 1 });
    const { service, positions, initials } = harness({ contract });

    await service.updateContract('consultant-1', contract.id, {
      recurring_fee: 1200,
    });

    expect(positions.calls).toContainEqual({
      method: 'update',
      args: [
        {
          signer_name: null,
          signature_url: null,
          signed_at: null,
          signed_revision: null,
        },
      ],
    });
    // A seat that already signed revision 2 keeps its signature.
    expect(positions.calls).toContainEqual({
      method: 'or',
      args: ['signed_revision.is.null,signed_revision.lt.2'],
    });
    expect(initials.calls).toContainEqual({ method: 'delete', args: [] });
  });

  it('sends the revision the signer saw to the signing function', async () => {
    const contract = contractFixture({ revision: 3 });
    const { service, rpc } = harness({ contract });

    await service.signContract('consultant-1', contract.id, {
      party: 'consultant',
      revision: 3,
      signer_name: 'Consultant One',
    });

    expect(rpc).toHaveBeenCalledWith(
      'sign_contract_and_flip',
      expect.objectContaining({ p_expected_revision: 3 }),
    );
  });

  it('turns a stale revision into a 409 the signer can act on', async () => {
    const contract = contractFixture({ revision: 3 });
    const { service } = harness({
      contract,
      rpcError: { message: 'CONTRACT_REVISION_STALE' },
    });

    await expect(
      service.signContract('consultant-1', contract.id, {
        party: 'consultant',
        revision: 2,
        signer_name: 'Consultant One',
      }),
    ).rejects.toThrow(
      'The terms changed after you opened this contract. Review the latest version and sign again.',
    );
  });
});
