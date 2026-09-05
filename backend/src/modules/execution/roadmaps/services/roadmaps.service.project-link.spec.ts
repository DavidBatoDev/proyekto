import { BadRequestException, ConflictException } from '@nestjs/common';
import { RoadmapsService } from './roadmaps.service';

/**
 * The one-to-one project/roadmap rule at the service boundary: a project
 * holds at most one linked roadmap, and attaching a standalone roadmap to a
 * project is a permission-checked link rather than a plain field edit.
 */
describe('RoadmapsService project link rules', () => {
  const roadmapAuthz = {
    assertProjectRoadmapPermission: jest.fn(),
    assertRoadmapPermission: jest.fn(),
  };
  const maybeSingle = jest.fn();
  const supabase = {
    from: jest.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
    })),
  };
  const repo = {
    create: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
  };

  const service = new RoadmapsService(
    repo as any,
    supabase as any,
    roadmapAuthz as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    maybeSingle.mockResolvedValue({ data: null, error: null });
  });

  it('refuses to create a second roadmap for a project with a 409', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: { id: 'rm-existing', name: 'Launch plan' },
      error: null,
    });

    await expect(
      service.create({ name: 'Second', project_id: 'project-1' } as any, 'u-1'),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      response: expect.objectContaining({
        code: 'PROJECT_ALREADY_HAS_ROADMAP',
        roadmap_id: 'rm-existing',
      }),
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('creates a linked roadmap when the project has none', async () => {
    repo.create.mockResolvedValueOnce({ id: 'rm-new' });

    await expect(
      service.create({ name: 'First', project_id: 'project-1' } as any, 'u-1'),
    ).resolves.toEqual({ id: 'rm-new' });

    expect(roadmapAuthz.assertProjectRoadmapPermission).toHaveBeenCalledWith(
      'project-1',
      'u-1',
      'roadmap.edit',
    );
    expect(supabase.from).toHaveBeenCalledWith('roadmaps');
  });

  it('attaches a standalone roadmap only after checking the project and its vacancy', async () => {
    repo.findById.mockResolvedValueOnce({
      id: 'rm-solo',
      owner_id: 'u-1',
      project_id: null,
    });
    repo.update.mockResolvedValueOnce({
      id: 'rm-solo',
      project_id: 'project-1',
    });

    await expect(
      service.update('rm-solo', { project_id: 'project-1' }, 'u-1'),
    ).resolves.toEqual({ id: 'rm-solo', project_id: 'project-1' });

    expect(roadmapAuthz.assertProjectRoadmapPermission).toHaveBeenCalledWith(
      'project-1',
      'u-1',
      'roadmap.edit',
    );
    expect(repo.update).toHaveBeenCalledWith('rm-solo', {
      project_id: 'project-1',
    });
  });

  it('refuses to attach when the project already has a roadmap', async () => {
    repo.findById.mockResolvedValueOnce({
      id: 'rm-solo',
      owner_id: 'u-1',
      project_id: null,
    });
    maybeSingle.mockResolvedValueOnce({
      data: { id: 'rm-existing', name: 'Launch plan' },
      error: null,
    });

    await expect(
      service.update('rm-solo', { project_id: 'project-1' }, 'u-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('refuses to move a roadmap that is already linked to a project', async () => {
    repo.findById.mockResolvedValueOnce({
      id: 'rm-linked',
      owner_id: 'u-1',
      project_id: 'project-0',
    });

    await expect(
      service.update('rm-linked', { project_id: 'project-1' }, 'u-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(roadmapAuthz.assertProjectRoadmapPermission).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('leaves plain field edits on a standalone roadmap untouched', async () => {
    repo.findById.mockResolvedValueOnce({
      id: 'rm-solo',
      owner_id: 'u-1',
      project_id: null,
    });
    repo.update.mockResolvedValueOnce({ id: 'rm-solo', name: 'Renamed' });

    await service.update('rm-solo', { name: 'Renamed' }, 'u-1');

    expect(roadmapAuthz.assertProjectRoadmapPermission).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith('rm-solo', { name: 'Renamed' });
  });
});
