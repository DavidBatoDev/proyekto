import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PlanLimitException } from '../../shared/entitlements/plan-limit.exception';
import {
  ContractsService,
  type ContractPosition,
  type ContractRow,
} from './contracts.service';
import { contractFixture } from './contracts.service.test-fixtures';

type Op = 'select' | 'insert' | 'update' | 'delete';
type Call = { table: string; op: Op; payload?: unknown; filters: unknown[][] };
type Reply = {
  data: unknown;
  error: { message: string } | null;
  count?: number;
};

/**
 * A table-routing Supabase fake. `reply(table, op, call)` answers every
 * terminal (await, single, maybeSingle); every call is recorded.
 */
function fakeSupabase(reply: (call: Call) => Reply) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: 'select', filters: [] };
    const builder: Record<string, unknown> = {};
    const chain =
      (name: string) =>
      (...args: unknown[]) => {
        if (name === 'insert' || name === 'update' || name === 'delete') {
          call.op = name;
          call.payload = args[0];
        } else if (name !== 'select') {
          call.filters.push([name, ...args]);
        }
        return builder;
      };
    for (const name of [
      'select',
      'insert',
      'update',
      'delete',
      'eq',
      'neq',
      'gt',
      'gte',
      'lte',
      'in',
      'is',
      'not',
      'or',
      'order',
      'limit',
    ]) {
      builder[name] = chain(name);
    }
    const settle = () => {
      calls.push(call);
      return Promise.resolve(reply(call));
    };
    builder.single = settle;
    builder.maybeSingle = settle;
    builder.then = (resolve: (value: Reply) => void, reject: () => void) =>
      settle().then(resolve, reject);
    return builder;
  };
  return {
    client: {
      from: jest.fn(from),
      rpc: jest.fn(),
    } as unknown as SupabaseClient,
    calls,
  };
}

const seat = (
  position: 'hirer' | 'provider',
  userId: string,
  capacity: ContractPosition['capacity'],
  extra: Partial<ContractPosition> = {},
): ContractPosition => ({
  contract_id: 'contract-1',
  position,
  user_id: userId,
  capacity,
  display_name_snapshot: userId,
  email_snapshot: `${userId}@example.com`,
  signer_name: null,
  signature_url: null,
  signature_scale: 1,
  signature_offset_x: 0,
  signature_offset_y: 0,
  signed_at: null,
  team_id: null,
  team_name_snapshot: null,
  ...extra,
});

const CLIENT_SEATS = [
  seat('hirer', 'client-1', 'client'),
  seat('provider', 'consultant-1', 'consultant'),
];

function build(options: {
  contract?: ContractRow;
  positions?: ContractPosition[];
  reply?: (call: Call) => Reply | undefined;
  entitlements?: Record<string, jest.Mock>;
  snapshots?: Record<string, jest.Mock>;
  summaries?: Record<string, jest.Mock>;
  activeConsultant?: boolean;
}) {
  const contract = options.contract ?? contractFixture();
  const positions = options.positions ?? CLIENT_SEATS;
  const { client, calls } = fakeSupabase((call) => {
    const custom = options.reply?.(call);
    if (custom) return custom;
    if (call.table === 'contracts' && call.op === 'select') {
      return { data: contract, error: null };
    }
    if (call.table === 'contracts' && call.op === 'update') {
      return {
        data: { ...contract, ...(call.payload as object) },
        error: null,
      };
    }
    if (call.table === 'contract_positions' && call.op === 'select') {
      return { data: positions, error: null };
    }
    if (call.table === 'consultant_profiles') {
      return {
        data: null,
        count: options.activeConsultant === false ? 0 : 1,
        error: null,
      };
    }
    return { data: null, error: null };
  });
  const notifications = { createNotification: jest.fn() };
  const service = new ContractsService(
    client,
    { assertProject: jest.fn().mockResolvedValue({}) } as never,
    notifications as never,
    { resolvePermissions: jest.fn().mockResolvedValue(null) } as never,
    { listForContract: async () => [] } as never,
    options.entitlements as never,
    options.snapshots as never,
    options.summaries as never,
  );
  return { service, calls, notifications, client };
}

