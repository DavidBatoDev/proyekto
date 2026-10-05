import {
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  NoopProjectCommerce,
  type ProjectCommercePort,
} from './ports/project-commerce.port';
import { ProjectsService } from './projects.service';
import {
  type DashboardTime,
  emptyDashboardTime,
} from '../time/time-projects.facade';

type Row = Record<string, unknown>;

function resultBuilder(data: Row[] | Row | null, error: unknown = null) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'is']) {
    builder[method] = jest.fn(() => builder);
  }
  builder.maybeSingle = jest.fn(() =>
    Promise.resolve({ data: Array.isArray(data) ? data[0] : data, error }),
  );
  builder.then = (resolve: (value: object) => void) =>
    Promise.resolve({
      data,
      error,
      count: Array.isArray(data) ? data.length : 0,
    }).then(resolve);
  return builder;
}

/** What TimeProjectsFacade.dashboardTime answers: the summary passes it through untouched. */
function timeBlock(): DashboardTime {
  return {
    time: {
      total_logs: 4,
      total_seconds: 9000,
      total_hours: 2.5,
      status_counts: { pending: 1, approved: 1, paid: 1, rejected: 1 },
      sheet_status_counts: {
        open: 1,
        submitted: 0,
        returned: 0,
        approved: 2,
        personal: 1,
      },
      total_fees: 12.5,
    },
    overtime: { over_limit_windows: 1, overage_hours_total: 5 },
  };
}

function buildService(input: {
  accessRows?: Row[];
  accessError?: { message: string };
  role?: string;
  commerce?: Partial<ProjectCommercePort>;
  teams?: Row[];
  teamMembers?: Row[];
}) {
  const from = jest.fn((table: string) => {
    if (table === 'project_access') {
      return resultBuilder(input.accessRows ?? [], input.accessError ?? null);
    }
    if (table === 'teams') return resultBuilder(input.teams ?? []);
    if (table === 'team_members') return resultBuilder(input.teamMembers ?? []);
    // The time block no longer reads any time table from ProjectsService.
    throw new Error(`unexpected table ${table}`);
  });
  const supabase = { from } as unknown as SupabaseClient;
  const authorization = {
    assertRole: jest.fn().mockResolvedValue(input.role ?? 'viewer'),
    resolvePermissions: jest.fn(),
  };
  const time = {
    dashboardTime: jest.fn().mockResolvedValue(timeBlock()),
  };
  const service = new ProjectsService(
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
    { log: jest.fn() } as never,
    time as never,
    {} as never,
    // Object.assign, not a spread: NoopProjectCommerce's methods live on the
    // prototype, and spreading an instance copies only own properties.
    Object.assign(
      new NoopProjectCommerce(),
      input.commerce ?? {},
    ) as ProjectCommercePort,
  );
  return { service, time, authorization, from };
}

describe('ProjectsService dashboard time block', () => {
  it('delegates the time and overtime block to the time facade and passes its shape through', async () => {
    const { service, time } = buildService({
      accessRows: [
        { project_id: 'project-1', role: 'editor' },
        { project_id: 'project-2', role: 'admin' },
        { project_id: 'project-1', role: 'editor' },
      ],
    });

    const summary = await service.getDashboardSummary('user-1', {
      from: '2026-09-01',
      to: '2026-09-30',
      member_user_id: 'member-1',
    });

    expect(time.dashboardTime).toHaveBeenCalledWith(
      'user-1',
      ['project-1', 'project-2'],
      {
        from: '2026-09-01',
        to: '2026-09-30',
        team_id: undefined,
        member_user_id: 'member-1',
      },
    );
    expect(summary.time).toEqual(timeBlock().time);
    expect(summary.time.sheet_status_counts).toEqual({
      open: 1,
      submitted: 0,
      returned: 0,
      approved: 2,
      personal: 1,
    });
    expect(summary.overtime).toEqual(timeBlock().overtime);
    expect(summary.filters).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
      project_id: null,
      team_id: null,
      member_user_id: 'member-1',
    });
  });

  // Fees used to follow `time.view_team_logs`; they are now the facade's
  // costVisible sum, so the project ladder is not consulted at all.
  it('takes fees from the facade, never from time.view_team_logs', async () => {
    const { service, authorization } = buildService({ role: 'viewer' });

    const summary = await service.getDashboardSummary('client-1', {
      project_id: 'project-1',
    });

    expect(summary.time.total_fees).toBe(12.5);
    expect(authorization.assertRole).toHaveBeenCalledWith(
      'client-1',
      'project-1',
      'viewer',
    );
    expect(authorization.resolvePermissions).not.toHaveBeenCalled();
  });

  it('scopes a single-project summary to that project', async () => {
    const { service, time, from } = buildService({ role: 'admin' });

    await service.getDashboardSummary('user-1', { project_id: 'project-1' });

    expect(time.dashboardTime).toHaveBeenCalledWith(
      'user-1',
      ['project-1'],
      expect.any(Object),
    );
    expect(from).not.toHaveBeenCalledWith('project_access');
  });

  it('answers the zero shape, sheet_status_counts included, without asking the facade when there are no projects', async () => {
    const { service, time } = buildService({ accessRows: [] });

    const summary = await service.getDashboardSummary('user-1', {});

    expect(time.dashboardTime).not.toHaveBeenCalled();
    expect(summary.time).toEqual(emptyDashboardTime().time);
    expect(summary.overtime).toEqual(emptyDashboardTime().overtime);
    expect(summary.invoices.total_count).toBe(0);
  });

  it('refuses a team filter the caller has no part in', async () => {
    const { service, time } = buildService({
      accessRows: [{ project_id: 'project-1', role: 'admin' }],
      teams: [{ id: 'team-1', owner_id: 'someone-else' }],
      teamMembers: [],
    });

    await expect(
      service.getDashboardSummary('user-1', { team_id: 'team-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(time.dashboardTime).not.toHaveBeenCalled();
  });

  it('never puts Postgres text in the response when a pre-check read fails', async () => {
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { service } = buildService({
      accessError: { message: 'relation "project_access" secret detail' },
    });

    const failure = service.getDashboardSummary('user-1', {});
    await expect(failure).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(failure).rejects.not.toThrow(/secret detail/);
    // The Postgres text goes to the log instead.
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining('secret detail'),
    );
    logged.mockRestore();
  });
});

