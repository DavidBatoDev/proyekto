import { ForbiddenException, NotFoundException } from '@nestjs/common';
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

describe('ProjectsService (resources)', () => {
  const notificationsService = {
    createNotification: jest.fn(),
  };

  const buildService = (repoOverrides: Partial<ProjectsRepository>) => {
    const repo = repoOverrides as ProjectsRepository;
    return new ProjectsService(repo, notificationsService as any);
  };

  it('denies resource access for non-participants', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject()),
      getMemberByProjectAndUserId: jest.fn().mockResolvedValue(null),
    };
    const service = buildService(repo);

    await expect(
      service.listProjectResources('project-1', 'outsider-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows project leads to list resources', async () => {
    const payload = {
      folders: [],
      uncategorized_links: [],
    };
    const repo = {
      findById: jest
        .fn()
        .mockResolvedValue(buildProject({ client_id: 'lead-1' })),
      getMemberByProjectAndUserId: jest.fn().mockResolvedValue(null),
      listProjectResources: jest.fn().mockResolvedValue(payload),
    };
    const service = buildService(repo);

    await expect(
      service.listProjectResources('project-1', 'lead-1'),
    ).resolves.toBe(payload);
    expect(repo.listProjectResources).toHaveBeenCalledWith('project-1');
  });

  it('allows members to create folders', async () => {
    const createdFolder = {
      id: 'folder-1',
      project_id: 'project-1',
      name: 'Research',
      position: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject()),
      getMemberByProjectAndUserId: jest.fn().mockResolvedValue({
        id: 'member-row-1',
        user_id: 'member-1',
        role: 'member',
      }),
      createProjectResourceFolder: jest.fn().mockResolvedValue(createdFolder),
    };
    const service = buildService(repo);

    await expect(
      service.createProjectResourceFolder('project-1', 'member-1', {
        name: 'Research',
      }),
    ).resolves.toEqual({
      ...createdFolder,
      links: [],
    });
  });

  it('throws not found when project is missing', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(null),
      getMemberByProjectAndUserId: jest.fn(),
    };
    const service = buildService(repo);

    await expect(
      service.createProjectResourceLink('project-404', 'member-1', {
        title: 'Prdigy',
        url: 'https://example.com',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
