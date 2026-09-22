/* eslint-disable @typescript-eslint/unbound-method --
 * The entitlements double is a jest.Mocked<EntitlementsService>; passing its
 * members to expect() is an identity check on the mock, never a call, so
 * `this` scoping is irrelevant. */
import {
  allowAllEntitlements,
  denyingEntitlements,
  type EntitlementsMock,
} from '../../shared/entitlements/__entitlements-test-kit-spec';
import { PlanLimitException } from '../../shared/entitlements/plan-limit.exception';
import { TeamTimeService, type ResolvedTeamRate } from './team-time.service';

/**
 * The time_tracking plan gate.
 *
 * What creates or changes logged time is refused on a plan without the
 * feature; winding down existing work (pause, resume, stop, review) is not,
 * so a downgrade cannot strand a running timer or a payout. The TEAM's
 * workspace decides, never the project's.
 *
 * The service's own lookups (team rate, log fetch, access checks) are stubbed
 * on the instance: every assertion here is about whether the gate runs, and
 * whether anything is written when it refuses.
 */

const CALLER = 'member-1';
const TEAM = 'team-1';
const PROJECT = 'project-1';
const LOG_ID = 'log-1';

type Queued = { data?: unknown; error?: unknown };

interface FakeSupabase {
  from: jest.Mock;
  writes: string[];
}

/**
 * Hands out one awaitable query per from() call, in order, and records every
 * write verb so a refused call can prove it wrote nothing.
 */
function fakeSupabase(queued: Queued[] = []): FakeSupabase {
  const writes: string[] = [];
  let index = 0;
  const from = jest.fn((table: string) => {
    const response = queued[index++] ?? { data: [], error: null };
    const query: Record<string, unknown> = {};
    for (const method of [
      'select',
      'eq',
      'in',
      'is',
      'order',
      'limit',
      'single',
      'maybeSingle',
    ]) {
      query[method] = jest.fn(() => query);
    }
    for (const verb of ['insert', 'update', 'delete', 'upsert']) {
      query[verb] = jest.fn(() => {
        writes.push(`${verb}:${table}`);
        return query;
      });
    }
    query.then = (
      resolve: (value: unknown) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(response).then(resolve, reject);
    return query;
  });
  return { from, writes };
}

function rate(overrides: Partial<ResolvedTeamRate> = {}): ResolvedTeamRate {
  return {
    team_id: TEAM,
    time_tracking_enabled: true,
    rate_type: 'hourly',
    hourly_rate: 25,
    training_hourly_rate: 0,
    currency: 'USD',
    weekly_limit_hours: null,
    monthly_limit_hours: null,
    overtime_requires_approval: false,
    ...overrides,
  };
}

function logRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LOG_ID,
    project_id: PROJECT,
    task_id: null,
    member_user_id: CALLER,
    team_id: TEAM,
    started_at: '2026-09-22T08:00:00.000Z',
    ended_at: null,
    duration_seconds: null,
    break_minutes: 0,
    break_seconds: 0,
    paused_at: null,
    status: 'pending',
    source: 'timer',
    ...overrides,
  };
}

function build(entitlements: EntitlementsMock, queued: Queued[] = []) {
  const supabase = fakeSupabase(queued);
  const projectAuth = { assertRole: jest.fn().mockResolvedValue(undefined) };
  const notifications = { createNotification: jest.fn() };
  const service = new TeamTimeService(
    supabase as never,
    projectAuth as never,
    notifications as never,
    {} as never,
    entitlements,
  );
  const internals = service as any;
  const spies = {
    resolveTeamRate: jest
      .spyOn(internals, 'resolveTeamRate')
      .mockResolvedValue(rate()),
    fetchLogOrThrow: jest
      .spyOn(internals, 'fetchLogOrThrow')
      .mockResolvedValue(logRow()),
    assertCanViewFetchedLog: jest
      .spyOn(internals, 'assertCanViewFetchedLog')
      .mockResolvedValue(undefined),
    assertWithinRetroactiveWindow: jest
      .spyOn(internals, 'assertWithinRetroactiveWindow')
      .mockResolvedValue(undefined),
    assertHourCapAllows: jest
      .spyOn(internals, 'assertHourCapAllows')
      .mockResolvedValue(undefined),
    resolveMemberDisplayNameSnapshot: jest
      .spyOn(internals, 'resolveMemberDisplayNameSnapshot')
      .mockResolvedValue('Member One'),
    openSegment: jest
      .spyOn(internals, 'openSegment')
      .mockResolvedValue(undefined),
    closeOpenSegment: jest
      .spyOn(internals, 'closeOpenSegment')
      .mockResolvedValue(undefined),
    attachLimitContext: jest
      .spyOn(internals, 'attachLimitContext')
      .mockImplementation((row: unknown) => Promise.resolve(row)),
    attachReviewContext: jest
      .spyOn(internals, 'attachReviewContext')
      .mockImplementation((row: unknown) => Promise.resolve(row)),
    notifyApprovalRequested: jest
      .spyOn(internals, 'notifyApprovalRequested')
      .mockResolvedValue(undefined),
    notifyLogCommentAdded: jest
      .spyOn(internals, 'notifyLogCommentAdded')
      .mockResolvedValue(undefined),
    notifyReviewOutcome: jest
      .spyOn(internals, 'notifyReviewOutcome')
      .mockResolvedValue(undefined),
    assertTeamApprover: jest
      .spyOn(internals, 'assertTeamApprover')
      .mockResolvedValue(undefined),
    applyReview: jest
      .spyOn(internals, 'applyReview')
      .mockResolvedValue([logRow({ member_user_id: 'member-2' })]),
    computeDaySummaryForLog: jest
      .spyOn(internals, 'computeDaySummaryForLog')
      .mockResolvedValue(null),
  };
  return { service, supabase, projectAuth, spies, entitlements };
}

