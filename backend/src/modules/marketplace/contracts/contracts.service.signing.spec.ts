import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ContractsService,
  type ContractPosition,
  type ContractRow,
} from './contracts.service';
import { contractFixture } from './contracts.service.test-fixtures';

function queryResult(result: object) {
  const builder: Record<
    string,
    jest.Mock | ((resolve: (v: object) => void) => void)
  > = {};
  for (const method of [
    'select',
    'update',
    'eq',
    'is',
    'in',
    'neq',
    'order',
    'limit',
  ]) {
    builder[method] = jest.fn(() => builder);
  }
  builder.maybeSingle = jest.fn().mockResolvedValue(result);
  builder.single = jest.fn().mockResolvedValue(result);
  builder.then = (resolve: (value: object) => void) => {
    resolve(result);
  };
  return builder;
}

function harness(options: {
  contract?: ContractRow;
  ownerId?: string | null;
  active?: boolean;
  rpcData?: ContractRow | null;
  rpcError?: { message: string } | null;
  positions?: ContractPosition[];
}) {
  const contract = options.contract ?? contractFixture();
  const contracts = queryResult({ data: contract, error: null });
  const projects = queryResult({
    data: { owner_id: options.ownerId ?? 'client-owner' },
    error: null,
  });
  const enrollment = queryResult({
    data: null,
    count: options.active === false ? 0 : 1,
    error: null,
  });
  const positions = queryResult({
    data: options.positions ?? [],
    error: null,
  });
  const rpc = jest.fn().mockResolvedValue({
    data: options.rpcData ?? { ...contract, status: 'sent' },
    error: options.rpcError ?? null,
  });
  const supabase = {
    from: jest.fn((table: string) => {
      if (table === 'contracts') return contracts;
      if (table === 'projects') return projects;
      if (table === 'consultant_profiles') return enrollment;
      if (table === 'contract_positions') {
        return positions;
      }
      return queryResult({ data: null, error: null });
    }),
    rpc,
  } as unknown as SupabaseClient;
  const financeAccess = { assertProject: jest.fn().mockResolvedValue({}) };
  const notifications = { createNotification: jest.fn() };
  const projectAuth = {
    getProjectConsultantId: jest.fn().mockResolvedValue('consultant-1'),
  };
  const service = new ContractsService(
    supabase,
    financeAccess as never,
    notifications as never,
    projectAuth as never,
  );
  return { service, rpc, financeAccess, notifications, positions };
}

