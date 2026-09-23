import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  agreementTitle,
  defaultContractClauses,
} from './contract-clause-template';
import {
  ContractsService,
  type ContractPosition,
  type ContractRow,
} from './contracts.service';
import { contractFixture } from './contracts.service.test-fixtures';

type Result = { data: unknown; error: null };

/** A chainable query builder that records every update payload it is given. */
function table(result: Result, updates: unknown[]) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'in', 'order', 'limit']) {
    builder[method] = jest.fn(() => builder);
  }
  builder.update = jest.fn((payload: unknown) => {
    updates.push(payload);
    return builder;
  });
  builder.maybeSingle = jest.fn().mockResolvedValue(result);
  builder.single = jest.fn().mockResolvedValue(result);
  builder.then = (resolve: (value: Result) => void) => resolve(result);
  return builder;
}

function seat(overrides: Partial<ContractPosition>): ContractPosition {
  return {
    contract_id: 'contract-1',
    position: 'hirer',
    user_id: 'user',
    capacity: 'client',
    display_name_snapshot: 'Someone',
    email_snapshot: null,
    signer_name: null,
    signature_url: null,
    signature_scale: 1,
    signature_offset_x: 0,
    signature_offset_y: 0,
    signed_at: null,
    team_id: null,
    team_name_snapshot: null,
    ...overrides,
  };
}

const TALENT_POSITIONS = [
  seat({ position: 'hirer', user_id: 'consultant-1', capacity: 'consultant' }),
  seat({ position: 'provider', user_id: 'talent-1', capacity: 'talent' }),
];

function harness(options: {
  contract?: ContractRow;
  positions?: ContractPosition[];
  team?: Record<string, unknown> | null;
}) {
  const contract =
    options.contract ??
    contractFixture({
      relationship_kind: 'talent_services',
      status: 'draft',
      provider_name: 'Mika Villanueva',
      provider_email: 'mika@example.com',
    });
  const contractUpdates: unknown[] = [];
  const positionUpdates: unknown[] = [];
  const contracts = table({ data: contract, error: null }, contractUpdates);
  const positions = table(
    { data: options.positions ?? TALENT_POSITIONS, error: null },
    positionUpdates,
  );
  const teams = table(
    {
      data:
        options.team === undefined
          ? {
              id: 'team-1',
              name: 'JC Studio',
              owner_id: 'consultant-1',
              legal_name: 'JC Studio Inc.',
              billing_address: 'Marikina City',
              tax_id: '617-100-003',
              billing_email: 'billing@jcstudio.test',
            }
          : options.team,
      error: null,
    },
    [],
  );
  const profiles = table(
    {
      data: {
        id: 'consultant-1',
        display_name: 'Juan Carlos',
        first_name: null,
        last_name: null,
        email: 'jc@example.com',
      },
      error: null,
    },
    [],
  );
  const enrollment = table({ data: null, error: null }, []);
  (enrollment as { then: unknown }).then = (
    resolve: (value: object) => void,
  ) => resolve({ data: null, count: 1, error: null });
  const supabase = {
    from: jest.fn((name: string) => {
      if (name === 'contracts') return contracts;
      if (name === 'contract_positions') return positions;
      if (name === 'teams') return teams;
      if (name === 'profiles') return profiles;
      if (name === 'consultant_profiles') return enrollment;
      return table({ data: null, error: null }, []);
    }),
  } as unknown as SupabaseClient;
  const service = new ContractsService(
    supabase,
    { assertProject: jest.fn().mockResolvedValue({}) } as never,
    { createNotification: jest.fn() } as never,
    {} as never,
    { listForContract: async () => [] } as never,
  );
  return { service, contractUpdates, positionUpdates };
}

describe('ContractsService — the team a seat signs on behalf of', () => {
  it('refilling a talent contract rewrites the consultant, never the talent', async () => {
    const { service, contractUpdates } = harness({});

    await service.reseedProvider('consultant-1', 'contract-1', 'agency', 'team-1');

    // The consultant is the HIRER on a talent contract, so only `client_*`
    // may change. `provider_*` is the talent's block and must stay untouched.
    const patch = contractUpdates[0] as Record<string, unknown>;
    expect(patch.client_name).toBe('JC Studio Inc.');
    expect(patch.client_kind).toBe('company');
    expect(patch.client_tin).toBe('617-100-003');
    expect(Object.keys(patch).some((key) => key.startsWith('provider_'))).toBe(
      false,
    );
  });

  it('records the team on the seat with a name snapshot', async () => {
    const { service, positionUpdates } = harness({});

    await service.setSeatTeam('consultant-1', 'contract-1', 'hirer', 'team-1');

    expect(positionUpdates[0]).toEqual({
      team_id: 'team-1',
      team_name_snapshot: 'JC Studio',
    });
  });

  it('refuses a team the caller does not own', async () => {
    const { service } = harness({
      team: { id: 'team-9', name: 'Other', owner_id: 'someone-else' },
    });

    await expect(
      service.setSeatTeam('consultant-1', 'contract-1', 'hirer', 'team-9'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to set another party’s seat', async () => {
    const { service } = harness({});

    await expect(
      service.setSeatTeam('consultant-1', 'contract-1', 'provider', null),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses once that seat has signed', async () => {
    const { service } = harness({
      positions: [
        seat({
          position: 'hirer',
          user_id: 'consultant-1',
          capacity: 'consultant',
          signed_at: '2026-09-23T00:00:00Z',
        }),
        TALENT_POSITIONS[1],
      ],
    });

    await expect(
      service.setSeatTeam('consultant-1', 'contract-1', 'hirer', 'team-1'),
    ).rejects.toThrow(/Remove your signature/);
  });

  it('signing as yourself clears the team and the company fields', async () => {
    const { service, contractUpdates, positionUpdates } = harness({});

    await service.setSeatTeam('consultant-1', 'contract-1', 'hirer', null);

    expect(positionUpdates[0]).toEqual({ team_id: null, team_name_snapshot: null });
    expect(contractUpdates[0]).toMatchObject({
      client_kind: 'individual',
      client_name: 'Juan Carlos',
      client_tin: null,
      client_contact_name: null,
    });
  });
});

describe('agreement templates', () => {
  it('titles each kind by its own paper', () => {
    expect(agreementTitle('client_services')).toBe('Service Agreement');
    expect(agreementTitle('talent_services')).toBe('Consulting Agreement');
  });

  it('gives talent contracts the consulting agreement articles', () => {
    const clauses = defaultContractClauses('talent_services');
    expect(clauses[0].body).toContain('(the "Company")');
    expect(clauses.map((clause) => clause.key)).toContain('non_solicitation');
    // Every sub-section hangs off an article that exists.
    const keys = new Set(clauses.map((clause) => clause.key));
    for (const clause of clauses) {
      if (clause.parent_key) expect(keys.has(clause.parent_key)).toBe(true);
    }
  });

  it('keeps client contracts on the service agreement clauses', () => {
    expect(defaultContractClauses('client_services')[0].body).toContain(
      'This Service Agreement',
    );
  });
});
