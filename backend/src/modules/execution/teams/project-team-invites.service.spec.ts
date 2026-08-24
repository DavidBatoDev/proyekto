import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ProjectTeamInvitesService } from './project-team-invites.service';

/**
 * The two halves of the handshake, and what each of them is allowed to decide.
 *
 * "Invite a team" exists because a project admin cannot see, let alone attach,
 * a team they are not on. That makes the authority split the whole feature:
 * the INVITER decides what happens on their project (the role incoming members
 * get, whether the team becomes primary), and the INVITEE decides what happens
 * to their team (which team, and who from it). Every test here is about one
 * side failing to reach across that line.
 */
describe('ProjectTeamInvitesService', () => {
  const INVITE = {
    id: 'invite-1',
    project_id: 'project-1',
    invited_by: 'august',
    invitee_id: 'marc',
    invitee_email: 'marc@example.test',
    team_id: null,
    team_name_hint: 'Dungog Digital',
    member_role: 'editor',
    make_primary: true,
    status: 'pending',
    message: null,
  };

  /**
   * Chain-shape-agnostic query stub: every builder method returns itself, only
   * the terminals resolve. Pinning the exact call chain instead makes the spec
   * fail whenever a filter is added to a query it is not about.
   */
  function chain(terminal: {
    maybeSingle?: unknown;
    single?: unknown;
    rows?: unknown;
  }) {
    const c: Record<string, unknown> = {};
    for (const method of ['select', 'insert', 'update', 'ilike', 'order']) {
      c[method] = () => c;
    }
    // `eq` is the terminal for the roster read (no .single()), so it has to
    // both chain and resolve.
    c.eq = () =>
      Object.assign(Promise.resolve(terminal.rows ?? { data: [] }), c);
    c.maybeSingle = () =>
      Promise.resolve(terminal.maybeSingle ?? { data: null, error: null });
    c.single = () =>
      Promise.resolve(terminal.single ?? { data: null, error: null });
    return c;
  }

  function build(opts: {
    invite?: Record<string, unknown>;
    roster?: string[];
    canManageTeam?: boolean;
  }) {
    const invite = opts.invite ?? INVITE;
    const roster = opts.roster ?? ['marc', 'jc', 'stranger-not-asked'];

    const supabase = {
      from: (table: string) => {
        switch (table) {
          case 'project_team_invites':
            return chain({
              maybeSingle: { data: invite, error: null },
              single: {
                data: { ...invite, status: 'accepted', team_id: 'team-1' },
                error: null,
              },
            });
          case 'team_members':
            return chain({
              rows: {
                data: roster.map((user_id) => ({ user_id })),
                error: null,
              },
            });
          default:
            return chain({});
        }
      },
    };

    const projectTeams = { attachFromInvite: jest.fn().mockResolvedValue({}) };
    const teams = {
      fetchTeamOrThrow: jest.fn().mockResolvedValue({ id: 'team-1' }),
      assertCanManageMembers: jest.fn(
        opts.canManageTeam === false
          ? () => {
              throw new ForbiddenException(
                'Only the team owner or team admins can manage members',
              );
            }
          : () => Promise.resolve(undefined),
      ),
    };
    const notifications = { createNotification: jest.fn() };

    const service = new ProjectTeamInvitesService(
      supabase as never,
      notifications as never,
      { send: jest.fn() } as never,
      { get: jest.fn() } as never,
      { assertPermission: jest.fn() } as never,
      projectTeams as never,
      teams as never,
    );

    return { service, projectTeams, teams, notifications };
  }

  it('attaches the team the ACCEPTER named, at the role the INVITER set', async () => {
    const { service, projectTeams } = build({});

    await service.respond('invite-1', 'marc', {
      status: 'accepted',
      team_id: 'team-1',
      member_user_ids: ['jc'],
    } as never);

    expect(projectTeams.attachFromInvite).toHaveBeenCalledTimes(1);
    const args = projectTeams.attachFromInvite.mock.calls[0][0];
    expect(args.teamId).toBe('team-1');
    // From the invitation, never from the accept request — a team owner does
    // not get to choose their own access level on someone else's project.
    expect(args.memberRole).toBe('editor');
    expect(args.isPrimary).toBe(true);
    // The inviter authorized the attachment; the accepter chose the people.
    expect(args.attachedBy).toBe('august');
    expect(args.curatedBy).toBe('marc');
  });

  it('refuses an accept from someone who does not run the team', async () => {
    const { service, projectTeams } = build({ canManageTeam: false });

    await expect(
      service.respond('invite-1', 'marc', {
        status: 'accepted',
        team_id: 'team-1',
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // The important half: nothing was attached on the way to the rejection.
    expect(projectTeams.attachFromInvite).not.toHaveBeenCalled();
  });

  it('refuses a response from anyone but the invitee', async () => {
    const { service, projectTeams } = build({});

    await expect(
      service.respond('invite-1', 'someone-else', {
        status: 'accepted',
        team_id: 'team-1',
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(projectTeams.attachFromInvite).not.toHaveBeenCalled();
  });

  it('refuses to respond twice', async () => {
    const { service } = build({
      invite: { ...INVITE, status: 'accepted', team_id: 'team-1' },
    });

    await expect(
      service.respond('invite-1', 'marc', {
        status: 'declined',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a team when accepting', async () => {
    const { service } = build({});

    await expect(
      service.respond('invite-1', 'marc', { status: 'accepted' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('drops requested members who are not actually on the team', async () => {
    // A hand-rolled request must not be able to curate a stranger onto the
    // project — the roster is the authority, not the payload.
    const { service, projectTeams } = build({ roster: ['marc', 'jc'] });

    await service.respond('invite-1', 'marc', {
      status: 'accepted',
      team_id: 'team-1',
      member_user_ids: ['jc', 'outsider'],
    } as never);

    const args = projectTeams.attachFromInvite.mock.calls[0][0];
    expect(args.memberUserIds).toContain('jc');
    expect(args.memberUserIds).not.toContain('outsider');
  });

  it('always brings the accepter along, even if they picked nobody', async () => {
    // A team attached to a project with nobody on it is not a state worth
    // creating, and the accepter is the one person we know consented.
    const { service, projectTeams } = build({});

    await service.respond('invite-1', 'marc', {
      status: 'accepted',
      team_id: 'team-1',
      member_user_ids: [],
    } as never);

    const args = projectTeams.attachFromInvite.mock.calls[0][0];
    expect(args.memberUserIds).toEqual(['marc']);
  });

  it('attaches nothing when the invitation is declined', async () => {
    const { service, projectTeams, notifications } = build({});

    await service.respond('invite-1', 'marc', {
      status: 'declined',
    } as never);

    expect(projectTeams.attachFromInvite).not.toHaveBeenCalled();
    // The inviter is told either way — a silent decline leaves them waiting.
    expect(notifications.createNotification).toHaveBeenCalledTimes(1);
    expect(notifications.createNotification.mock.calls[0][0].user_id).toBe(
      'august',
    );
  });
});
