import type { SupabaseClient } from '@supabase/supabase-js';
import { EngagementsService } from './engagements.service';

/**
 * Chainable stub: every filter method returns the builder; awaiting it
 * resolves with the canned result for its table (queues per table, FIFO).
 * Same pattern as engagement-eligibility.service.spec.ts.
 */
function stubSupabase(
  results: Record<string, Array<{ data?: unknown; count?: number | null }>>,
): SupabaseClient {
  const queues = new Map(Object.entries(results).map(([k, v]) => [k, [...v]]));
  return {
    from(table: string) {
      const next = queues.get(table)?.shift() ?? { data: [], count: 0 };
      const outcome = {
        data: next.data ?? null,
        count: next.count ?? null,
        error: null,
      };
      const builder: Record<string, unknown> = {
        maybeSingle: () => Promise.resolve(outcome),
        then: (
          resolve: (value: typeof outcome) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(outcome).then(resolve, reject),
      };
      for (const method of ['select', 'eq', 'in', 'not', 'is', 'order']) {
        builder[method] = () => builder;
      }
      return builder;
    },
  } as unknown as SupabaseClient;
}

const contract = {
  id: 'c1',
  contract_number: 'PRJ-001',
  status: 'signed',
  relationship_kind: 'talent_services',
  currency: 'USD',
  client_hourly_rate: 150,
  project_id: 'p1',
  project: { id: 'p1', title: 'Proj One' },
};

function seatsThenSiblings(myCapacity: string, myPosition: string) {
  return stubSupabase({
    contract_positions: [
      {
        data: [
          {
            contract_id: 'c1',
            position: myPosition,
            capacity: myCapacity,
            signed_at: '2026-08-20T00:00:00Z',
            contract,
          },
        ],
      },
      {
        data: [
          {
            contract_id: 'c1',
            position: myPosition,
            user_id: 'u1',
            display_name_snapshot: 'Me',
          },
          {
            contract_id: 'c1',
            position: myPosition === 'provider' ? 'hirer' : 'provider',
            user_id: 'u2',
            display_name_snapshot: 'Other Side',
          },
        ],
      },
    ],
  });
}

describe('EngagementsService.listAgreements', () => {
  it('talent never receives client_hourly_rate', async () => {
    const service = new EngagementsService(
      seatsThenSiblings('talent', 'provider'),
    );
    const [view] = await service.listAgreements('u1');
    expect(view.contract_id).toBe('c1');
    expect(view.counterparty_name).toBe('Other Side');
    expect(view.project_title).toBe('Proj One');
    expect(view.signed_at).toBe('2026-08-20T00:00:00Z');
    expect(view).not.toHaveProperty('client_hourly_rate');
  });

  it('client capacity receives the client price', async () => {
    const service = new EngagementsService(
      seatsThenSiblings('client', 'hirer'),
    );
    const [view] = await service.listAgreements('u1');
    expect(view.client_hourly_rate).toBe(150);
    expect(view.my_capacity).toBe('client');
    expect(view.counterparty_name).toBe('Other Side');
  });

  it('consultant capacity receives the client price too', async () => {
    const service = new EngagementsService(
      seatsThenSiblings('consultant', 'provider'),
    );
    const [view] = await service.listAgreements('u1');
    expect(view.client_hourly_rate).toBe(150);
  });

  it('returns [] for a caller with no seats', async () => {
    const service = new EngagementsService(
      stubSupabase({ contract_positions: [{ data: [] }] }),
    );
    expect(await service.listAgreements('u1')).toEqual([]);
  });
});
