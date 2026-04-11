import { RoadmapsRepositorySupabase } from './roadmaps.repository.supabase';

describe('RoadmapsRepositorySupabase searchContextCandidates', () => {
  it('short-circuits wildcard-only query without touching db', async () => {
    const from = jest.fn();
    const repo = new RoadmapsRepositorySupabase({ from } as never);

    const result = await repo.searchContextCandidates(
      '55e431e2-e416-468c-a973-94d97280e97d',
      '%%%___%%',
      { nodeType: 'epic', scanLimit: 20 },
    );

    expect(result).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it('sanitizes wildcard chars before building ilike passes', async () => {
    const ilikeCalls: Array<{ column: string; pattern: string }> = [];

    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      ilike: jest.fn((column: string, pattern: string) => {
        ilikeCalls.push({ column, pattern });
        return queryBuilder;
      }),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
    };

    const from = jest.fn().mockReturnValue(queryBuilder);
    const repo = new RoadmapsRepositorySupabase({ from } as never);

    await repo.searchContextCandidates(
      '55e431e2-e416-468c-a973-94d97280e97d',
      'Roadmap%__Module',
      { nodeType: 'epic', scanLimit: 20 },
    );

    expect(ilikeCalls.length).toBeGreaterThan(0);
    for (const call of ilikeCalls) {
      expect(call.pattern).not.toContain('%__');
      expect(call.pattern).not.toContain('__');
    }
    expect(ilikeCalls.map((entry) => entry.pattern)).toEqual(
      expect.arrayContaining([
        'roadmap module',
        'roadmap module%',
        '%roadmap module%',
      ]),
    );
  });
});
