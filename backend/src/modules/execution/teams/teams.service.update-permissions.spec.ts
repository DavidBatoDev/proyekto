import { ForbiddenException } from '@nestjs/common';
import { TeamsService } from './teams.service';

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
  function build(viewerRole: 'admin' | 'member' | null) {
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
      { resolveWorkspaceForWrite: jest.fn().mockResolvedValue('ws-1') } as any,
    );

    return { service, captured };
  }

  /** Money and legal identity. An admin must be refused every one of these. */
  const OWNER_ONLY_PATCHES: Array<[string, Record<string, unknown>]> = [
    ['legal_name', { legal_name: 'Rogue Holdings' }],
    ['billing_address', { billing_address: '1 Rogue Way' }],
    ['tax_id', { tax_id: 'ROGUE-1' }],
    ['billing_email', { billing_email: 'rogue@example.com' }],
    // false, not true: enabling additionally runs assertOwnerIsConsultant, and
    // this list is reused for the owner case below, where that gate would fire
    // and turn a permission test into a capability test. The admin is refused
    // either way — proven separately below.
    ['time_tracking_enabled', { time_tracking_enabled: false }],
    ['retroactive_log_days', { retroactive_log_days: 90 }],
    ['default_currency', { default_currency: 'PHP' }],
    ['pay_period_config', { pay_period_config: null }],
  ];

  /** The team's identity — the Overview tab's surface. */
  const SHARED_PATCHES: Array<[string, Record<string, unknown>]> = [
    ['name', { name: 'Renamed' }],
    ['description', { description: '<p>Our team</p>' }],
    ['avatar_url', { avatar_url: 'https://cdn.example.com/a.png' }],
    ['status', { status: 'paused' }],
    ['tags', { tags: ['design'] }],
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

    it('is refused when enabling time tracking, before the consultant gate is consulted', async () => {
      const { service } = build('admin');
      const consultantGate = jest.spyOn(
        service as any,
        'assertOwnerIsConsultant',
      );
      await expect(
        service.updateTeam('team-1', ADMIN, {
          time_tracking_enabled: true,
        } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // The ownership check fires first, so an admin never even reaches the
      // owner's consultant capability.
      expect(consultantGate).not.toHaveBeenCalled();
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
});
