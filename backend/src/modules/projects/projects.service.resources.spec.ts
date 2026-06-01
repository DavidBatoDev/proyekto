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
  const dataCache = {
    getAuthTtlSeconds: jest.fn().mockReturnValue(45),
    rememberJson: jest.fn(async (_key: string, _ttl: number, loader: any) =>
      loader(),
    ),
  };
  const cacheInvalidation = {
    invalidateAllDashboardCache: jest.fn().mockResolvedValue(undefined),
  };

  // Default authorization: no role grants. Override per-test where the
  // legacy "client/consultant bypass" path is being exercised.
  const defaultAuthorization = {
    getUserProjectRole: jest.fn().mockResolvedValue(null),
    assertRole: jest.fn(),
    roleSatisfies: jest.fn(),
    grant: jest.fn(),
    revoke: jest.fn(),
  };

  const buildService = (
    repoOverrides: Partial<ProjectsRepository>,
    authorizationOverrides: Partial<typeof defaultAuthorization> = {},
  ) => {
    const repo = repoOverrides as ProjectsRepository;
    const authorization = {
      ...defaultAuthorization,
      ...authorizationOverrides,
    };
    const projectTeams = {
      attach: jest.fn(),
      detach: jest.fn(),
      list: jest.fn(),
    } as any;
    const accessSync = {
      syncUser: jest.fn().mockResolvedValue(null),
      setUserRole: jest.fn().mockResolvedValue(null),
      setUserCapabilities: jest.fn().mockResolvedValue(undefined),
      setUserCapabilitiesByMemberId: jest.fn().mockResolvedValue(null),
    } as any;
    return new ProjectsService(
      repo,
      notificationsService as any,
      authorization as any,
      projectTeams,
      accessSync,
      { from: jest.fn() } as any,
      dataCache as any,
      cacheInvalidation as any,
      { get: jest.fn() } as any,
    );
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

  it('allows project leads (owner role) to list resources', async () => {
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
    // Post-refactor: a project lead is anyone with owner/admin role on
    // project_shares. Stub returns 'owner' for this caller.
    const service = buildService(repo, {
      getUserProjectRole: jest.fn().mockResolvedValue('owner'),
    });

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
        title: 'Proyekto',
        url: 'https://example.com',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

