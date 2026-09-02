import { TeamsService } from './teams.service';

/**
 * Team invitations must reach the invitee.
 *
 * Before this, a `team_invites` row was created and the person was told
 * nothing when they had no Proyekto account: no email (there was no mailer in
 * this module at all) and no notification (it fires only for a resolved
 * profile). The invite only ever surfaced if they happened to join Proyekto
 * for some unrelated reason and the reconciler fired.
 *
 * So the case that matters most below is the one with NO account — that is the
 * gap. The suppression case pins the same asymmetry the project invite has.
 */
describe('TeamsService — invitation email', () => {
  const TEAM = { id: 'team-1', name: 'Analytical Engines Ltd' };
  const INVITE_ROW = { id: 'invite-1', team_id: 'team-1' };

  function build(opts: { hasAccount: boolean; suppressed: boolean }) {
    const mailer = { send: jest.fn().mockResolvedValue({ sent: true }) };
    const notifications = { createNotification: jest.fn() };

    /**
     * A chain-shape-agnostic query stub: every builder method returns itself,
     * only the terminals resolve. Pinning the exact call chain instead would
     * make this spec fail whenever a filter is added to a query it is not
     * about — which is exactly how the sibling projects spec broke.
     */
    const chain = (terminal: { maybeSingle?: unknown; single?: unknown }) => {
      const c: Record<string, unknown> = {};
      for (const method of [
        'select',
        'eq',
        'ilike',
        'insert',
        'update',
        'order',
        'limit',
      ]) {
        c[method] = () => c;
      }
      c.maybeSingle = () =>
        Promise.resolve(terminal.maybeSingle ?? { data: null, error: null });
      c.single = () =>
        Promise.resolve(terminal.single ?? { data: null, error: null });
      return c;
    };

    const supabase = {
      from: (table: string) => {
        switch (table) {
          case 'profiles':
            return chain({
              maybeSingle: {
                data: opts.hasAccount
                  ? { id: 'user-9', email: 'ada@example.test' }
                  : null,
              },
            });
          case 'email_suppressions':
            return chain({
              maybeSingle: {
                data: opts.suppressed ? { email: 'ada@example.test' } : null,
                error: null,
              },
            });
          case 'teams':
            return chain({
              maybeSingle: { data: TEAM },
              single: { data: TEAM },
            });
          // Invitee is not already a member, so the duplicate check passes.
          case 'team_members':
            return chain({ maybeSingle: { data: null } });
          // No existing pending invite; the insert returns the new row.
          default:
            return chain({
              maybeSingle: { data: null },
              single: { data: INVITE_ROW, error: null },
            });
        }
      },
    };

    const service = new TeamsService(
      supabase as any,
      notifications as any,
      mailer as any,
      {
        get: jest.fn((key: string) =>
          key === 'CLIENT_URL' ? 'https://www.proyekto.test' : undefined,
        ),
      } as any,
      { resolveWorkspaceForWrite: jest.fn().mockResolvedValue('ws-1') } as any,
    );

    // Authorization and team lookup are exercised by their own specs; stub the
    // two private helpers so this one is about the email.
    jest
      .spyOn(service as any, 'fetchTeamOrThrow')
      .mockResolvedValue(TEAM as never);
    jest
      .spyOn(service as any, 'assertCanManageMembers')
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(service as any, 'getDisplayName')
      .mockResolvedValue('Grace Hopper' as never);

    return { service, mailer, notifications };
  }

  it('emails an invitee who has NO account — the gap this closes', async () => {
    const { service, mailer, notifications } = build({
      hasAccount: false,
      suppressed: false,
    });

    const result = await service.inviteByEmail('team-1', 'caller-1', {
      email: 'ada@example.test',
    } as never);

    // No profile, so no notification is possible — the email is the only signal.
    expect(notifications.createNotification).not.toHaveBeenCalled();
    expect(mailer.send).toHaveBeenCalledTimes(1);

    const sent = mailer.send.mock.calls[0][0];
    expect(sent.to).toBe('ada@example.test');
    expect(sent.subject).toContain('Analytical Engines Ltd');
    // Deep-linked, and absolute — a relative link is useless in an inbox.
    expect(sent.html).toContain(
      'https://www.proyekto.test/teams/me/invites?inviteId=invite-1',
    );
    expect(result.email_delivery.sent).toBe(true);
  });

  it('emails an invitee who already has an account, alongside the bell', async () => {
    const { service, mailer, notifications } = build({
      hasAccount: true,
      suppressed: false,
    });

    await service.inviteByEmail('team-1', 'caller-1', {
      email: 'ada@example.test',
    } as never);

    expect(notifications.createNotification).toHaveBeenCalledTimes(1);
    expect(mailer.send).toHaveBeenCalledTimes(1);
  });

  it('still creates the invitation but sends no email when suppressed', async () => {
    const { service, mailer } = build({ hasAccount: false, suppressed: true });

    const result = await service.inviteByEmail('team-1', 'caller-1', {
      email: 'ada@example.test',
    } as never);

    // The asymmetry: suppression stops the email, never the invitation.
    expect(result.id).toBe('invite-1');
    expect(mailer.send).not.toHaveBeenCalled();
    expect(result.email_delivery.sent).toBe(false);
    // The admin has to be told, or they assume it arrived.
    expect(result.email_delivery.reason).toMatch(/unsubscribed/i);
  });
});
