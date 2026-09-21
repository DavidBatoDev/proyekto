import type { SupabaseClient } from '@supabase/supabase-js';
import { EngagementEligibilityService } from './engagement-eligibility.service';

/**
 * Chainable stub: every filter method returns the builder; awaiting it
 * resolves with the canned result for its table (queues per table, FIFO).
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
      for (const method of ['select', 'eq', 'in', 'not', 'is', 'lt', 'gt']) {
        builder[method] = () => builder;
      }
      return builder;
    },
  } as unknown as SupabaseClient;
}

const seat = (contract: {
  id: string;
  status: string;
  project_id: string | null;
  engagement_id?: string | null;
}) => ({ contract: { engagement_id: null, ...contract } });

describe('EngagementEligibilityService', () => {
  it('engaged: signed seat on a live contract bound to the project', async () => {
    const service = new EngagementEligibilityService(
      stubSupabase({
        contract_positions: [
          { data: [seat({ id: 'c1', status: 'active', project_id: 'p1' })] },
        ],
      }),
    );
    expect(await service.getEngagementStatus('u1', 'p1')).toBe('engaged');
  });

  it('engaged: flexible-scope contract linked through the engagement', async () => {
    const service = new EngagementEligibilityService(
      stubSupabase({
        contract_positions: [
          {
            data: [
              seat({
                id: 'c1',
                status: 'signed',
                project_id: null,
                engagement_id: 'e1',
              }),
            ],
          },
        ],
        engagement_project_links: [{ count: 1 }],
      }),
    );
    expect(await service.getEngagementStatus('u1', 'p1')).toBe('engaged');
  });

  it('ineligible: seat exists but the contract has ended', async () => {
    const service = new EngagementEligibilityService(
      stubSupabase({
        contract_positions: [
          { data: [seat({ id: 'c1', status: 'ended', project_id: 'p1' })] },
        ],
        task_time_logs: [{ count: 0 }],
        project_access: [{ data: null }],
      }),
    );
    expect(await service.getEngagementStatus('u1', 'p1')).toBe('ineligible');
  });

  it('grandfathered: pre-cutoff time logs, no contract', async () => {
    const service = new EngagementEligibilityService(
      stubSupabase({
        contract_positions: [{ data: [] }],
        task_time_logs: [{ count: 3 }],
      }),
    );
    expect(await service.getEngagementStatus('u1', 'p1')).toBe('grandfathered');
  });

  it('grandfathered: verified consultant with pre-cutoff project access', async () => {
    const service = new EngagementEligibilityService(
      stubSupabase({
        contract_positions: [{ data: [] }],
        task_time_logs: [{ count: 0 }],
        project_access: [{ data: { granted_at: '2026-01-01T00:00:00Z' } }],
        consultant_profiles: [{ count: 1 }],
      }),
    );
    expect(await service.getEngagementStatus('u1', 'p1')).toBe('grandfathered');
  });

  it('ineligible: pre-cutoff access but not a verified consultant', async () => {
    const service = new EngagementEligibilityService(
      stubSupabase({
        contract_positions: [{ data: [] }],
        task_time_logs: [{ count: 0 }],
        project_access: [{ data: { granted_at: '2026-01-01T00:00:00Z' } }],
        consultant_profiles: [{ count: 0 }],
      }),
    );
    expect(await service.getEngagementStatus('u1', 'p1')).toBe('ineligible');
  });

  it('caches per user+project until invalidated', async () => {
    const supabase = stubSupabase({
      contract_positions: [
        { data: [seat({ id: 'c1', status: 'active', project_id: 'p1' })] },
        { data: [] },
        { data: [] },
      ],
      task_time_logs: [{ count: 0 }, { count: 0 }],
      project_access: [{ data: null }, { data: null }],
    });
    const service = new EngagementEligibilityService(supabase);
    expect(await service.getEngagementStatus('u1', 'p1')).toBe('engaged');
    // Cached: the second call must not consume the next (empty) queue entry.
    expect(await service.getEngagementStatus('u1', 'p1')).toBe('engaged');
    service.invalidate('u1', 'p1');
    expect(await service.getEngagementStatus('u1', 'p1')).toBe('ineligible');
  });
});