type Built = ReturnType<typeof build>;

/** A wind-down verb must not even look the plan up. */
function expectPlanUntouched(b: Built) {
  expect(b.entitlements.resolveScopeForTeam).not.toHaveBeenCalled();
  expect(b.entitlements.assertFeature).not.toHaveBeenCalled();
}

const GATED: Array<{ name: string; run: (b: Built) => Promise<unknown> }> = [
  {
    name: 'startLog',
    run: (b) => b.service.startLog(CALLER, { project_id: PROJECT } as never),
  },
  {
    name: 'createManualLog',
    run: (b) =>
      b.service.createManualLog(CALLER, {
        project_id: PROJECT,
        started_at: '2026-09-22T08:00:00.000Z',
        ended_at: '2026-09-22T09:00:00.000Z',
      } as never),
  },
  {
    name: 'updateLog',
    run: (b) =>
      b.service.updateLog(CALLER, LOG_ID, {
        ended_at: '2026-09-22T09:00:00.000Z',
      } as never),
  },
  {
    name: 'deleteLog',
    run: (b) => b.service.deleteLog(CALLER, LOG_ID),
  },
  {
    name: 'createLogComment',
    run: (b) =>
      b.service.createLogComment(CALLER, LOG_ID, { body: 'Why 9h?' } as never),
  },
];

