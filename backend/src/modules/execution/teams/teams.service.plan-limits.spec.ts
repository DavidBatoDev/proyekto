/* eslint-disable @typescript-eslint/unbound-method --
 * The entitlements double is a jest.Mocked<EntitlementsService>; passing its
 * members to expect() is an identity check on the mock, never a call, so
 * `this` scoping is irrelevant.
 */
import { ForbiddenException } from '@nestjs/common';
import {
  allowAllEntitlements,
  buildSeedKeyRows,
  buildSeedLimitRows,
  denyingEntitlements,
  type EntitlementsMock,
} from '../../shared/entitlements/__entitlements-test-kit-spec';
import { EntitlementsService } from '../../shared/entitlements/entitlements.service';
import { PlanLimitException } from '../../shared/entitlements/plan-limit.exception';
import { TeamsService } from './teams.service';

/**
 * The plan checks TeamsService owns, and the time settings that ride on them:
 *   - createTeam counts against the workspace's team limit (through
 *     WorkspacesService.resolveWorkspaceForCreate), while the personal team
 *     provisioned after vetting never does;
 *   - switching time tracking ON is a Pro feature. Switching it off, or
 *     re-sending true, is never gated, so a downgraded team can always wind
 *     tracking down;
 *   - the cut-off editor (pay_period_config) needs time_billable_invoices or
 *     time_payouts (D39, E60); clearing it never does;
 *   - retroactive_log_days is written through to the team time policy (D28),
 *     and the tracking / member-rates toggles bump the logging-for epoch.
 */
