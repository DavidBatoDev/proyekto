import { ForbiddenException } from '@nestjs/common';
import { TeamMemberRatesService } from './team-member-rates.service';
import { TeamsService } from './teams.service';

/**
 * Rate writes used to carry two consultant gates on top of the team-role check:
 * `assertOwnerIsConsultant` in this service, and a BEFORE INSERT trigger on
 * `team_member_rates` in the database. Both were removed when time tracking was
 * decoupled from consultant enrollment, which leaves `assertCanManageMembers`
 * as the only thing standing between a caller and a member's pay rate.
 *
 * That makes the team-role check load-bearing in a way it was not before — a
 * regression there is now a "any project member can set their own rate" bug
 * rather than a second line of defence failing. These tests pin it directly,
 * including the case the old gates made unreachable: a team whose owner holds
 * no consultant enrollment at all.
 */
describe('TeamMemberRatesService — who may set a rate', () => {
  const OWNER = 'user-owner';
  const ADMIN = 'user-admin';
  const MEMBER = 'user-member';
  const TEAM_ID = 'team-1';
  const TARGET = 'user-target';
  const PROJECT_ID = 'project-1';

  /** No consultant_profiles row anywhere — the case the old gates refused. */
  const TEAM = {
    id: TEAM_ID,
    owner_id: OWNER,
    name: 'Analytical Engines Ltd',
    tags: [],
    member_rates_enabled: true,
  };

  const DTO = {
    project_ids: [PROJECT_ID],
    hourly_rate: 50,
    training_hourly_rate: 25,
  } as any;

  /**
   * Chain-shape-agnostic stub, matching the sibling teams specs: builders
   * return themselves and only terminals resolve, so an added filter on an
   * unrelated query cannot break these tests.
   *
   * `viewerRole` is what `team_members` reports for the caller. It doubles as
   * the membership-existence answer for the rate's target, which is harmless
   * here: every case that reaches that lookup is one where the caller passed
   * the role check.
   */
  function build(
    viewerRole: 'admin' | 'member' | null,
    compensationEnabled = true,
  ) {
    const captured: { insert?: Record<string, unknown> } = {};
    const team = { ...TEAM, member_rates_enabled: compensationEnabled };

    const chain = (table: string) => {
      const c: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'is', 'neq', 'order']) {
        c[method] = () => c;
      }
      c.update = () => c;
      c.insert = (payload: Record<string, unknown>) => {
        captured.insert = payload;
        return c;
      };
      c.single = () =>
        Promise.resolve(
          table === 'teams'
            ? { data: team, error: null }
            : { data: { id: 'rate-1', ...captured.insert }, error: null },
        );
      c.maybeSingle = () =>
        Promise.resolve({
          data:
            table === 'teams' ? team : viewerRole ? { role: viewerRole } : null,
          error: null,
        });
      // team_members is read head-only for a count; project_teams resolves to
      // the attached project so assertProjectsBelongToTeam passes.
      c.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(
          table === 'team_members'
            ? { count: 1, error: null }
            : table === 'project_teams'
              ? { data: [{ project_id: PROJECT_ID }], error: null }
              : { data: [], error: null },
        ).then(resolve);
      return c;
    };

    const supabase = { from: (table: string) => chain(table) };

    const teams = new TeamsService(
      supabase as any,
      { createNotification: jest.fn() } as any,
      { send: jest.fn() } as any,
      { get: jest.fn() } as any,
      { resolveWorkspaceForWrite: jest.fn().mockResolvedValue('ws-1') } as any,
    );
    const service = new TeamMemberRatesService(supabase as any, teams);

    return { service, captured };
  }

  it('lets the owner set a rate even with no consultant enrollment behind the team', async () => {
    const { service, captured } = build(null);
    await service.create(TEAM_ID, TARGET, OWNER, DTO);
    expect(captured.insert).toMatchObject({
      team_id: TEAM_ID,
      user_id: TARGET,
      hourly_rate: 50,
    });
  });

  it('lets a team admin set a rate — the point of the decoupling', async () => {
    const { service, captured } = build('admin');
    await service.create(TEAM_ID, TARGET, ADMIN, DTO);
    expect(captured.insert).toMatchObject({ hourly_rate: 50 });
  });

  it('still refuses a plain team member', async () => {
    const { service, captured } = build('member');
    await expect(
      service.create(TEAM_ID, TARGET, MEMBER, DTO),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(captured.insert).toBeUndefined();
  });

  it('refuses even the owner while the money layer is off', async () => {
    // member_rates_enabled gates rates, cut-offs and payouts together: with it
    // off there is no rate card to edit, so this must fail on permission
    // grounds rather than silently writing a rate nothing will ever read.
    const { service, captured } = build(null, false);
    await expect(
      service.create(TEAM_ID, TARGET, OWNER, DTO),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(captured.insert).toBeUndefined();
  });

  it('still refuses a non-member', async () => {
    const { service, captured } = build(null);
    await expect(
      service.create(TEAM_ID, TARGET, 'user-stranger', DTO),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(captured.insert).toBeUndefined();
  });
});
