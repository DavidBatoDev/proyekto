import { NotificationsService } from './notifications.service';

describe('NotificationsService.clearForSubject', () => {
  function build(deleteError: { message: string } | null = null) {
    const deletes: unknown[][] = [];
    const supabase = {
      from: (table: string) => {
        const filters: unknown[][] = [];
        let deleting = false;
        const c: Record<string, unknown> = {};
        c.select = () => c;
        c.delete = () => {
          deleting = true;
          return c;
        };
        c.eq = (...args: unknown[]) => {
          filters.push(args);
          return c;
        };
        c.maybeSingle = () =>
          Promise.resolve({
            data: table === 'notification_types' ? { id: 'type-1' } : null,
            error: null,
          });
        c.then = (resolve: (value: unknown) => unknown) => {
          if (deleting) deletes.push(filters);
          return Promise.resolve({
            data: deleteError ? null : [{ id: 'n1' }, { id: 'n2' }],
            error: deleteError,
          }).then(resolve);
        };
        return c;
      },
    };
    const service = new NotificationsService(
      supabase as never,
      {} as never,
      { get: () => undefined } as never,
    );
    return { service, deletes };
  }

  it('deletes only that user’s notifications of that type about that subject', async () => {
    const { service, deletes } = build();
    await expect(
      service.clearForSubject(
        'user-1',
        'team_invite_received',
        'team_id',
        't1',
      ),
    ).resolves.toBe(2);
    expect(deletes).toEqual([
      [
        ['user_id', 'user-1'],
        ['type_id', 'type-1'],
        ['content->>team_id', 't1'],
      ],
    ]);
  });

  it('never throws when the delete fails', async () => {
    const { service } = build({ message: 'boom' });
    await expect(
      service.clearForSubject(
        'user-1',
        'team_invite_received',
        'team_id',
        't1',
      ),
    ).resolves.toBe(0);
  });
});
