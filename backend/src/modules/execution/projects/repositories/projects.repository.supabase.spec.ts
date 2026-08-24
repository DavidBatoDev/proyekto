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
    const roadmapsBuilder = {
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    const from = jest.fn((table: string) => {
      if (table === 'projects') return projectsBuilder;
      if (table === 'project_access') return projectAccessBuilder;
      if (table === 'roadmaps') return roadmapsBuilder;
      throw new Error(`Unexpected table: ${table}`);
    });
    const repo = new SupabaseProjectsRepository({ from } as never);

    const result = await repo.findDashboardByUser('user-1');

    // The member embed used to reach into consultant_profiles to stamp
    // `is_consultant_verified` on every project member. Nothing read it — the
    // one consumer was the "reassign consultant" picker — and a member's
    // marketplace enrollment is not something a project payload should carry.
    // Assert the join stays gone: it rode on every dashboard load.
    const enrollmentEmbed = 'consultant_profiles';
    expect(projectsBuilder.select).not.toHaveBeenCalledWith(
      expect.stringContaining(enrollmentEmbed),
    );
    expect(projectAccessBuilder.select).not.toHaveBeenCalledWith(
      expect.stringContaining(enrollmentEmbed),
    );

    // p2 has the newer created_at but the older updated_at - if the sort
    // were still keying off created_at this would come back ['p2', 'p1'].
    expect(result.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('attaches a roadmap summary with cascade progress per project', async () => {
    const projectsBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({
        data: [
          { id: 'p1', updated_at: '2026-01-05T00:00:00Z' },
          { id: 'p2', updated_at: '2026-01-04T00:00:00Z' },
        ],
        error: null,
      }),
    };
    const projectAccessBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    const roadmapsBuilder = {
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'r1',
            name: 'Launch plan',
            project_id: 'p1',
            updated_at: '2026-01-05T00:00:00Z',
            epics: [
              {
                id: 'e1',
                features: [
                  // avg(100, 0) = 50
                  { id: 'f1', tasks: [{ status: 'done' }, { status: 'todo' }] },
                  // no tasks -> 0, so the epic averages to 25
                  { id: 'f2', tasks: [] },
                ],
              },
              // no features -> 0, so roadmap progress = avg(25, 0) = 13
              { id: 'e2', features: [] },
            ],
          },
        ],
        error: null,
      }),
    };
    const from = jest.fn((table: string) => {
      if (table === 'projects') return projectsBuilder;
      if (table === 'project_access') return projectAccessBuilder;
      if (table === 'roadmaps') return roadmapsBuilder;
      throw new Error(`Unexpected table: ${table}`);
    });
    const repo = new SupabaseProjectsRepository({ from } as never);

    const result = await repo.findDashboardByUser('user-1');

    expect(roadmapsBuilder.in).toHaveBeenCalledWith('project_id', ['p1', 'p2']);
    expect(result.find((p) => p.id === 'p1')?.roadmap_summary).toEqual({
      roadmap_id: 'r1',
      name: 'Launch plan',
      epic_count: 2,
      feature_count: 2,
      task_count: 2,
      done_task_count: 1,
      progress: 13,
    });
    // A project with no linked roadmap carries an explicit null so the web
    // client can distinguish "no roadmap" from "field not loaded".
    expect(result.find((p) => p.id === 'p2')?.roadmap_summary).toBeNull();
  });
});

describe('SupabaseProjectsRepository create', () => {
  it('stores the submitted description as version one of the project brief', async () => {
    const single = jest.fn().mockResolvedValue({
      data: { id: 'project-1', title: 'Apollo' },
      error: null,
    });
    const projectInsert = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ single }),
    });
    const briefInsert = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn((table: string) => {
      if (table === 'projects') return { insert: projectInsert };
      if (table === 'project_briefs') return { insert: briefInsert };
      throw new Error(`Unexpected table: ${table}`);
    });
    const repo = new SupabaseProjectsRepository({ from } as never);

    await repo.create('user-1', {
      title: 'Apollo',
      description: '  Build the launch experience.  ',
    });

    expect(projectInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_id: 'user-1',
        title: 'Apollo',
      }),
    );
    expect(briefInsert).toHaveBeenCalledWith({
      project_id: 'project-1',
      project_summary: 'Build the launch experience.',
      custom_fields: [],
      updated_by: 'user-1',
      version: 1,
    });
  });
});
