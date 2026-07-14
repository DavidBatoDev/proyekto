import { RoadmapsService } from './roadmaps.service';
describe('RoadmapsService', () => {
  const roadmapAuthz = {
    assertProjectRoadmapPermission: jest.fn(),
  };
  const supabase = {
    from: jest.fn(),
  };
  const repo = {
    create: jest.fn(),
  };

  const service = new RoadmapsService(
    repo as any,
    supabase as any,
    roadmapAuthz as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a standalone roadmap without template-marketplace side effects', async () => {
    repo.create.mockResolvedValueOnce({ id: 'roadmap-1' });

    await expect(
      service.create({ name: 'New roadmap' } as any, 'user-1'),
    ).resolves.toEqual({ id: 'roadmap-1' });

    expect(repo.create).toHaveBeenCalledWith({ name: 'New roadmap' }, 'user-1');
    expect(roadmapAuthz.assertProjectRoadmapPermission).not.toHaveBeenCalled();
  });

  it('checks project roadmap permissions before creating a linked roadmap', async () => {
    repo.create.mockResolvedValueOnce({ id: 'roadmap-2' });

    await service.create(
      { name: 'Linked', project_id: 'project-1' } as any,
      'user-1',
    );

    expect(roadmapAuthz.assertProjectRoadmapPermission).toHaveBeenCalledWith(
      'project-1',
      'user-1',
      'roadmap.edit',
    );
  });
});
