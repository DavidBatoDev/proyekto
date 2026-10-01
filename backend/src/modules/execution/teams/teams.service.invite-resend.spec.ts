import { TeamsService } from './teams.service';

/**
 * Resending an expired team invite issues a new invite. The invitee's bell
 * must then show only the current invite, not the expired one beside it.
 */
describe('TeamsService — resending an invite replaces its notification', () => {
  function build() {
    const order: string[] = [];
    const supabase = {
      from: (table: string) => {
        const c: Record<string, unknown> = {};
        let op = 'select';
        for (const method of ['select', 'eq', 'ilike', 'order']) {
          c[method] = () => c;
        }
        c.insert = () => {
          op = 'insert';
          return c;
        };
        c.maybeSingle = () =>
          Promise.resolve({
            data:
              table === 'profiles'
                ? { id: 'invitee-1', email: 'jo@example.test' }
                : null,
            error: null,
          });
        c.single = () =>
          Promise.resolve({
            data:
              op === 'insert'
                ? { id: 'invite-new', team_id: 'team-1', status: 'pending' }
                : null,
            error: null,
          });
        return c;
      },
    };
    const notifications = {
      clearForSubject: jest.fn(() => {
        order.push('clear');
        return Promise.resolve(1);
      }),
      createNotification: jest.fn(() => {
        order.push('create');
        return Promise.resolve({ id: 'n-new' });
      }),
    };
    const service = new TeamsService(
      supabase as never,
      notifications as never,
      {} as never,
      { get: () => undefined } as never,
      {} as never,
      {} as never,
    );
    const internals = service as unknown as Record<string, unknown>;
    internals.fetchTeamOrThrow = jest
      .fn()
      .mockResolvedValue({ id: 'team-1', name: 'JC Studio' });
    internals.assertCanManageMembers = jest.fn().mockResolvedValue(undefined);
    internals.getDisplayName = jest.fn().mockResolvedValue('Dev Consultant');
    internals.sendTeamInviteEmail = jest.fn().mockResolvedValue({ sent: true });
    return { service, notifications, order };
  }

  it('clears the earlier invite notification for the team before notifying', async () => {
    const { service, notifications, order } = build();

    await service.inviteByEmail('team-1', 'owner-1', {
      email: 'jo@example.test',
    } as never);

    expect(notifications.clearForSubject).toHaveBeenCalledWith(
      'invitee-1',
      'team_invite_received',
      'team_id',
      'team-1',
    );
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'invitee-1',
        content: expect.objectContaining({ invite_id: 'invite-new' }),
      }),
    );
    expect(order).toEqual(['clear', 'create']);
  });
});