describe('TeamTimeService time_tracking plan gate', () => {
  describe.each(GATED)('$name', ({ run }) => {
    it('is refused on a plan without time tracking, writing nothing', async () => {
      const b = build(
        denyingEntitlements({ kind: 'feature', limit_key: 'time_tracking' }),
      );

      await expect(run(b)).rejects.toBeInstanceOf(PlanLimitException);

      expect(b.supabase.writes).toEqual([]);
      expect(b.spies.openSegment).not.toHaveBeenCalled();
      expect(b.spies.notifyApprovalRequested).not.toHaveBeenCalled();
      expect(b.spies.notifyLogCommentAdded).not.toHaveBeenCalled();
    });

    it("judges the TEAM's workspace, as a write", async () => {
      const b = build(allowAllEntitlements());
      const scope = { workspaceId: 'ws-team', exempt: false };
      b.entitlements.resolveScopeForTeam.mockResolvedValue(scope);

      await run(b).catch(() => undefined);

      expect(b.entitlements.resolveScopeForTeam).toHaveBeenCalledWith(TEAM);
      expect(b.entitlements.resolveScopeForProject).not.toHaveBeenCalled();
      expect(b.entitlements.assertFeature).toHaveBeenCalledWith(
        scope,
        'time_tracking',
        { context: 'write' },
      );
    });
  });

  it('checks access before the plan: a log you cannot touch never reaches the gate', async () => {
    const b = build(denyingEntitlements());
    b.spies.fetchLogOrThrow.mockResolvedValue(
      logRow({ member_user_id: 'someone-else' }),
    );

    await expect(
      b.service.deleteLog(CALLER, LOG_ID),
    ).rejects.not.toBeInstanceOf(PlanLimitException);
    expect(b.entitlements.resolveScopeForTeam).not.toHaveBeenCalled();
  });

  it('gates the new team too when an edit reroutes the log', async () => {
    const b = build(allowAllEntitlements());
    b.spies.fetchLogOrThrow.mockResolvedValue(logRow({ task_id: 'task-a' }));
    jest.spyOn(b.service as any, 'fetchTaskContextOrThrow').mockResolvedValue({
      project_id: 'project-2',
      work_type: 'real_work',
    });
    b.spies.resolveTeamRate.mockResolvedValue(rate({ team_id: 'team-2' }));

    await b.service
      .updateLog(CALLER, LOG_ID, { task_id: 'task-b' } as never)
      .catch(() => undefined);

    expect(b.entitlements.resolveScopeForTeam.mock.calls).toEqual([
      [TEAM],
      ['team-2'],
    ]);
  });

  it('lets a log with no team (personal workspace) through without a lookup', async () => {
    const b = build(denyingEntitlements());
    b.spies.fetchLogOrThrow.mockResolvedValue(logRow({ team_id: null }));

    await expect(b.service.deleteLog(CALLER, LOG_ID)).resolves.toBeUndefined();
    expect(b.entitlements.resolveScopeForTeam).not.toHaveBeenCalled();
    expect(b.supabase.writes).toEqual(['delete:task_time_logs']);
  });

  describe('winding down stays open on a plan without time tracking', () => {
    const running = logRow();
    const paused = logRow({ paused_at: '2026-09-22T08:30:00.000Z' });

    it('pauseLog', async () => {
      const b = build(denyingEntitlements(), [{ data: running, error: null }]);
      b.spies.fetchLogOrThrow.mockResolvedValue(running);

      await expect(b.service.pauseLog(CALLER, LOG_ID)).resolves.toBeDefined();
      expect(b.supabase.writes).toEqual(['update:task_time_logs']);
      expectPlanUntouched(b);
    });

    it('resumeLog', async () => {
      const b = build(denyingEntitlements(), [{ data: paused, error: null }]);
      b.spies.fetchLogOrThrow.mockResolvedValue(paused);

      await expect(b.service.resumeLog(CALLER, LOG_ID)).resolves.toBeDefined();
      expect(b.supabase.writes).toEqual(['update:task_time_logs']);
      expectPlanUntouched(b);
    });

    it('stopLog', async () => {
      const b = build(denyingEntitlements(), [
        { data: [running], error: null },
      ]);
      b.spies.fetchLogOrThrow.mockResolvedValue(running);

      await expect(
        b.service.stopLog(CALLER, LOG_ID, {} as never),
      ).resolves.toBeDefined();
      expect(b.supabase.writes).toEqual(['update:task_time_logs']);
      expectPlanUntouched(b);
    });

    it('stopRunningLogsForProject', async () => {
      const b = build(denyingEntitlements(), [
        { data: [running], error: null },
        { data: null, error: null },
      ]);

      await expect(b.service.stopRunningLogsForProject(PROJECT)).resolves.toBe(
        1,
      );
      expect(b.supabase.writes).toEqual(['update:task_time_logs']);
      expectPlanUntouched(b);
    });

    it('reviewLog', async () => {
      const b = build(denyingEntitlements());
      b.spies.fetchLogOrThrow.mockResolvedValue(
        logRow({ member_user_id: 'member-2' }),
      );

      await expect(
        b.service.reviewLog('approver-1', LOG_ID, {
          decision: 'approved',
        } as never),
      ).resolves.toBeDefined();
      expect(b.spies.applyReview).toHaveBeenCalled();
      expectPlanUntouched(b);
    });

    it('reviewLogsBulk', async () => {
      const b = build(denyingEntitlements(), [
        {
          data: [{ id: LOG_ID, team_id: TEAM, member_user_id: 'member-2' }],
          error: null,
        },
      ]);

      await expect(
        b.service.reviewLogsBulk('approver-1', {
          log_ids: [LOG_ID],
          decision: 'approved',
        } as never),
      ).resolves.toEqual({ reviewed: 1, day_summaries: [] });
      expect(b.spies.applyReview).toHaveBeenCalled();
      expectPlanUntouched(b);
    });
  });

  it('never consults the plan for any wind-down verb', async () => {
    const b = build(denyingEntitlements(), [
      { data: logRow(), error: null },
      { data: logRow({ paused_at: null }), error: null },
      { data: [logRow()], error: null },
    ]);
    b.spies.fetchLogOrThrow
      .mockResolvedValueOnce(logRow())
      .mockResolvedValueOnce(logRow({ paused_at: '2026-09-22T08:30:00.000Z' }))
      .mockResolvedValueOnce(logRow());

    await b.service.pauseLog(CALLER, LOG_ID);
    await b.service.resumeLog(CALLER, LOG_ID);
    await b.service.stopLog(CALLER, LOG_ID, {} as never);

    expect(b.entitlements.resolveScopeForTeam).not.toHaveBeenCalled();
    expect(b.entitlements.assertFeature).not.toHaveBeenCalled();
  });
});
