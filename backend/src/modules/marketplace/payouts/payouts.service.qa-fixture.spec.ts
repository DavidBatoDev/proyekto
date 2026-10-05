import type { SupabaseClient } from '@supabase/supabase-js';
import { allowAllEntitlements } from '../../shared/entitlements/__entitlements-test-kit-spec';
import { PayoutsService } from './payouts.service';

describe('PayoutsService QA fixture safety', () => {
  it('blocks payout creation before reading or paying logs', async () => {
    const teamQuery: Record<string, jest.Mock> = {};
    teamQuery.select = jest.fn(() => teamQuery);
    teamQuery.eq = jest.fn(() => teamQuery);
    teamQuery.maybeSingle = jest.fn().mockResolvedValue({
      data: {
        id: 'team-1',
        owner_id: 'consultant-1',
        workspace_id: 'ws-1',
        time_tracking_enabled: true,
        payouts_enabled: true,
      },
      error: null,
    });
    const from = jest.fn(() => teamQuery);
    // can_manage_team: the owner manages the team.
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null });
    const supabase = { from, rpc } as unknown as SupabaseClient;
    const qaFixtures = {
      assertTeamSideEffectAllowed: jest
        .fn()
        .mockRejectedValue(new Error('fixture blocked')),
    };
    const timePolicy = {
      planRefForTeam: jest.fn().mockResolvedValue('ws-1'),
    };
    const timeNotifications = { payoutRecorded: jest.fn() };
    const service = new PayoutsService(
      supabase,
      {} as never,
      qaFixtures as never,
      allowAllEntitlements(),
      timePolicy as never,
      timeNotifications as never,
    );

    await expect(
      service.createPayout('consultant-1', {
        team_id: 'team-1',
        member_user_id: 'worker-1',
        log_ids: ['00000000-0000-4000-a000-000000000001'],
      }),
    ).rejects.toThrow('fixture blocked');
    expect(qaFixtures.assertTeamSideEffectAllowed).toHaveBeenCalledWith(
      'team-1',
      'Payout creation',
    );
    // Only the team row was read; no entry was read and no RPC but the
    // manager check ran.
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('teams');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('can_manage_team', {
      p_team_id: 'team-1',
      p_user_id: 'consultant-1',
    });
    expect(timeNotifications.payoutRecorded).not.toHaveBeenCalled();
  });
});