describe('ContractsService transactional signing', () => {
  it('uses the locking RPC even for a single-party stamp', async () => {
    const { service, rpc } = harness({});

    await service.signContract('consultant-1', 'contract-1', {
      party: 'consultant',
      signer_name: ' Consultant One ',
    });

    expect(rpc).toHaveBeenCalledWith(
      'sign_contract_and_flip',
      expect.objectContaining({
        p_contract_id: 'contract-1',
        p_party: 'consultant',
        p_signer_name: 'Consultant One',
      }),
    );
  });

  it('stamps the generic Consultant seat through the position activation RPC', async () => {
    const positions: ContractPosition[] = [
      {
        contract_id: 'contract-1',
        position: 'hirer',
        user_id: 'client-1',
        capacity: 'client',
        display_name_snapshot: 'Client One',
        email_snapshot: 'client@example.com',
        signer_name: null,
        signature_url: null,
        signature_scale: 1,
        signature_offset_x: 0,
        signature_offset_y: 0,
        signed_at: null,
      },
      {
        contract_id: 'contract-1',
        position: 'provider',
        user_id: 'consultant-1',
        capacity: 'consultant',
        display_name_snapshot: 'Consultant One',
        email_snapshot: 'consultant@example.com',
        signer_name: null,
        signature_url: null,
        signature_scale: 1,
        signature_offset_x: 0,
        signature_offset_y: 0,
        signed_at: null,
      },
    ];
    const { service, rpc } = harness({ positions });

    await service.signContract('consultant-1', 'contract-1', {
      position: 'provider',
      signer_name: 'Consultant One',
    });

    expect(rpc).toHaveBeenCalledWith(
      'sign_contract_position_and_activate',
      expect.objectContaining({
        p_contract_id: 'contract-1',
        p_position: 'provider',
      }),
    );
  });

  it('clears the matching generic position before reopening a signed contract', async () => {
    const positions: ContractPosition[] = [
      {
        contract_id: 'contract-1',
        position: 'hirer',
        user_id: 'client-1',
        capacity: 'client',
        display_name_snapshot: 'Client One',
        email_snapshot: 'client@example.com',
        signer_name: 'Client One',
        signature_url: null,
        signature_scale: 1,
        signature_offset_x: 0,
        signature_offset_y: 0,
        signed_at: '2026-08-16T00:00:00.000Z',
      },
      {
        contract_id: 'contract-1',
        position: 'provider',
        user_id: 'consultant-1',
        capacity: 'consultant',
        display_name_snapshot: 'Consultant One',
        email_snapshot: 'consultant@example.com',
        signer_name: 'Consultant One',
        signature_url: null,
        signature_scale: 1,
        signature_offset_x: 0,
        signature_offset_y: 0,
        signed_at: '2026-08-16T00:00:00.000Z',
      },
    ];
    const { service, positions: positionsQuery } = harness({
      contract: contractFixture({ status: 'signed' }),
      positions,
    });

    await service.unsignContract('consultant-1', 'contract-1', {
      party: 'client',
    });

    expect(positionsQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ signed_at: null }),
    );
  });

  it('lets a distinct project owner sign the client party', async () => {
    const contract = contractFixture({ client_user_id: null });
    const { service, rpc } = harness({
      contract,
      ownerId: 'client-owner',
    });

    await service.signContract('client-owner', contract.id, {
      party: 'client',
      signer_name: 'Client Owner',
    });

    expect(rpc).toHaveBeenCalledWith(
      'sign_contract_and_flip',
      expect.objectContaining({ p_party: 'client' }),
    );
  });

  it('does not let the consultant use the owner arm to sign as client', async () => {
    const contract = contractFixture({ client_user_id: null });
    const { service, rpc } = harness({
      contract,
      ownerId: 'consultant-1',
    });

    await expect(
      service.signContract('consultant-1', contract.id, {
        party: 'client',
        signer_name: 'Consultant One',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(['suspended', 'revoked'])(
    'blocks a %s consultant before the RPC',
    async () => {
      const { service, rpc } = harness({ active: false });

      await expect(
        service.signContract('consultant-1', 'contract-1', {
          party: 'consultant',
          signer_name: 'Consultant One',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it('uses created_by as the compatibility seat', async () => {
    const contract = contractFixture({ consultant_user_id: null });
    const { service, rpc } = harness({ contract });

    await service.signContract('consultant-1', contract.id, {
      party: 'consultant',
      signer_name: 'Consultant One',
    });

    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does not treat created_by as the consultant when a durable seat exists', async () => {
    const contract = contractFixture({
      created_by: 'original-author',
      consultant_user_id: 'consultant-1',
    });
    const { service, rpc } = harness({ contract });

    await expect(
      service.signContract('original-author', contract.id, {
        party: 'consultant',
        signer_name: 'Original Author',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('blocks token signing for a severed contract before enrollment lookup', async () => {
    const contract = contractFixture({ project_id: null });
    const { service, rpc } = harness({ contract });

    await expect(
      service.signAsTokenBearer(contract, {
        party: 'client',
        signer_name: 'Client One',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('blocks a token signer when the consultant enrollment is inactive', async () => {
    const contract = contractFixture();
    const { service, rpc } = harness({ contract, active: false });

    await expect(
      service.signAsTokenBearer(contract, {
        party: 'client',
        signer_name: 'Client One',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('maps the transaction-bound enrollment token to 409', async () => {
    const { service } = harness({
      rpcData: null,
      rpcError: { message: 'CONSULTANT_ENROLLMENT_INACTIVE' },
    });

    await expect(
      service.signContract('consultant-1', 'contract-1', {
        party: 'consultant',
        signer_name: 'Consultant One',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps unsigning consultant-only', async () => {
    const { service, financeAccess } = harness({});

    await expect(
      service.unsignContract('other-consultant', 'contract-1', {
        party: 'client',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(financeAccess.assertProject).toHaveBeenCalled();
  });

  it('keeps signature placement consultant-only', async () => {
    const { service, financeAccess } = harness({});

    await expect(
      service.updateSignaturePlacement('other-consultant', 'contract-1', {
        party: 'client',
        scale: 1,
        offset_x: 0,
        offset_y: 0,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(financeAccess.assertProject).toHaveBeenCalled();
  });
});
