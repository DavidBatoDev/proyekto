import { ForbiddenException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isTeamManager } from './team-authority';
import { TeamsService } from './teams.service';
import { allowAllEntitlements } from '../../shared/entitlements/__entitlements-test-kit-spec';

/**
 * The Overview tab widened `updateTeam` from owner-only to owner-or-admin so a
 * team admin can edit the team's identity. The risk that widening creates is
 * not "admins can edit" — it is admins quietly acquiring a field they should
 * never have had.
 *
 * So these tests are deliberately field-by-field rather than one representative
 * case. There is a compile-time exhaustiveness check in teams.service.ts that
 * makes an *unclassified* field a tsc error; what it cannot catch is a field
 * classified into the wrong list. That is what the per-field loop below pins,
 * and it is the assertion most likely to still be earning its keep in two
 * years, when someone adds a payout field in a hurry.
 */
describe('TeamsService — updateTeam permissions', () => {
  const OWNER = 'user-owner';
  const ADMIN = 'user-admin';
  const MEMBER = 'user-member';
  const STRANGER = 'user-stranger';

  const TEAM = {
    id: 'team-1',
    owner_id: OWNER,
    name: 'Analytical Engines Ltd',
    tags: [],
  };

  /**
   * Chain-shape-agnostic stub, same rationale as the sibling tags spec: every
   * builder method returns itself and only the terminals resolve, so adding a
   * filter to an unrelated query cannot break these tests.
   *
   * `viewerRole` is what `team_members` reports for the caller — which is how
   * resolveViewerRole decides admin vs member vs nothing. The owner never
   * reaches that query (owner_id short-circuits it).
   */
  function build(
    viewerRole: 'admin' | 'member' | null,
    timePolicy?: Record<string, jest.Mock>,
  ) {
    const captured: { update?: Record<string, unknown> } = {};

    const chain = (terminal: any, table: string) => {
      const c: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'ilike', 'order', 'limit']) {
        c[method] = () => c;
      }
      c.update = (payload: Record<string, unknown>) => {
        if (table === 'teams') captured.update = payload;
        return c;
      };
      c.insert = () => c;
      c.maybeSingle = () =>
        Promise.resolve(terminal.maybeSingle ?? { data: null, error: null });
      c.single = () =>
        Promise.resolve(terminal.single ?? { data: null, error: null });
      c.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ error: null }).then(resolve);
      return c;
    };

    const supabase = {
      from: (table: string) =>
        chain(
          table === 'teams'
            ? {
                maybeSingle: { data: TEAM },
                single: { data: TEAM, error: null },
              }
            : {
                maybeSingle: {
                  data: viewerRole ? { role: viewerRole } : null,
                  error: null,
                },
              },
          table,
        ),
    };

    const service = new TeamsService(
      supabase as any,
      { createNotification: jest.fn() } as any,
      { send: jest.fn() } as any,
      { get: jest.fn() } as any,
      {
        resolveWorkspaceForWrite: jest.fn().mockResolvedValue('ws-1'),
        resolveWorkspaceForCreate: jest.fn().mockResolvedValue('ws-1'),
      } as any,
      allowAllEntitlements(),
      timePolicy as any,
    );

    return { service, captured };
  }

  /** A schedule the validator accepts (the owner-only cut-off editor, D39). */
  const PAY_PERIOD_CONFIG = {
    cadence: 'monthly',
    periods: [
      {
        id: 'month',
        label: 'Whole month',
        start_day: 1,
        end_day: 'EOM',
        pay_day: 5,
        pay_month_offset: 1,
      },
    ],
  };

  /** Money and legal identity. An admin must be refused every one of these. */
  const OWNER_ONLY_PATCHES: Array<[string, Record<string, unknown>]> = [
    ['legal_name', { legal_name: 'Rogue Holdings' }],
    // How the team is named on paper; intake treats it as the team.
    ['trading_names', { trading_names: ['ROGUE HOLDINGS'] }],
    ['billing_address', { billing_address: '1 Rogue Way' }],
    ['tax_id', { tax_id: 'ROGUE-1' }],
    ['billing_email', { billing_email: 'rogue@example.com' }],
    // Whether hours carry a cost at all, and whether the team settles them
    // here. Both must stay owner-only — an admin must never be able to commit
    // the team to paying people, nor hide the rate card the owner set.
    ['member_rates_enabled', { member_rates_enabled: true }],
    ['payouts_enabled', { payouts_enabled: false }],
    ['retroactive_log_days', { retroactive_log_days: 90 }],
    ['default_currency', { default_currency: 'PHP' }],
    ['pay_period_config', { pay_period_config: null }],
    // A real schedule as well as a clear: setting one is also plan-gated
    // (D39), which must never turn the admin's 403 into a plan answer.
    ['pay_period_config', { pay_period_config: PAY_PERIOD_CONFIG }],
    // Deprecated (no effect since the time rebuild) but still owner-only.
    ['contract_enforcement', { contract_enforcement: 'enforce' }],
  ];

  /**
   * The team's identity — the Overview tab's surface — plus the time-tracking
   * switch, which is operational rather than financial: it decides whether
   * hours may be logged, never what they are worth.
   */
  const SHARED_PATCHES: Array<[string, Record<string, unknown>]> = [
    ['name', { name: 'Renamed' }],
    ['description', { description: '<p>Our team</p>' }],
    ['avatar_url', { avatar_url: 'https://cdn.example.com/a.png' }],
    ['status', { status: 'paused' }],
    ['tags', { tags: ['design'] }],
    ['time_tracking_enabled', { time_tracking_enabled: true }],
  ];

  describe('an admin', () => {
    it.each(SHARED_PATCHES)('may change %s', async (field, patch) => {
      const { service, captured } = build('admin');
      await service.updateTeam('team-1', ADMIN, patch as any);
      expect(captured.update).toHaveProperty(field);
    });

    it.each(OWNER_ONLY_PATCHES)('may NOT change %s', async (_field, patch) => {
      const { service, captured } = build('admin');
      await expect(
        service.updateTeam('team-1', ADMIN, patch as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // Rejected before the write, not silently stripped from it.
      expect(captured.update).toBeUndefined();
    });

    it('names the offending fields, so the web can say what was refused', async () => {
      const { service } = build('admin');
      await expect(
        service.updateTeam('team-1', ADMIN, {
          name: 'Renamed',
          billing_email: 'rogue@example.com',
        } as any),
      ).rejects.toThrow(/billing_email/);
    });

    it('may enable time tracking without anyone holding consultant capability', async () => {
      const { service, captured } = build('admin');
      await service.updateTeam('team-1', ADMIN, {
        time_tracking_enabled: true,
      } as any);
      expect(captured.update).toMatchObject({ time_tracking_enabled: true });
    });

    it('rejects the whole patch when one field is owner-only, rather than applying the rest', async () => {
      const { service, captured } = build('admin');
      await expect(
        service.updateTeam('team-1', ADMIN, {
          name: 'Renamed',
          tax_id: 'ROGUE-1',
        } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(captured.update).toBeUndefined();
    });
  });

  describe('the owner', () => {
    it.each([...SHARED_PATCHES, ...OWNER_ONLY_PATCHES])(
      'may change %s',
      async (field, patch) => {
        const { service, captured } = build(null);
        await service.updateTeam('team-1', OWNER, patch as any);
        expect(captured.update).toHaveProperty(field);
      },
    );
  });

  describe('trading names', () => {
    it('are stored normalized and cleared with []', async () => {
      const { service, captured } = build(null);
      await service.updateTeam('team-1', OWNER, {
        trading_names: [' PRODIGITALITY ', 'Prodigitality', ''],
      } as any);
      expect(captured.update).toMatchObject({
        trading_names: ['PRODIGITALITY'],
      });
      const second = build(null);
      await second.service.updateTeam('team-1', OWNER, {
        trading_names: [],
      } as any);
      expect(second.captured.update).toMatchObject({ trading_names: [] });
    });
  });

  describe('the rates -> payouts dependency', () => {
    // A payout totals hours x rate_snapshot, so payouts-without-rates would
    // record a zero-value payment. The DB holds a CHECK; these pin the service
    // behaviour that keeps that CHECK from ever surfacing as a raw 500.
    it('clears payouts when rates are switched off, rather than letting the CHECK fire', async () => {
      const { service, captured } = build(null);
      await service.updateTeam('team-1', OWNER, {
        member_rates_enabled: false,
      } as any);
      expect(captured.update).toMatchObject({
        member_rates_enabled: false,
        payouts_enabled: false,
      });
    });

    it('refuses payouts on a team with no rates, naming the reason', async () => {
      const { service, captured } = build(null);
      await expect(
        service.updateTeam('team-1', OWNER, { payouts_enabled: true } as any),
      ).rejects.toThrow(/member rates/i);
      expect(captured.update).toBeUndefined();
    });

    it('allows payouts on when the same patch turns rates on', async () => {
      const { service, captured } = build(null);
      await service.updateTeam('team-1', OWNER, {
        member_rates_enabled: true,
        payouts_enabled: true,
      } as any);
      expect(captured.update).toMatchObject({
        member_rates_enabled: true,
        payouts_enabled: true,
      });
    });
  });

  describe('a plain member', () => {
    it('may not edit the team at all', async () => {
      const { service, captured } = build('member');
      await expect(
        service.updateTeam('team-1', MEMBER, { name: 'Renamed' } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(captured.update).toBeUndefined();
    });
  });

  describe('a non-member', () => {
    it('may not edit the team at all', async () => {
      const { service, captured } = build(null);
      await expect(
        service.updateTeam('team-1', STRANGER, { name: 'Renamed' } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(captured.update).toBeUndefined();
    });
  });

  describe('getTeam', () => {
    it("reports the caller's role so the Overview can render read-only without a second fetch", async () => {
      const { service } = build('admin');
      await expect(service.getTeam('team-1', ADMIN)).resolves.toMatchObject({
        viewer_role: 'admin',
      });
    });

    it('reports owner for the owner, who never reaches the members lookup', async () => {
      const { service } = build(null);
      await expect(service.getTeam('team-1', OWNER)).resolves.toMatchObject({
        viewer_role: 'owner',
      });
    });
  });

  /**
   * D28: the owner's retroactive_log_days reaches the team time policy; the
   * write-through itself does no authorisation, so the admin's 403 must come
   * first.
   */
  describe('retroactive days write-through', () => {
    function timePolicy() {
      return {
        planRefForTeam: jest.fn().mockResolvedValue('ws-1'),
        setTeamRetroactiveDays: jest.fn().mockResolvedValue(undefined),
      };
    }

    it('runs for the owner', async () => {
      const policy = timePolicy();
      const { service } = build(null, policy);
      await service.updateTeam('team-1', OWNER, {
        retroactive_log_days: 90,
      } as any);
      expect(policy.setTeamRetroactiveDays).toHaveBeenCalledWith(
        'team-1',
        90,
        OWNER,
      );
    });

    it('never runs for an admin', async () => {
      const policy = timePolicy();
      const { service } = build('admin', policy);
      await expect(
        service.updateTeam('team-1', ADMIN, {
          retroactive_log_days: 90,
        } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(policy.setTeamRetroactiveDays).not.toHaveBeenCalled();
    });
  });

  /**
   * assertCanManageTeam keeps its own body because callers need the role back,
   * but it must agree with team-authority.ts isTeamManager (rpc
   * can_manage_team), which the time module and payouts use. Both read the
   * same two facts: teams.owner_id, and a team_members role of owner/admin.
   */
  describe('parity with isTeamManager', () => {
    const MEMBERSHIPS: Record<string, 'owner' | 'admin' | 'member'> = {
      'user-admin': 'admin',
      'user-co-owner': 'owner',
      'user-member': 'member',
    };

    /** The M1 can_manage_team body over the same fixture rows. */
    function canManageTeam(teamId: string, userId: string): boolean {
      if (teamId !== TEAM.id) return false;
      if (TEAM.owner_id === userId) return true;
      const role = MEMBERSHIPS[userId];
      return role === 'owner' || role === 'admin';
    }

    function buildParity() {
      const supabase = {
        from: (table: string) => {
          const filters: Record<string, unknown> = {};
          const c: Record<string, unknown> = {};
          for (const method of ['select', 'order', 'limit']) {
            c[method] = () => c;
          }
          c.eq = (column: string, value: unknown) => {
            filters[column] = value;
            return c;
          };
          c.maybeSingle = () => {
            if (table === 'teams') {
              return Promise.resolve({ data: TEAM, error: null });
            }
            const role = MEMBERSHIPS[filters.user_id as string];
            return Promise.resolve({
              data: role ? { role } : null,
              error: null,
            });
          };
          return c;
        },
        rpc: (fn: string, args: { p_team_id: string; p_user_id: string }) =>
          Promise.resolve(
            fn === 'can_manage_team'
              ? {
                  data: canManageTeam(args.p_team_id, args.p_user_id),
                  error: null,
                }
              : { data: null, error: { message: `unexpected rpc ${fn}` } },
          ),
      };
      const service = new TeamsService(
        supabase as any,
        { createNotification: jest.fn() } as any,
        { send: jest.fn() } as any,
        { get: jest.fn() } as any,
        {} as any,
        allowAllEntitlements(),
      );
      return { service, supabase: supabase as unknown as SupabaseClient };
    }

    it.each([
      [OWNER, true],
      ['user-co-owner', true],
      [ADMIN, true],
      [MEMBER, false],
      [STRANGER, false],
    ])('%s: same verdict (%s)', async (userId, expected) => {
      const { service, supabase } = buildParity();
      const team = await service.fetchTeamOrThrow('team-1');

      const viaTeams = await service.assertCanManageTeam(team, userId).then(
        () => true,
        (err: unknown) => {
          expect(err).toBeInstanceOf(ForbiddenException);
          return false;
        },
      );
      const viaAuthority = await isTeamManager(supabase, 'team-1', userId);

      expect(viaTeams).toBe(expected);
      expect(viaAuthority).toBe(expected);
    });

    it('returns the role the owner-only checks need', async () => {
      const { service } = buildParity();
      const team = await service.fetchTeamOrThrow('team-1');
      await expect(service.assertCanManageTeam(team, OWNER)).resolves.toBe(
        'owner',
      );
      await expect(service.assertCanManageTeam(team, ADMIN)).resolves.toBe(
        'admin',
      );
    });
  });
});
