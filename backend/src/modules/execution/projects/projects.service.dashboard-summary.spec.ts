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

  // Fee visibility follows `time.view_team_logs`, which is a rung on the ladder
  // (admin and up) or an explicit capability — never a fact about how the member
  // joined. An editor does not hold it, so their project's fees stay out of the
  // total even though their time logs are counted.
  it('sums fees only for projects where the member can see team logs', async () => {
    const service = buildService({
      accessRows: [
        {
          project_id: 'editor-project',
          role: 'editor',
          origin: 'invited',
          capabilities: {},
        },
        {
          project_id: 'admin-project',
          role: 'admin',
          origin: 'invited',
          capabilities: {},
        },
      ],
      logs: [log('editor-project', 75), log('admin-project', 100)],
    });

    const summary = await service.getDashboardSummary('user-1', {});

    expect(summary.time.total_logs).toBe(2);
    expect(summary.time.total_hours).toBe(2);
    expect(summary.time.total_fees).toBe(100);
  });

  // A capability denial withholds it from someone the ladder would have granted —
  // the replacement for what ORIGIN_DELTAS.client used to do to client admins.
  it('honours a capability that withholds team-log visibility', async () => {
    const service = buildService({
      accessRows: [
        {
          project_id: 'withheld-project',
          role: 'admin',
          origin: 'invited',
          capabilities: { 'time.view_team_logs': false },
        },
      ],
      logs: [log('withheld-project', 75)],
    });

    const summary = await service.getDashboardSummary('user-1', {});

    expect(summary.time.total_logs).toBe(1);
    expect(summary.time.total_fees).toBe(0);
  });

  // The accepted consequence of removing the persona model: a member who joined
  // as a "client" is now just an admin, and admins see fees.
  it('no longer hides fees from an admin based on how they joined', async () => {
    const service = buildService({
      accessRows: [
        {
          project_id: 'client-project',
          role: 'admin',
          origin: 'client',
          capabilities: {},
        },
      ],
      logs: [log('client-project', 75)],
    });

    const summary = await service.getDashboardSummary('user-1', {});

    expect(summary.time.total_fees).toBe(75);
  });
});
