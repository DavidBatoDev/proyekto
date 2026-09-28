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
 * The two plan checks TeamsService owns:
 *   - createTeam counts against the workspace's team limit (through
 *     WorkspacesService.resolveWorkspaceForCreate), while the personal team
 *     provisioned after vetting never does;
 *   - switching time tracking ON is a Pro feature. Switching it off, or
 *     re-sending true, is never gated, so a downgraded team can always wind
 *     tracking down.
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
    } = {},
  ) {
    const team = { ...TEAM, ...options.team };
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
        if (table === 'teams') captured.update = payload;
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
              single: { data: team, error: null },
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
    );
    return { service, captured, workspaces, entitlements };
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
});
