import type { SupabaseClient } from '@supabase/supabase-js';
import { ProjectsService } from './projects.service';

type Row = Record<string, unknown>;

function resultBuilder(data: Row[]) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'is']) {
    builder[method] = jest.fn(() => builder);
  }
  builder.then = (resolve: (value: object) => void) =>
    Promise.resolve({ data, error: null }).then(resolve);
  return builder;
}

function buildService(input: {
  accessRows?: Row[];
  logs: Row[];
  singleProjectCanViewFees?: boolean;
}) {
  const supabase = {
    from: jest.fn((table: string) => {
      if (table === 'project_access') {
        return resultBuilder(input.accessRows ?? []);
      }
      if (table === 'task_time_logs') return resultBuilder(input.logs);
      if (table === 'invoices') return resultBuilder([]);
      if (table === 'team_member_rates') return resultBuilder([]);
      return resultBuilder([]);
    }),
  } as unknown as SupabaseClient;
  const authorization = {
    assertRole: jest.fn().mockResolvedValue('viewer'),
    resolvePermissions: jest.fn().mockResolvedValue({
      time: { view_team_logs: input.singleProjectCanViewFees ?? false },
    }),
  };
  return new ProjectsService(
    {} as never,
    {} as never,
    authorization as never,
    {} as never,
    {} as never,
    supabase,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

const log = (projectId: string, rate: number): Row => ({
  id: `log-${projectId}`,
  project_id: projectId,
  team_id: null,
  member_user_id: 'member-1',
  started_at: '2026-08-13T00:00:00.000Z',
  duration_seconds: 3600,
  status: 'approved',
  rate_snapshot: rate,
});

describe('ProjectsService dashboard fee visibility', () => {
  it('keeps counts and hours but zeroes fees without team-log visibility', async () => {
    const service = buildService({
      logs: [log('project-1', 50)],
      singleProjectCanViewFees: false,
    });

    const summary = await service.getDashboardSummary('client-1', {
      project_id: 'project-1',
    });

    expect(summary.time).toEqual(
      expect.objectContaining({
        total_logs: 1,
        total_hours: 1,
        total_fees: 0,
      }),
    );
  });

  it('includes fees when the single-project permission allows them', async () => {
    const service = buildService({
      logs: [log('project-1', 50)],
      singleProjectCanViewFees: true,
    });

    const summary = await service.getDashboardSummary('consultant-1', {
      project_id: 'project-1',
    });

    expect(summary.time.total_fees).toBe(50);
  });

  it('sums only permitted projects in a fan-out request', async () => {
    const service = buildService({
      accessRows: [
        {
          project_id: 'client-project',
          role: 'admin',
          origin: 'client',
          capabilities: {},
        },
        {
          project_id: 'consultant-project',
          role: 'owner',
          origin: 'consultant',
          capabilities: {},
        },
      ],
      logs: [log('client-project', 75), log('consultant-project', 100)],
    });

    const summary = await service.getDashboardSummary('user-1', {});

    expect(summary.time.total_logs).toBe(2);
    expect(summary.time.total_hours).toBe(2);
    expect(summary.time.total_fees).toBe(100);
  });
});