describe('ContractsService: authority follows the seat (rule 1)', () => {
  it('lets the client seat edit shared commercial terms and records them as the author', async () => {
    const contract = contractFixture({ revision: 2 });
    const { service, calls } = build({ contract });

    await service.updateContract('client-1', contract.id, {
      recurring_fee: 900,
    });

    const update = calls.find(
      (call) => call.table === 'contracts' && call.op === 'update',
    );
    expect(update?.payload).toEqual(
      expect.objectContaining({
        recurring_fee: 900,
        revision: 3,
        last_edited_by: 'client-1',
        // Rule 2: every signature is voided by a change of terms.
        signed_by_consultant_at: null,
        signed_by_client_at: null,
      }),
    );
  });

  it('refuses someone who holds no seat', async () => {
    const { service } = build({});
    await expect(
      service.updateContract('stranger', 'contract-1', { recurring_fee: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a stale If-Match revision with 409', async () => {
    const { service } = build({ contract: contractFixture({ revision: 5 }) });
    await expect(
      service.updateContract('client-1', 'contract-1', { recurring_fee: 1 }, 4),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ContractsService: each seat owns its identity block (rule 5)', () => {
  it('a client cannot edit the provider block', async () => {
    const { service } = build({});
    await expect(
      service.updateContract('client-1', 'contract-1', {
        provider_name: 'Someone else',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a consultant cannot edit the hirer billing identity', async () => {
    const { service } = build({});
    await expect(
      service.updateContract('consultant-1', 'contract-1', {
        client_tin: '123',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('nobody re-points a seat through client_user_id', async () => {
    const { service } = build({});
    await expect(
      service.updateContract('client-1', 'contract-1', {
        client_user_id: '00000000-0000-0000-0000-000000000009',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ContractsService: drafts are private to their author', () => {
  it('hides a client-authored draft from the consultant seat', async () => {
    const contract = contractFixture({
      status: 'draft',
      created_by: 'client-1',
    });
    const { service } = build({ contract });

    await expect(
      service.getContract('consultant-1', contract.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.updateContract('consultant-1', contract.id, { recurring_fee: 5 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('only the author deletes a draft', async () => {
    const contract = contractFixture({
      status: 'draft',
      created_by: 'consultant-1',
    });
    const { service } = build({ contract });
    // The client cannot even see it.
    await expect(
      service.deleteContract('client-1', contract.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ContractsService: amendments', () => {
  it('lets the client seat propose an amendment, recorded as theirs', async () => {
    const contract = contractFixture({
      status: 'signed',
      contract_family_id: 'family-1',
      service_start_date: '2026-01-01',
      service_end_date: '2030-12-31',
    });
    let inserted: Record<string, unknown> | null = null;
    const { service } = build({
      contract,
      reply: (call) => {
        if (call.table === 'contracts' && call.op === 'insert') {
          inserted = call.payload as Record<string, unknown>;
          return {
            data: { ...contract, ...inserted, id: 'contract-2' },
            error: null,
          };
        }
        if (call.table === 'contracts' && call.op === 'select') {
          const openAmendmentQuery = call.filters.some(
            (f) => f[0] === 'not' && f[1] === 'supersedes_contract_id',
          );
          if (openAmendmentQuery) return { data: [], error: null };
          const versionQuery = call.filters.some(
            (f) => f[0] === 'eq' && f[1] === 'contract_family_id',
          );
          if (versionQuery) return { data: [{ version: 1 }], error: null };
        }
        if (call.table === 'invoices' && call.op === 'select') {
          return { data: [], error: null };
        }
        return undefined;
      },
    });

    await service.amendContract('client-1', contract.id, {
      scope: 'following',
      effective_from: '2099-01-01',
      recurring_fee: 1500,
    });

    expect(inserted).toEqual(
      expect.objectContaining({
        created_by: 'client-1',
        recurring_fee: 1500,
        signed_pdf_path: null,
        signed_terms: null,
      }),
    );
  });

  it('refuses a second open amendment in the same family (rule 6)', async () => {
    const contract = contractFixture({
      status: 'signed',
      contract_family_id: 'family-1',
    });
    const { service } = build({
      contract,
      reply: (call) => {
        if (
          call.table === 'contracts' &&
          call.filters.some((f) => f[0] === 'not')
        ) {
          return { data: [{ id: 'open-amendment' }], error: null };
        }
        return undefined;
      },
    });

    await expect(
      service.amendContract('consultant-1', contract.id, {
        scope: 'following',
        effective_from: '2099-01-01',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('the issued-invoice guard still blocks a client-authored amendment', async () => {
    const contract = contractFixture({
      status: 'signed',
      contract_family_id: 'family-1',
      service_start_date: '2026-01-01',
    });
    const { service } = build({
      contract,
      reply: (call) => {
        if (call.table === 'invoices') {
          return { data: [{ number: 'INV-7' }], error: null };
        }
        if (
          call.table === 'contracts' &&
          call.op === 'select' &&
          call.filters.some((f) => f[0] === 'not')
        ) {
          return { data: [], error: null };
        }
        return undefined;
      },
    });

    await expect(
      service.amendContract('client-1', contract.id, {
        scope: 'following',
        effective_from: '2099-01-01',
      }),
    ).rejects.toThrow(/INV-7/);
  });
});

describe('ContractsService: counterparty-authored contracts', () => {
  const entitlements = () => ({
    assertFeature: jest.fn().mockResolvedValue(undefined),
    assertCountedLimit: jest.fn().mockResolvedValue(undefined),
  });

  it('a client creates a flexible contract, gated by the authoring feature', async () => {
    const gates = entitlements();
    let inserted: Record<string, unknown> | null = null;
    let seats: Array<Record<string, unknown>> = [];
    const { service } = build({
      entitlements: gates,
      activeConsultant: false,
      reply: (call) => {
        if (call.table === 'consultant_profiles' && call.op === 'select') {
          // No ACTIVE enrollment for the caller; the named consultant exists.
          return call.filters.some((f) => f[2] === 'consultant-1')
            ? { data: { user_id: 'consultant-1' }, count: 0, error: null }
            : { data: null, count: 0, error: null };
        }
        if (call.table === 'profiles') {
          const id = call.filters.find((f) => f[1] === 'id')?.[2] as string;
          return {
            data: {
              id,
              display_name: id,
              first_name: null,
              last_name: null,
              email: `${id}@example.com`,
            },
            error: null,
          };
        }
        if (call.table === 'workspace_members') {
          return { data: [{ workspace_id: 'ws-client' }], error: null };
        }
        if (call.table === 'contracts' && call.op === 'insert') {
          inserted = call.payload as Record<string, unknown>;
          return { data: { ...contractFixture(), ...inserted }, error: null };
        }
        if (call.table === 'contract_positions' && call.op === 'insert') {
          seats = call.payload as Array<Record<string, unknown>>;
          return { data: null, error: null };
        }
        return undefined;
      },
    });

    await service.createContract('client-1', {
      counterparty_user_id: 'consultant-1',
      scope_mode: 'flexible',
    });

    expect(gates.assertFeature).toHaveBeenCalledWith(
      { workspaceId: 'ws-client', exempt: false },
      'contract_counterparty_authoring',
      { context: 'create' },
    );
    expect(inserted).toEqual(
      expect.objectContaining({
        created_by: 'client-1',
        consultant_user_id: 'consultant-1',
        relationship_kind: 'client_services',
        status: 'draft',
        workspace_id: 'ws-client',
      }),
    );
    expect(seats).toEqual([
      expect.objectContaining({
        position: 'hirer',
        user_id: 'client-1',
        capacity: 'client',
      }),
      expect.objectContaining({
        position: 'provider',
        user_id: 'consultant-1',
        capacity: 'consultant',
      }),
    ]);
  });

  it('refuses a project the named consultant does not own', async () => {
    const { service } = build({
      entitlements: entitlements(),
      activeConsultant: false,
      reply: (call) => {
        if (call.table === 'consultant_profiles') {
          return { data: { user_id: 'consultant-1' }, count: 0, error: null };
        }
        if (call.table === 'projects') {
          return {
            data: { owner_id: 'someone-else', workspace_id: 'ws' },
            error: null,
          };
        }
        return undefined;
      },
    });

    await expect(
      service.createContract('client-1', {
        counterparty_user_id: 'consultant-1',
        scope_mode: 'project_specific',
        project_id: '00000000-0000-0000-0000-000000000001',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cannot be signed while the named consultant is unverified', async () => {
    const contract = contractFixture({
      created_by: 'client-1',
      status: 'sent',
    });
    const { service } = build({ contract, activeConsultant: false });

    await expect(
      service.signContract('client-1', contract.id, {
        position: 'hirer',
        revision: 1,
        signer_name: 'Client One',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ContractsService: active_contracts is checked on send', () => {
  it('refuses a send past the limit', async () => {
    const contract = contractFixture({
      status: 'draft',
      created_by: 'consultant-1',
      workspace_id: 'ws-1',
      contract_family_id: 'family-new',
    });
    const assertCountedLimit = jest
      .fn()
      .mockRejectedValue(
        new PlanLimitException({ code: 'plan_limit' } as never),
      );
    const { service } = build({
      contract,
      entitlements: { assertCountedLimit, assertFeature: jest.fn() },
      reply: (call) => {
        if (
          call.table === 'contracts' &&
          call.op === 'select' &&
          call.filters.some((f) => f[0] === 'in')
        ) {
          return {
            data: [
              { id: 'a', contract_family_id: 'family-a' },
              { id: 'b', contract_family_id: 'family-b' },
              { id: 'b2', contract_family_id: 'family-b' },
            ],
            error: null,
          };
        }
        return undefined;
      },
    });

    await expect(
      service.sendContract('consultant-1', contract.id),
    ).rejects.toBeInstanceOf(PlanLimitException);
    // Families, not rows: an amendment never counts twice.
    expect(assertCountedLimit).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', exempt: false },
      'active_contracts',
      { used: 2, adding: 1, context: 'write' },
    );
  });

  it('an amendment of an already-active family adds nothing', async () => {
    const contract = contractFixture({
      status: 'draft',
      created_by: 'consultant-1',
      workspace_id: 'ws-1',
      contract_family_id: 'family-a',
      supersedes_contract_id: 'a',
    });
    const assertCountedLimit = jest.fn().mockResolvedValue(undefined);
    const { service } = build({
      contract,
      entitlements: { assertCountedLimit, assertFeature: jest.fn() },
      reply: (call) => {
        if (
          call.table === 'contracts' &&
          call.op === 'select' &&
          call.filters.some((f) => f[0] === 'in')
        ) {
          return {
            data: [{ id: 'a', contract_family_id: 'family-a' }],
            error: null,
          };
        }
        return undefined;
      },
    });

    await service.sendContract('consultant-1', contract.id);

    expect(assertCountedLimit).toHaveBeenCalledWith(
      expect.anything(),
      'active_contracts',
      { used: 1, adding: 0, context: 'write' },
    );
  });
});

describe('ContractsService: a counterparty-authored contract waits for vetting', () => {
  const draft = () =>
    contractFixture({
      status: 'draft',
      created_by: 'client-1',
      consultant_user_id: 'consultant-1',
      workspace_id: 'ws-1',
    });
  const profile = (call: Call): Reply | undefined =>
    call.table === 'contracts' &&
    call.op === 'select' &&
    call.filters.some((f) => f[0] === 'in')
      ? { data: [], error: null }
      : call.table === 'profiles'
        ? {
            data: {
              id: 'consultant-1',
              display_name: 'Dev Consultant',
              first_name: null,
              last_name: null,
              email: 'c@example.test',
            },
            error: null,
          }
        : undefined;

  it('refuses to send while the named consultant is unverified', async () => {
    const contract = draft();
    const { service, calls } = build({
      contract,
      activeConsultant: false,
      reply: profile,
      entitlements: {
        assertCountedLimit: jest.fn(),
        assertFeature: jest.fn(),
      },
    });

    await expect(service.sendContract('client-1', contract.id)).rejects.toThrow(
      "Waiting for Dev Consultant's verification",
    );
    expect(
      calls.some((call) => call.table === 'contracts' && call.op === 'update'),
    ).toBe(false);
  });

  it('sends once the consultant is verified', async () => {
    const contract = draft();
    const { service } = build({
      contract,
      activeConsultant: true,
      reply: profile,
      entitlements: {
        assertCountedLimit: jest.fn(),
        assertFeature: jest.fn(),
      },
    });

    await expect(
      service.sendContract('client-1', contract.id),
    ).resolves.toMatchObject({ status: 'sent' });
  });

  it('reports the verification on a single read', async () => {
    const contract = draft();
    const { service } = build({
      contract,
      activeConsultant: false,
      reply: profile,
    });
    const read = await service.getContract('client-1', contract.id);
    expect(read.consultant_verification).toEqual({
      verified: false,
      name: 'Dev Consultant',
    });
  });
});

describe('ContractsService: changes must be reviewed before signing (rule 4)', () => {
  it('refuses to sign over unseen changes by the other party', async () => {
    const contract = contractFixture({ revision: 4 });
    const positions = [
      seat('hirer', 'client-1', 'client', { last_viewed_revision: 2 }),
      seat('provider', 'consultant-1', 'consultant'),
    ];
    const { service } = build({
      contract,
      positions,
      reply: (call) =>
        call.table === 'contract_revisions'
          ? {
              data: [
                { revision: 3, author_user_id: 'consultant-1', changes: {} },
              ],
              error: null,
            }
          : undefined,
    });

    await expect(
      service.signContract('client-1', contract.id, {
        position: 'hirer',
        revision: 4,
        signer_name: 'Client One',
      }),
    ).rejects.toThrow(/Review the changes/);
  });
});

describe('ContractsService: unsign is own-seat only', () => {
  it('the consultant cannot pull the client signature', async () => {
    const { service } = build({
      positions: [
        seat('hirer', 'client-1', 'client', {
          signed_at: '2026-09-01T00:00:00Z',
        }),
        seat('provider', 'consultant-1', 'consultant'),
      ],
    });
    await expect(
      service.unsignContract('consultant-1', 'contract-1', { party: 'client' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ContractsService: freeze on signing', () => {
  it('freezes the agreement once when the last signature lands', async () => {
    const contract = contractFixture({ status: 'sent' });
    const signed = { ...contract, status: 'signed' as const };
    const freeze = jest.fn().mockResolvedValue({
      ...signed,
      signed_pdf_path: 'contract_snapshots/x.pdf',
    });
    const { service, client } = build({
      contract,
      snapshots: { freeze },
      positions: [
        seat('hirer', 'client-1', 'client', {
          signed_at: '2026-09-01T00:00:00Z',
        }),
        seat('provider', 'consultant-1', 'consultant'),
      ],
    });
    (client.rpc as jest.Mock).mockResolvedValue({ data: signed, error: null });

    const result = await service.signContract('consultant-1', contract.id, {
      position: 'provider',
      revision: 1,
      signer_name: 'Consultant One',
    });

    expect(freeze).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'signed' }),
      expect.any(Array),
      'at_signing',
    );
    expect(result.signed_pdf_path).toBe('contract_snapshots/x.pdf');
  });
});

describe('ContractsService: the Team Owner Agreement template', () => {
  const profileReply = (call: Call): Reply | undefined => {
    if (call.table !== 'profiles') return undefined;
    const id = (call.filters.find((f) => f[1] === 'id')?.[2] as string) ?? 'x';
    return {
      data: {
        id,
        display_name: id,
        first_name: null,
        last_name: null,
        email: `${id}@example.com`,
      },
      error: null,
    };
  };

  it('issues a consultant-authored client contract as the Team Services Agreement', async () => {
    let inserted: Record<string, unknown> | null = null;
    const { service } = build({
      reply: (call) => {
        const profile = profileReply(call);
        if (profile) return profile;
        if (call.table === 'teams') {
          return {
            data: {
              id: 'team-1',
              name: 'Team One',
              owner_id: 'consultant-1',
              legal_name: null,
              billing_address: null,
              tax_id: null,
              billing_email: null,
            },
            error: null,
          };
        }
        if (call.table === 'workspace_members')
          return { data: [], error: null };
        if (call.table === 'contracts' && call.op === 'insert') {
          inserted = call.payload as Record<string, unknown>;
          return { data: { ...contractFixture(), ...inserted }, error: null };
        }
        return undefined;
      },
    });

    await service.createContractInternal('consultant-1', {
      counterparty_user_id: 'client-1',
      scope_mode: 'flexible',
      team_id: '00000000-0000-0000-0000-0000000000aa',
      template: 'team_owner',
    });

    expect(inserted).toEqual(
      expect.objectContaining({
        template_key: 'team_owner:client',
        document_title: 'Team Services Agreement',
      }),
    );
  });

  it('refuses the template when the owner signs for no team', async () => {
    const { service } = build({
      reply: (call) => profileReply(call),
    });

    await expect(
      service.createContractInternal('consultant-1', {
        counterparty_user_id: 'client-1',
        scope_mode: 'flexible',
        provider_kind: 'individual',
        template: 'team_owner',
      }),
    ).rejects.toThrow(/on behalf of a team/);
  });

  it('re-templates a draft for its author', async () => {
    const contract = contractFixture({
      status: 'draft',
      created_by: 'client-1',
    });
    const { service, calls } = build({
      contract,
      positions: [
        seat('hirer', 'client-1', 'client', { team_id: 'team-9' }),
        seat('provider', 'consultant-1', 'consultant'),
      ],
    });

    await service.applyTemplate('client-1', contract.id, 'team_owner');

    const update = calls.find(
      (call) => call.table === 'contracts' && call.op === 'update',
    );
    expect(update?.payload).toEqual(
      expect.objectContaining({
        template_key: 'team_owner:consultant',
        document_title: 'Team Consulting Agreement',
      }),
    );
  });
});

describe('ContractsService: recorded (external) agreements', () => {
  const DOC_ID = '00000000-0000-0000-0000-00000000d0c1';
  const PROJECT_ID = '00000000-0000-0000-0000-0000000000p1'.replace('p', '0');
  const docReply =
    (overrides: Record<string, unknown> = {}) =>
    (call: Call): Reply | undefined =>
      call.table === 'finance_documents' && call.op === 'select'
        ? {
            data: {
              id: DOC_ID,
              project_id: PROJECT_ID,
              kind: 'other',
              uploaded_by: 'consultant-1',
              file_path: 'finance_documents/x.pdf',
              file_name: 'signed.pdf',
              mime_type: 'application/pdf',
              ...overrides,
            },
            error: null,
          }
        : undefined;

  const input = {
    project_id: PROJECT_ID,
    counterparty_user_id: 'client-1',
    external_agreed_at: '2026-03-01',
    external_document_id: DOC_ID,
    service_start_date: '2026-03-01',
  };

  it('records the agreed date and the paper, and files the paper as a contract', async () => {
    const draft = contractFixture({ status: 'draft', project_id: PROJECT_ID });
    const { service, calls } = build({
      contract: draft,
      reply: (call) =>
        docReply()(call) ??
        (call.table === 'engagement_parties'
          ? { data: [], error: null }
          : undefined),
    });
    jest
      .spyOn(service, 'createContract')
      .mockResolvedValue({ ...draft, positions: CLIENT_SEATS } as never);

    await service.recordExternalAgreement('consultant-1', input);

    const update = calls.find(
      (call) => call.table === 'contracts' && call.op === 'update',
    );
    expect(update?.payload).toEqual(
      expect.objectContaining({
        execution_origin: 'external',
        external_agreed_at: '2026-03-01',
        external_document_id: DOC_ID,
      }),
    );
    expect(
      calls.find(
        (call) => call.table === 'finance_documents' && call.op === 'update',
      )?.payload,
    ).toEqual({ kind: 'contract' });
  });

  it('refuses a future agreed date, a start before it, and paper from another project', async () => {
    const { service } = build({ reply: docReply({ project_id: 'elsewhere' }) });
    await expect(
      service.recordExternalAgreement('consultant-1', {
        ...input,
        external_agreed_at: '2999-01-01',
      }),
    ).rejects.toThrow(/future/);
    await expect(
      service.recordExternalAgreement('consultant-1', {
        ...input,
        service_start_date: '2026-02-01',
      }),
    ).rejects.toThrow(/no earlier than/);
    await expect(
      service.recordExternalAgreement('consultant-1', input),
    ).rejects.toThrow(/same project/);
  });

  it('refuses to adopt a relationship that already has an active engagement', async () => {
    const draft = contractFixture({ status: 'draft', project_id: PROJECT_ID });
    const { service, calls } = build({
      contract: draft,
      reply: (call) => {
        const doc = docReply()(call);
        if (doc) return doc;
        if (call.table === 'engagement_parties') {
          const providerLookup = call.filters.some(
            (f) => f[0] === 'eq' && f[1] === 'position' && f[2] === 'provider',
          );
          return providerLookup
            ? { data: [{ engagement_id: 'eng-1' }], error: null }
            : {
                data: [
                  {
                    engagement_id: 'eng-1',
                    engagement: {
                      id: 'eng-1',
                      status: 'active',
                      kind: 'client_services',
                      scope_mode: 'project_specific',
                      links: [{ project_id: PROJECT_ID }],
                    },
                  },
                ],
                error: null,
              };
        }
        return undefined;
      },
    });
    jest
      .spyOn(service, 'createContract')
      .mockResolvedValue({ ...draft, positions: CLIENT_SEATS } as never);

    await expect(
      service.recordExternalAgreement('consultant-1', input),
    ).rejects.toBeInstanceOf(ConflictException);
    // The half-made draft is removed rather than left behind.
    expect(
      calls.some((call) => call.table === 'contracts' && call.op === 'delete'),
    ).toBe(true);
  });

  it('is attested, not signed: no attestation, no stamp', async () => {
    const contract = contractFixture({
      execution_origin: 'external',
      external_agreed_at: '2026-03-01',
      external_document_id: DOC_ID,
    });
    const { service, client } = build({ contract });

    await expect(
      service.signContract('client-1', contract.id, {
        position: 'hirer',
        revision: 1,
        signer_name: 'Client One',
      }),
    ).rejects.toThrow(/Confirm that it matches/);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('stores the attestation statement with the seat before stamping', async () => {
    const contract = contractFixture({
      execution_origin: 'external',
      external_agreed_at: '2026-03-01',
      external_document_id: DOC_ID,
    });
    const { service, client, calls } = build({ contract });
    (client.rpc as jest.Mock).mockResolvedValue({
      data: contract,
      error: null,
    });

    await service.signContract('client-1', contract.id, {
      position: 'hirer',
      revision: 1,
      signer_name: 'Client One',
      attest: true,
    });

    const statement = calls.find(
      (call) => call.table === 'contract_positions' && call.op === 'update',
    );
    expect(statement?.payload).toEqual({
      attestation_statement: expect.stringContaining('2026-03-01'),
    });
    expect(client.rpc).toHaveBeenCalled();
  });

  it('asks the counterparty to attest when a recorded agreement is sent', async () => {
    const contract = contractFixture({
      status: 'draft',
      created_by: 'consultant-1',
      execution_origin: 'external',
      external_agreed_at: '2026-03-01',
    });
    const { service, notifications } = build({ contract });

    await service.sendContract('consultant-1', contract.id);

    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'client-1',
        type_name: 'contract_attestation_requested',
      }),
    );
  });
});
