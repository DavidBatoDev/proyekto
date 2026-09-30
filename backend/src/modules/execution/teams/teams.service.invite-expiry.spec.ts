import { BadRequestException } from '@nestjs/common';
import { TeamsService } from './teams.service';

/**
 * Team invites lapse 14 days after they are sent, like finance invites. A
 * lapsed pending invite is persisted as `expired` when listed and can no
 * longer be accepted; resending issues a fresh expiry.
 */
describe('TeamsService — invite expiry', () => {
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const future = new Date(Date.now() + 86_400_000).toISOString();

  function build(rows: Array<Record<string, unknown>>) {
    const updates: Array<{ patch: unknown; ids?: unknown }> = [];
    const supabase = {
      from: () => {
        const c: Record<string, unknown> = {};
        let pendingPatch: unknown = null;
        for (const method of ['select', 'eq', 'order']) c[method] = () => c;
        c.update = (patch: unknown) => {
          pendingPatch = patch;
          return c;
        };
        c.in = (_col: string, ids: unknown) => {
          updates.push({ patch: pendingPatch, ids });
          return c;
        };
        c.maybeSingle = () => Promise.resolve({ data: rows[0], error: null });
        c.then = (resolve: (value: unknown) => unknown) =>
          Promise.resolve({
            data: pendingPatch ? null : rows,
            error: null,
          }).then(resolve);
        return c;
      },
    };
    const service = new TeamsService(
      supabase as never,
      {} as never,
      {} as never,
      { get: () => undefined } as never,
      {} as never,
      {} as never,
    );
    return { service, updates };
  }

  it('marks lapsed pending invites expired when listed', async () => {
    const { service, updates } = build([
      { id: 'old', status: 'pending', expires_at: past },
      { id: 'fresh', status: 'pending', expires_at: future },
      { id: 'done', status: 'accepted', expires_at: past },
    ]);

    const invites = await service.listInvitesForMe('user-1');

    expect(invites.map((invite) => [invite.id, invite.status])).toEqual([
      ['old', 'expired'],
      ['fresh', 'pending'],
      ['done', 'accepted'],
    ]);
    expect(updates).toEqual([
      {
        patch: expect.objectContaining({ status: 'expired' }),
        ids: ['old'],
      },
    ]);
  });

  it('writes nothing when no invite has lapsed', async () => {
    const { service, updates } = build([
      { id: 'fresh', status: 'pending', expires_at: future },
    ]);
    await service.listInvitesForMe('user-1');
    expect(updates).toEqual([]);
  });

  it('refuses to accept a lapsed invite', async () => {
    const { service, updates } = build([
      {
        id: 'old',
        team_id: 'team-1',
        invitee_id: 'user-1',
        status: 'pending',
        expires_at: past,
      },
    ]);

    await expect(
      service.respondInvite('old', 'user-1', { status: 'accepted' } as never),
    ).rejects.toThrow(BadRequestException);
    expect(updates[0]?.ids).toEqual(['old']);
  });
});
