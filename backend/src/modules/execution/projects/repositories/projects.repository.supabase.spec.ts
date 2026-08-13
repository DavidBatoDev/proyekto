import { SupabaseProjectsRepository } from './projects.repository.supabase';

describe('SupabaseProjectsRepository findDashboardByUser', () => {
  it('sorts by updated_at desc, not created_at', async () => {
    const projectsBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'p1',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-05T00:00:00Z',
          },
          {
            id: 'p2',
            created_at: '2026-01-03T00:00:00Z',
            updated_at: '2026-01-02T00:00:00Z',
          },
        ],
        error: null,
      }),
    };
    const projectAccessBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    const from = jest.fn((table: string) => {
      if (table === 'projects') return projectsBuilder;
      if (table === 'project_access') return projectAccessBuilder;
      throw new Error(`Unexpected table: ${table}`);
    });
    const repo = new SupabaseProjectsRepository({ from } as never);

    const result = await repo.findDashboardByUser('user-1');

    const enrollmentEmbed =
      'consultant_profiles!consultant_profiles_user_id_fkey(status)';
    expect(projectsBuilder.select).toHaveBeenCalledWith(
      expect.stringContaining(enrollmentEmbed),
    );
    expect(projectAccessBuilder.select).toHaveBeenCalledWith(
      expect.stringContaining(enrollmentEmbed),
    );

    // p2 has the newer created_at but the older updated_at - if the sort
    // were still keying off created_at this would come back ['p2', 'p1'].
    expect(result.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});