describe('TeamsService — plan limits', () => {
  const OWNER = 'user-owner';
  const MEMBER = 'user-member';

  const TEAM = {
    id: 'team-1',
    owner_id: OWNER,
    workspace_id: 'ws-1',
    name: 'Analytical Engines Ltd',
    tags: [],
    is_personal: false,
    time_tracking_enabled: false,
    member_rates_enabled: false,
  };

  /**
   * Chain-shape-agnostic stub, same rationale as the sibling specs: every
   * builder method returns itself and only the terminals resolve.
   * `personalTeam` is what findPersonalTeam sees; `viewerRole` is the caller's
   * team_members row.
   */
  function build(
    options: {
      team?: Record<string, unknown>;
      entitlements?: EntitlementsService;
      workspaces?: Record<string, jest.Mock>;
      viewerRole?: 'admin' | 'member' | null;
      personalTeam?: Record<string, unknown> | null;
      /** Appended optional collaborators (D28 write-through, epoch bump). */
      timePolicy?: Record<string, jest.Mock>;
      redis?: { incr: jest.Mock } | null;
      /** What the teams UPDATE ... .single() answers. */
      updateResult?: { data: unknown; error: unknown };
      /** Shared with the timePolicy mock so a spec can assert write order. */
      order?: string[];
    } = {},
  ) {
    const team = { ...TEAM, ...options.team };
    const order = options.order ?? [];
    const captured: {
      inserts: Array<{ table: string; payload: unknown }>;
      update?: Record<string, unknown>;
    } = { inserts: [] };

    const chain = (terminal: any, table: string) => {
      const c: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'ilike', 'order', 'limit']) {
        c[method] = () => c;
      }
      c.insert = (payload: unknown) => {
        captured.inserts.push({ table, payload });
        return c;
      };
      c.update = (payload: Record<string, unknown>) => {
        if (table === 'teams') {
          captured.update = payload;
          order.push('teams');
        }
        return c;
      };
      c.delete = () => c;
      c.maybeSingle = () =>
        Promise.resolve(terminal.maybeSingle ?? { data: null, error: null });
      c.single = () =>
        Promise.resolve(terminal.single ?? { data: null, error: null });
      c.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ error: null }).then(resolve);
      return c;
    };

    const supabase = {
      from: (table: string) => {
        if (table === 'teams') {
          return chain(
            {
              maybeSingle: {
                data:
                  options.personalTeam !== undefined
                    ? options.personalTeam
                    : team,
                error: null,
              },
              single: options.updateResult ?? { data: team, error: null },
            },
            table,
          );
        }
        if (table === 'team_members') {
          return chain(
            {
              maybeSingle: {
                data: options.viewerRole ? { role: options.viewerRole } : null,
                error: null,
              },
            },
            table,
          );
        }
        return chain({ maybeSingle: { data: null, error: null } }, table);
      },
    };

    const workspaces = options.workspaces ?? {
      resolveWorkspaceForWrite: jest.fn().mockResolvedValue('ws-1'),
      resolveWorkspaceForCreate: jest.fn().mockResolvedValue('ws-1'),
    };
    const entitlements = options.entitlements ?? allowAllEntitlements();

    const service = new TeamsService(
      supabase as any,
      { createNotification: jest.fn() } as any,
      { send: jest.fn() } as any,
      { get: jest.fn() } as any,
      workspaces as any,
      entitlements,
      options.timePolicy as any,
      options.redis as any,
    );
    return { service, captured, workspaces, entitlements, order };
  }

  describe('createTeam', () => {
    it('counts the new team against the resolved workspace', async () => {
      const { service, workspaces } = build();
      await service.createTeam(OWNER, {
        name: 'Engines',
        workspace_id: 'ws-2',
      } as any);
      expect(workspaces.resolveWorkspaceForCreate).toHaveBeenCalledWith(
        OWNER,
        'teams',
        'ws-2',
      );
      expect(workspaces.resolveWorkspaceForWrite).not.toHaveBeenCalled();
    });

    it('inserts nothing when the workspace is at its team limit', async () => {
      const refusal = new PlanLimitException({
        code: 'plan_limit',
        kind: 'count',
        limit_key: 'teams',
        label: 'Teams',
        limit: 2,
        used: 2,
        plan: 'free',
        upgrade_plan: 'pro',
        workspace_id: 'ws-1',
        workspace_slug: 'acme',
        context: 'create',
        message:
          'Your Free plan includes 2 teams and this workspace has 2. Upgrade to Pro to add more.',
      });
      const { service, captured } = build({
        workspaces: {
          resolveWorkspaceForWrite: jest.fn().mockResolvedValue('ws-1'),
          resolveWorkspaceForCreate: jest.fn().mockRejectedValue(refusal),
        },
      });

      await expect(
        service.createTeam(OWNER, { name: 'Engines' } as any),
      ).rejects.toBe(refusal);
      expect(captured.inserts).toEqual([]);
    });
  });

  describe('provisionPersonalTeam', () => {
    /** Personal teams are not counted, so provisioning one is never checked. */
    it('never consults the team limit or entitlements', async () => {
      const entitlements = allowAllEntitlements();
      const { service, workspaces, captured } = build({
        entitlements,
        personalTeam: null,
        team: { is_personal: true },
      });

      await service.provisionPersonalTeam(OWNER);

      expect(workspaces.resolveWorkspaceForWrite).toHaveBeenCalledWith(OWNER);
      expect(workspaces.resolveWorkspaceForCreate).not.toHaveBeenCalled();
      for (const fn of Object.values(entitlements)) {
        expect(fn as jest.Mock).not.toHaveBeenCalled();
      }
      expect(captured.inserts.map((i) => i.table)).toEqual([
        'teams',
        'team_members',
      ]);
    });
  });

  describe('updateTeam — enabling time tracking', () => {
    function timeTrackingDenied(): EntitlementsMock {
      return denyingEntitlements({
        kind: 'feature',
        limit_key: 'time_tracking',
        label: 'Time tracking and timesheets',
        limit: null,
        used: null,
        context: 'enable',
        message: 'Time tracking and timesheets are available on Pro and above.',
      });
    }

    it('refuses switching it on under a plan without the feature, and writes nothing', async () => {
      const entitlements = timeTrackingDenied();
      const { service, captured } = build({ entitlements });

      await expect(
        service.updateTeam('team-1', OWNER, {
          time_tracking_enabled: true,
        } as any),
      ).rejects.toBeInstanceOf(PlanLimitException);
      expect(entitlements.assertFeature).toHaveBeenCalledWith(
        'ws-1',
        'time_tracking',
        { context: 'enable' },
      );
      expect(captured.update).toBeUndefined();
    });

    it('refuses the whole patch, not just the switch', async () => {
      const { service, captured } = build({
        entitlements: timeTrackingDenied(),
      });

      await expect(
        service.updateTeam('team-1', OWNER, {
          name: 'Renamed',
          time_tracking_enabled: true,
        } as any),
      ).rejects.toBeInstanceOf(PlanLimitException);
      expect(captured.update).toBeUndefined();
    });

    it('lets it on when the plan has the feature', async () => {
      const entitlements = allowAllEntitlements();
      const { service, captured } = build({ entitlements });

      await service.updateTeam('team-1', OWNER, {
        time_tracking_enabled: true,
      } as any);
      expect(entitlements.assertFeature).toHaveBeenCalledTimes(1);
      expect(captured.update).toMatchObject({ time_tracking_enabled: true });
    });

    /** Wind-down must always work, whatever the plan now says. */
    it('never gates switching it off', async () => {
      const entitlements = timeTrackingDenied();
      const { service, captured } = build({
        entitlements,
        team: { time_tracking_enabled: true },
      });

      await service.updateTeam('team-1', OWNER, {
        time_tracking_enabled: false,
      } as any);
      expect(entitlements.assertFeature).not.toHaveBeenCalled();
      expect(captured.update).toMatchObject({ time_tracking_enabled: false });
    });

    it('never gates re-sending true to a team that already has it on', async () => {
      const entitlements = timeTrackingDenied();
      const { service, captured } = build({
        entitlements,
        team: { time_tracking_enabled: true },
      });

      await service.updateTeam('team-1', OWNER, {
        time_tracking_enabled: true,
      } as any);
      expect(entitlements.assertFeature).not.toHaveBeenCalled();
      expect(captured.update).toMatchObject({ time_tracking_enabled: true });
    });

    it('never gates an update that does not touch the switch', async () => {
      const entitlements = timeTrackingDenied();
      const { service, captured } = build({ entitlements });

      await service.updateTeam('team-1', OWNER, { name: 'Renamed' } as any);
      expect(entitlements.assertFeature).not.toHaveBeenCalled();
      expect(captured.update).toMatchObject({ name: 'Renamed' });
    });

    /** Permission first: a plain member gets the 403, never a plan answer. */
    it('refuses a plain member before consulting the plan', async () => {
      const entitlements = timeTrackingDenied();
      const { service } = build({ entitlements, viewerRole: 'member' });

      await expect(
        service.updateTeam('team-1', MEMBER, {
          time_tracking_enabled: true,
        } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(entitlements.assertFeature).not.toHaveBeenCalled();
    });

    /**
     * A team whose workspace was deleted is judged on Free, not exempt; the
     * team scope lookup knows that (and the guest-owner exception), so it is
     * asked instead of passing a null that would read as exempt.
     */
    it('judges a team with no workspace through its team scope', async () => {
      const entitlements = allowAllEntitlements();
      const scope = { workspaceId: null, exempt: false };
      entitlements.resolveScopeForTeam.mockResolvedValue(scope);
      const { service } = build({
        entitlements,
        team: { workspace_id: null },
      });

      await service.updateTeam('team-1', OWNER, {
        time_tracking_enabled: true,
      } as any);
      expect(entitlements.resolveScopeForTeam).toHaveBeenCalledWith('team-1');
      expect(entitlements.assertFeature).toHaveBeenCalledWith(
        scope,
        'time_tracking',
        { context: 'enable' },
      );
    });

    /** The real rule end to end: Free lacks time tracking, Pro is the fix. */
    it('carries the standard feature payload from a real EntitlementsService on Free', async () => {
      const repo = {
        listLimitKeys: jest.fn(() => Promise.resolve(buildSeedKeyRows())),
        listLimits: jest.fn(() => Promise.resolve(buildSeedLimitRows())),
        getPlanStates: jest.fn(() => Promise.resolve([])),
        getUsageCounts: jest.fn(() => Promise.resolve([])),
        getLargestRoadmaps: jest.fn(() => Promise.resolve([])),
        resolveSubject: jest.fn(() => Promise.resolve(null)),
        countRoadmapNodes: jest.fn(() => Promise.resolve(new Map())),
        listMemberWorkspaceIds: jest.fn(() => Promise.resolve([])),
      };
      const cache = {
        rememberJson: jest.fn(
          (_key: string, _ttl: number, load: () => Promise<unknown>) => load(),
        ),
        del: jest.fn(() => Promise.resolve()),
      };
      const entitlements = new EntitlementsService(
        repo as never,
        cache as never,
        { purgePaths: jest.fn(() => Promise.resolve()) } as never,
      );
      const { service, captured } = build({ entitlements });

      const error = await service
        .updateTeam('team-1', OWNER, { time_tracking_enabled: true } as any)
        .then(
          () => null,
          (err: unknown) => err,
        );

      expect(error).toBeInstanceOf(PlanLimitException);
      expect((error as PlanLimitException).payload).toMatchObject({
        kind: 'feature',
        limit_key: 'time_tracking',
        plan: 'free',
        upgrade_plan: 'pro',
        workspace_id: 'ws-1',
        context: 'enable',
      });
      expect(captured.update).toBeUndefined();
    });
  });

  /** A real EntitlementsService over the seeded matrix, every workspace on Free. */
  function realFreeEntitlements(): EntitlementsService {
    const repo = {
      listLimitKeys: jest.fn(() => Promise.resolve(buildSeedKeyRows())),
      listLimits: jest.fn(() => Promise.resolve(buildSeedLimitRows())),
      getPlanStates: jest.fn(() => Promise.resolve([])),
      getUsageCounts: jest.fn(() => Promise.resolve([])),
      getLargestRoadmaps: jest.fn(() => Promise.resolve([])),
      resolveSubject: jest.fn(() => Promise.resolve(null)),
      countRoadmapNodes: jest.fn(() => Promise.resolve(new Map())),
      listMemberWorkspaceIds: jest.fn(() => Promise.resolve([])),
    };
    const cache = {
      rememberJson: jest.fn(
        (_key: string, _ttl: number, load: () => Promise<unknown>) => load(),
      ),
      del: jest.fn(() => Promise.resolve()),
    };
    return new EntitlementsService(
      repo as never,
      cache as never,
      { purgePaths: jest.fn(() => Promise.resolve()) } as never,
    );
  }

  /**
   * "Billing and pay cut-offs" (L14, E60, D39): the schedule serves both hourly
   * invoices and payouts, so either feature opens the owner's editor.
   */
  describe('updateTeam — billing and pay cut-offs', () => {
    const CONFIG = {
      cadence: 'monthly',
      periods: [
        {
          id: 'first-half',
          label: '1st–15th',
          start_day: 1,
          end_day: 15,
          pay_day: 20,
          pay_month_offset: 0,
        },
        {
          id: 'second-half',
          label: '16th–end',
          start_day: 16,
          end_day: 'EOM',
          pay_day: 5,
          pay_month_offset: 1,
        },
      ],
    };

    function cutOffsDenied(): EntitlementsMock {
      return denyingEntitlements({
        kind: 'feature',
        limit_key: 'time_billable_invoices',
        label: 'Billable hours on invoices',
        limit: null,
        used: null,
        context: 'write',
        message: 'Billable hours on invoices are available on Pro and above.',
      });
    }

    it('refuses a schedule when the plan has neither feature, and writes nothing', async () => {
      const entitlements = cutOffsDenied();
      const { service, captured } = build({ entitlements });

      await expect(
        service.updateTeam('team-1', OWNER, {
          pay_period_config: CONFIG,
        } as any),
      ).rejects.toBeInstanceOf(PlanLimitException);
      expect(entitlements.hasFeature).toHaveBeenCalledWith(
        'ws-1',
        'time_billable_invoices',
      );
      expect(entitlements.hasFeature).toHaveBeenCalledWith(
        'ws-1',
        'time_payouts',
      );
      // The exception names time_billable_invoices, so the upgrade prompt says
      // Pro (the cheaper of the two ways in).
      expect(entitlements.assertFeature).toHaveBeenCalledWith(
        'ws-1',
        'time_billable_invoices',
      );
      expect(captured.update).toBeUndefined();
    });

    it.each(['time_billable_invoices', 'time_payouts'])(
      'opens the editor with %s alone',
      async (key) => {
        const entitlements = allowAllEntitlements();
        entitlements.hasFeature.mockImplementation((_ref, k) =>
          Promise.resolve(k === key),
        );
        const { service, captured } = build({ entitlements });

        await service.updateTeam('team-1', OWNER, {
          pay_period_config: CONFIG,
        } as any);
        expect(entitlements.assertFeature).not.toHaveBeenCalled();
        expect(captured.update).toMatchObject({
          pay_period_config: {
            cadence: 'monthly',
            periods: [
              expect.objectContaining({ id: 'first-half', end_day: 15 }),
              expect.objectContaining({ id: 'second-half', end_day: 'EOM' }),
            ],
          },
        });
      },
    );

    /** Like switching tracking off: a downgraded team can always fall back. */
    it('never gates clearing the schedule', async () => {
      const entitlements = cutOffsDenied();
      const { service, captured } = build({ entitlements });

      await service.updateTeam('team-1', OWNER, {
        pay_period_config: null,
      } as any);
      expect(entitlements.hasFeature).not.toHaveBeenCalled();
      expect(entitlements.assertFeature).not.toHaveBeenCalled();
      expect(captured.update).toMatchObject({ pay_period_config: null });
    });

    it('answers the plan before the schedule shape', async () => {
      const { service } = build({ entitlements: cutOffsDenied() });
      await expect(
        service.updateTeam('team-1', OWNER, {
          pay_period_config: { cadence: 'weekly', periods: [] },
        } as any),
      ).rejects.toBeInstanceOf(PlanLimitException);
    });

    it('still validates the schedule once the plan allows it', async () => {
      const { service, captured } = build();
      await expect(
        service.updateTeam('team-1', OWNER, {
          pay_period_config: { cadence: 'weekly', periods: [] },
        } as any),
      ).rejects.toThrow(/cadence/);
      expect(captured.update).toBeUndefined();
    });

    /** Owner-only first: an admin gets the 403, never a plan answer. */
    it('refuses an admin before consulting the plan', async () => {
      const entitlements = cutOffsDenied();
      const { service } = build({ entitlements, viewerRole: 'admin' });

      await expect(
        service.updateTeam('team-1', 'user-admin', {
          pay_period_config: CONFIG,
        } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(entitlements.hasFeature).not.toHaveBeenCalled();
    });

    it('judges a team with no workspace through its team scope, never a raw null', async () => {
      const entitlements = cutOffsDenied();
      const scope = { workspaceId: null, exempt: false };
      entitlements.resolveScopeForTeam.mockResolvedValue(scope);
      const { service } = build({ entitlements, team: { workspace_id: null } });

      await expect(
        service.updateTeam('team-1', OWNER, {
          pay_period_config: CONFIG,
        } as any),
      ).rejects.toBeInstanceOf(PlanLimitException);
      expect(entitlements.resolveScopeForTeam).toHaveBeenCalledWith('team-1');
      expect(entitlements.hasFeature).toHaveBeenCalledWith(
        scope,
        'time_payouts',
      );
      expect(entitlements.assertFeature).toHaveBeenCalledWith(
        scope,
        'time_billable_invoices',
      );
    });

    it("uses the time module's plan subject when it is wired", async () => {
      const entitlements = allowAllEntitlements();
      const timePolicy = {
        planRefForTeam: jest.fn().mockResolvedValue('ws-plan'),
        setTeamRetroactiveDays: jest.fn(),
      };
      const { service } = build({ entitlements, timePolicy });

      await service.updateTeam('team-1', OWNER, {
        pay_period_config: CONFIG,
      } as any);
      expect(timePolicy.planRefForTeam).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'team-1', workspace_id: 'ws-1' }),
      );
      expect(entitlements.hasFeature).toHaveBeenCalledWith(
        'ws-plan',
        'time_billable_invoices',
      );
    });

    it('carries the standard feature payload from a real EntitlementsService on Free', async () => {
      const { service, captured } = build({
        entitlements: realFreeEntitlements(),
      });

      const error = await service
        .updateTeam('team-1', OWNER, { pay_period_config: CONFIG } as any)
        .then(
          () => null,
          (err: unknown) => err,
        );

      expect(error).toBeInstanceOf(PlanLimitException);
      expect((error as PlanLimitException).payload).toMatchObject({
        kind: 'feature',
        limit_key: 'time_billable_invoices',
        plan: 'free',
        upgrade_plan: 'pro',
        workspace_id: 'ws-1',
      });
      expect(captured.update).toBeUndefined();
    });
  });

  /**
   * D28: teams.retroactive_log_days stays on the row (rollback safety until
   * M5), and is written through to the team's time policy, which is what the
   * time module enforces.
   */
  describe('updateTeam — retroactive days write-through', () => {
    function policy(order: string[] = []) {
      return {
        planRefForTeam: jest.fn().mockResolvedValue('ws-1'),
        setTeamRetroactiveDays: jest.fn(() => {
          order.push('policy');
          return Promise.resolve();
        }),
      };
    }

    it('writes n > 0 to the policy and keeps the team column', async () => {
      const order: string[] = [];
      const timePolicy = policy(order);
      const { service, captured } = build({ timePolicy, order });

      await service.updateTeam('team-1', OWNER, {
        retroactive_log_days: 14,
      } as any);
      expect(timePolicy.setTeamRetroactiveDays).toHaveBeenCalledWith(
        'team-1',
        14,
        OWNER,
      );
      expect(captured.update).toMatchObject({ retroactive_log_days: 14 });
      // Policy first: if it fails, nothing has changed anywhere.
      expect(order).toEqual(['policy', 'teams']);
    });

    it.each([0, null])(
      'passes %p through, which clears an override and never creates one',
      async (days) => {
        const timePolicy = policy();
        const { service, captured } = build({ timePolicy });

        await service.updateTeam('team-1', OWNER, {
          retroactive_log_days: days,
        } as any);
        expect(timePolicy.setTeamRetroactiveDays).toHaveBeenCalledWith(
          'team-1',
          days,
          OWNER,
        );
        expect(captured.update).toMatchObject({ retroactive_log_days: days });
      },
    );

    it('leaves the policy alone when the field is not sent', async () => {
      const timePolicy = policy();
      const { service } = build({ timePolicy });

      await service.updateTeam('team-1', OWNER, { name: 'Renamed' } as any);
      expect(timePolicy.setTeamRetroactiveDays).not.toHaveBeenCalled();
    });

    it('writes nothing to the team row when the policy write fails', async () => {
      const timePolicy = policy();
      timePolicy.setTeamRetroactiveDays.mockRejectedValue(
        new Error('policy write failed'),
      );
      const { service, captured } = build({ timePolicy });

      await expect(
        service.updateTeam('team-1', OWNER, {
          retroactive_log_days: 7,
        } as any),
      ).rejects.toThrow('policy write failed');
      expect(captured.update).toBeUndefined();
    });

    /** The write-through does no authorisation of its own. */
    it('never reaches the policy for an admin', async () => {
      const timePolicy = policy();
      const { service } = build({ timePolicy, viewerRole: 'admin' });

      await expect(
        service.updateTeam('team-1', 'user-admin', {
          retroactive_log_days: 30,
        } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(timePolicy.setTeamRetroactiveDays).not.toHaveBeenCalled();
    });

    it('never reaches the policy when another check in the patch fails', async () => {
      const timePolicy = policy();
      const { service } = build({ timePolicy });

      await expect(
        service.updateTeam('team-1', OWNER, {
          retroactive_log_days: 30,
          payouts_enabled: true,
        } as any),
      ).rejects.toThrow(/member rates/i);
      expect(timePolicy.setTeamRetroactiveDays).not.toHaveBeenCalled();
    });

    it('still saves the team column when the time module is not wired', async () => {
      const { service, captured } = build();
      await service.updateTeam('team-1', OWNER, {
        retroactive_log_days: 14,
      } as any);
      expect(captured.update).toMatchObject({ retroactive_log_days: 14 });
    });

    it('keeps storing contract_enforcement, which no longer has any effect', async () => {
      const timePolicy = policy();
      const { service, captured } = build({ timePolicy });

      await service.updateTeam('team-1', OWNER, {
        contract_enforcement: 'enforce',
      } as any);
      expect(captured.update).toMatchObject({
        contract_enforcement: 'enforce',
      });
      expect(timePolicy.setTeamRetroactiveDays).not.toHaveBeenCalled();
    });
  });

  /**
   * The For resolver caches options for 30 s under `time:lf:epoch`. Tracking
   * adds or removes the team option and member rates change its rate source,
   * so either toggle bumps the epoch (CC17).
   */
  describe('updateTeam — logging-for epoch', () => {
    /** [field, patch, the team's current values] */
    const TOGGLES: Array<
      [string, Record<string, unknown>, Record<string, unknown>]
    > = [
      ['time_tracking_enabled', { time_tracking_enabled: true }, {}],
      [
        'time_tracking_enabled',
        { time_tracking_enabled: false },
        { time_tracking_enabled: true },
      ],
      ['member_rates_enabled', { member_rates_enabled: true }, {}],
      [
        'member_rates_enabled',
        { member_rates_enabled: false },
        { member_rates_enabled: true },
      ],
    ];

    it.each(TOGGLES)(
      'bumps it when %s changes',
      async (_field, patch, current) => {
        const redis = { incr: jest.fn().mockResolvedValue(2) };
        const { service } = build({ redis, team: current });

        await service.updateTeam('team-1', OWNER, patch as any);
        expect(redis.incr).toHaveBeenCalledTimes(1);
        expect(redis.incr).toHaveBeenCalledWith('time:lf:epoch');
      },
    );

    it('does not bump it for a re-sent value or an unrelated field', async () => {
      const redis = { incr: jest.fn().mockResolvedValue(2) };
      const { service } = build({
        redis,
        team: { time_tracking_enabled: true, member_rates_enabled: true },
      });

      await service.updateTeam('team-1', OWNER, {
        time_tracking_enabled: true,
        member_rates_enabled: true,
        name: 'Renamed',
      } as any);
      expect(redis.incr).not.toHaveBeenCalled();
    });

    it('bumps only after the team row is saved', async () => {
      const redis = { incr: jest.fn().mockResolvedValue(2) };
      const { service } = build({
        redis,
        updateResult: { data: null, error: { message: 'boom' } },
      });

      await expect(
        service.updateTeam('team-1', OWNER, {
          time_tracking_enabled: true,
        } as any),
      ).rejects.toThrow();
      expect(redis.incr).not.toHaveBeenCalled();
    });

    it('never fails the update when Redis does', async () => {
      const redis = { incr: jest.fn().mockRejectedValue(new Error('down')) };
      const { service, captured } = build({ redis });

      await expect(
        service.updateTeam('team-1', OWNER, {
          member_rates_enabled: true,
        } as any),
      ).resolves.toBeDefined();
      expect(captured.update).toMatchObject({ member_rates_enabled: true });
    });

    it('is a no-op without Redis', async () => {
      const { service } = build({ redis: null });
      await expect(
        service.updateTeam('team-1', OWNER, {
          time_tracking_enabled: true,
        } as any),
      ).resolves.toBeDefined();
    });
  });
});
