import type { SupabaseClient } from '@supabase/supabase-js';
import { PayoutsService } from './payouts.service';

describe('PayoutsService QA fixture safety', () => {
  it('blocks payout creation before reading or paying logs', async () => {
    const teamQuery: Record<string, jest.Mock> = {};
    teamQuery.select = jest.fn(() => teamQuery);
    teamQuery.eq = jest.fn(() => teamQuery);
    teamQuery.maybeSingle = jest.fn().mockResolvedValue({
      data: { owner_id: 'consultant-1', time_tracking_enabled: true },
      error: null,
    });
    const from = jest.fn(() => teamQuery);
    const supabase = { from } as unknown as SupabaseClient;
    const qaFixtures = {
      assertTeamSideEffectAllowed: jest
        .fn()
        .mockRejectedValue(new Error('fixture blocked')),
    };
    const service = new PayoutsService(
      supabase,
      {} as never,
      {} as never,
      qaFixtures as never,
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
    expect(from).toHaveBeenCalledTimes(1);
  });
});