describe('ProjectsService dashboard invoice summary', () => {
  it('reports invoice totals from the commerce port, not from Supabase', async () => {
    const getInvoiceSummary = jest.fn().mockResolvedValue({
      total_count: 3,
      total_amount: 1200.456,
      status_counts: { draft: 1, issued: 0, sent: 1, paid: 1, void: 0 },
    });
    const { service } = buildService({
      accessRows: [{ project_id: 'project-1', role: 'owner' }],
      commerce: { getInvoiceSummary },
    });

    const summary = await service.getDashboardSummary('user-1', {});

    expect(getInvoiceSummary).toHaveBeenCalledTimes(1);
    expect(summary.invoices.total_count).toBe(3);
    // Rounding is the summary's presentation rule and stays in execution.
    expect(summary.invoices.total_amount).toBe(1200.46);
    expect(summary.invoices.status_counts.paid).toBe(1);
  });

  it('passes the date filters through to the port', async () => {
    const getInvoiceSummary = jest.fn().mockResolvedValue({
      total_count: 0,
      total_amount: 0,
      status_counts: {},
    });
    const { service } = buildService({
      accessRows: [{ project_id: 'project-1', role: 'admin' }],
      commerce: { getInvoiceSummary },
    });

    await service.getDashboardSummary('user-1', {
      from: '2026-01-01',
      to: '2026-02-01',
    });

    expect(getInvoiceSummary).toHaveBeenCalledWith(expect.any(Array), {
      from: '2026-01-01',
      to: '2026-02-01',
    });
  });

  it("totals only the caller's own projects, not every project they administer", async () => {
    // An admin on someone else's project reads its invoices inside that
    // project; they are not part of the admin's own book, and totalling them
    // here put money on a dashboard whose Finance surface showed none of it.
    const getInvoiceSummary = jest.fn().mockResolvedValue({
      total_count: 0,
      total_amount: 0,
      status_counts: {},
    });
    const { service } = buildService({
      accessRows: [
        { project_id: 'mine', role: 'owner' },
        { project_id: 'theirs', role: 'admin' },
      ],
      commerce: { getInvoiceSummary },
    });

    await service.getDashboardSummary('user-1', {});

    expect(getInvoiceSummary).toHaveBeenCalledWith(['mine'], expect.anything());
  });

  it('counts a single owned project for invoices', async () => {
    const getInvoiceSummary = jest.fn().mockResolvedValue({
      total_count: 0,
      total_amount: 0,
      status_counts: {},
    });
    const { service } = buildService({
      role: 'owner',
      commerce: { getInvoiceSummary },
    });

    await service.getDashboardSummary('user-1', { project_id: 'project-1' });

    expect(getInvoiceSummary).toHaveBeenCalledWith(
      ['project-1'],
      expect.anything(),
    );
  });

  it('reports zeroes when no commerce implementation is bound', async () => {
    const { service } = buildService({
      accessRows: [{ project_id: 'project-1', role: 'admin' }],
    });

    const summary = await service.getDashboardSummary('user-1', {});

    expect(summary.invoices.total_count).toBe(0);
    expect(summary.invoices.total_amount).toBe(0);
  });
});
