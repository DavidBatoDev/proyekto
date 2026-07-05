import { ProjectsService } from './projects.service';
import type { ProjectsRepository } from './repositories/projects.repository.interface';
import type { Project } from '../../common/entities';

function buildProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    title: 'Project One',
    status: 'draft',
    client_id: 'client-1',
    consultant_id: 'consultant-1',
    platform_fee_percent: 10,
    consultant_fee_percent: 15,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const COUNT_TABLES = [
  'roadmap_epics',
  'roadmap_milestones',
  'roadmap_features',
];

describe('ProjectsService listRoadmapLinkCandidates', () => {
  const buildSupabase = ({
    roadmapRows = [] as Array<{ id: string; project_id: string }>,
    childCounts = {} as Record<string, number>,
  } = {}) => {
    const from = jest.fn((table: string) => {
      if (table === 'roadmaps') {
        return {
          select: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({ data: roadmapRows, error: null }),
        };
      }
      if (COUNT_TABLES.includes(table)) {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn((_column: string, roadmapId: string) =>
              Promise.resolve({
                count: childCounts[roadmapId] ?? 0,
                error: null,
              }),
            ),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });
    return { from };
  };

  const buildService = (
    repoOverrides: Partial<ProjectsRepository>,
    supabase: { from: jest.Mock },
  ) => {
    const repo = repoOverrides as ProjectsRepository;
    return new ProjectsService(
      repo,
      { createNotification: jest.fn() } as any,
      {
        getUserProjectRole: jest.fn().mockResolvedValue(null),
        assertRole: jest.fn(),
      } as any,
      { attach: jest.fn(), detach: jest.fn(), list: jest.fn() } as any,
      { syncUser: jest.fn().mockResolvedValue(null) } as any,
      supabase as any,
      { rememberJson: jest.fn() } as any,
      { invalidateAllDashboardCache: jest.fn() } as any,
      { get: jest.fn() } as any,
      {
        provisionDefaultChannels: jest.fn().mockResolvedValue(undefined),
      } as any,
    );
  };

  it('returns only owned projects whose linked roadmap is empty', async () => {
    const ownedEmpty = buildProject({
      id: 'project-empty',
      title: 'Empty Roadmap Project',
      client_id: 'user-1',
    });
    const ownedNonEmpty = buildProject({
      id: 'project-full',
      title: 'Busy Project',
      client_id: 'user-1',
    });
    const ownedNoRoadmap = buildProject({
      id: 'project-bare',
      title: 'No Roadmap Project',
      client_id: 'user-1',
    });
    const memberOnly = buildProject({
      id: 'project-member',
      title: 'Someone Else Owns This',
      client_id: 'other-user',
    });

    const supabase = buildSupabase({
      roadmapRows: [
        { id: 'roadmap-empty', project_id: 'project-empty' },
        { id: 'roadmap-full', project_id: 'project-full' },
        { id: 'roadmap-member', project_id: 'project-member' },
      ],
      childCounts: { 'roadmap-full': 3 },
    });
    const service = buildService(
      {
        findByUser: jest
          .fn()
          .mockResolvedValue([
            ownedEmpty,
            ownedNonEmpty,
            ownedNoRoadmap,
            memberOnly,
          ]),
      },
      supabase,
    );

    await expect(service.listRoadmapLinkCandidates('user-1')).resolves.toEqual([
      {
        id: 'project-empty',
        title: 'Empty Roadmap Project',
        roadmap_id: 'roadmap-empty',
      },
    ]);
  });

  it('returns an empty list without querying roadmaps when the user owns no projects', async () => {
    const memberOnly = buildProject({
      id: 'project-member',
      client_id: 'other-user',
    });
    const supabase = buildSupabase();
    const service = buildService(
      { findByUser: jest.fn().mockResolvedValue([memberOnly]) },
      supabase,
    );

    await expect(service.listRoadmapLinkCandidates('user-1')).resolves.toEqual(
      [],
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
