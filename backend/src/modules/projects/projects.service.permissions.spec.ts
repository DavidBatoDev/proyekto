import { ProjectsService } from './projects.service';
import type { ProjectsRepository } from './repositories/projects.repository.interface';
import type { Project } from '../../common/entities';
import { getTemplateByKey } from './permissions/project-permissions';

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

describe('ProjectsService (permissions)', () => {
  const notificationsService = {
    createNotification: jest.fn(),
  };

  const buildService = (repoOverrides: Partial<ProjectsRepository>) => {
    const repo = repoOverrides as ProjectsRepository;
    return new ProjectsService(repo, notificationsService as any);
  };

  it('uses member defaults with team-page view enabled', () => {
    const permissions = getTemplateByKey('member');

    expect(permissions.members.manage).toBe(false);
    expect(permissions.members.view).toBe(true);
  });

  it('hydrates and persists member defaults when member permissions are empty', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject()),
      getMemberByProjectAndUserId: jest.fn().mockResolvedValue({
        id: 'member-row-1',
        user_id: 'member-1',
        role: 'member',
        permissions_json: null,
      }),
      updateMemberPermissions: jest.fn().mockResolvedValue({}),
    };
    const service = buildService(repo);

    const result = await service.getMyPermissions('project-1', 'member-1');

    expect(result.members.manage).toBe(false);
    expect(result.members.view).toBe(true);
    expect(repo.updateMemberPermissions).toHaveBeenCalledWith(
      'project-1',
      'member-row-1',
      expect.objectContaining({
        members: expect.objectContaining({
          manage: false,
          view: true,
        }),
      }),
    );
  });
});
