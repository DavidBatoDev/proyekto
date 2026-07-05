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

describe('RoadmapsRepositorySupabase migrateGuestRoadmaps', () => {
  const buildDb = ({
    guestProfileId = 'guest-profile-1',
    migratedRows = [] as Array<{ id: string }>,
  }: {
    guestProfileId?: string | null;
    migratedRows?: Array<{ id: string }>;
  } = {}) => {
    const profilesBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: guestProfileId ? { id: guestProfileId } : null,
        error: null,
      }),
    };
    const roadmapsBuilder = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue({ data: migratedRows, error: null }),
    };
    const sessionsBuilder = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockResolvedValue({ error: null }),
    };
    const from = jest.fn((table: string) => {
      if (table === 'profiles') return profilesBuilder;
      if (table === 'roadmaps') return roadmapsBuilder;
      if (table === 'roadmap_ai_sessions') return sessionsBuilder;
      throw new Error(`Unexpected table: ${table}`);
    });
    return { from, profilesBuilder, roadmapsBuilder, sessionsBuilder };
  };

  it('reassigns roadmaps AND their ai sessions to the user', async () => {
    const db = buildDb({
      migratedRows: [{ id: 'roadmap-1' }, { id: 'roadmap-2' }],
    });
    const repo = new RoadmapsRepositorySupabase({ from: db.from } as never);

    const result = await repo.migrateGuestRoadmaps('session-1', 'user-1');

    expect(result).toEqual({ migrated: 2 });
    expect(db.roadmapsBuilder.update).toHaveBeenCalledWith({
      owner_id: 'user-1',
    });
    expect(db.roadmapsBuilder.eq).toHaveBeenCalledWith(
      'owner_id',
      'guest-profile-1',
    );
    expect(db.sessionsBuilder.update).toHaveBeenCalledWith({
      user_id: 'user-1',
    });
    expect(db.sessionsBuilder.eq).toHaveBeenCalledWith(
      'user_id',
      'guest-profile-1',
    );
    expect(db.sessionsBuilder.in).toHaveBeenCalledWith('roadmap_id', [
      'roadmap-1',
      'roadmap-2',
    ]);
  });

  it('skips session reassignment when no roadmaps migrated', async () => {
    const db = buildDb({ migratedRows: [] });
    const repo = new RoadmapsRepositorySupabase({ from: db.from } as never);

    const result = await repo.migrateGuestRoadmaps('session-1', 'user-1');

    expect(result).toEqual({ migrated: 0 });
    expect(db.sessionsBuilder.update).not.toHaveBeenCalled();
  });

  it('returns 0 without touching roadmaps when the guest profile is missing', async () => {
    const db = buildDb({ guestProfileId: null });
    const repo = new RoadmapsRepositorySupabase({ from: db.from } as never);

    const result = await repo.migrateGuestRoadmaps('session-1', 'user-1');

    expect(result).toEqual({ migrated: 0 });
    expect(db.roadmapsBuilder.update).not.toHaveBeenCalled();
    expect(db.sessionsBuilder.update).not.toHaveBeenCalled();
  });
});
