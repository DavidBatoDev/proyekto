import { NotFoundException } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import {
  PROJECT_ROLES,
  type ProjectRole,
} from './authorization/project-authorization.service';

/**
 * `GET /api/projects/:id` reads through the service-role client, so RLS never
 * runs: the service is the only thing between a signed-in caller and a
 * project's row plus every member's profile (email included).
 *
 * The rule is the one the rest of the codebase applies to project reads — a
 * `project_access` row at any rung of the ladder — and a caller without one is
 * told the project does not exist, never that it is forbidden. After the
 * access check the roster mask applies (L22, D57): a placed talent worker
 * reads "Delivery team member" to a viewer who is not a provider-side party.
 *
 * Ported from the `fix/project-get-access` hotfix (55280c0f, D78) onto PR-1's
 * constructor, where the time slot is `TimeProjectsFacade`.
 */
const PROJECT_ID = '0b6f1d2e-3c4a-4b5d-8e6f-7a8b9c0d1e2f';
const MISSING_ID = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';

function buildHarness(role: ProjectRole | null) {
  const project = {
    id: PROJECT_ID,
    title: 'Launch site',
    owner_id: 'owner-1',
    owner: { id: 'owner-1', display_name: 'Owner', email: 'o@example.com' },
    members: [
      {
        id: 'access-1',
        project_id: PROJECT_ID,
        user_id: 'owner-1',
        role: 'owner',
        user: { id: 'owner-1', email: 'o@example.com' },
      },
    ],
  };
  const projectsRepo = {
    findById: jest.fn().mockResolvedValue(project),
  };
  const authorization = {
    getUserProjectRole: jest.fn().mockResolvedValue(role),
  };
  const time = {
    maskedWorkerIds: jest.fn().mockResolvedValue(new Set<string>()),
  };

  const service = new ProjectsService(
    projectsRepo as never,
    {} as never,
    authorization as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    time as never,
    {} as never,
  );

  return { service, projectsRepo, authorization, time, project };
}

describe('ProjectsService.getProject (view access)', () => {
  it.each(PROJECT_ROLES.map((role) => [role]))(
    'returns the project unchanged to a caller holding %s access',
    async (role) => {
      const { service, projectsRepo, authorization, time, project } =
        buildHarness(role);

      await expect(service.getProject(PROJECT_ID, 'user-1')).resolves.toBe(
        project,
      );
      expect(authorization.getUserProjectRole).toHaveBeenCalledWith(
        'user-1',
        PROJECT_ID,
      );
      expect(projectsRepo.findById).toHaveBeenCalledWith(PROJECT_ID);
      expect(time.maskedWorkerIds).toHaveBeenCalledWith(PROJECT_ID, 'user-1');
    },
  );

  it('404s a signed-in caller with no access, without reading the row', async () => {
    const { service, projectsRepo, time } = buildHarness(null);

    const attempt = service.getProject(PROJECT_ID, 'outsider-1');
    await expect(attempt).rejects.toBeInstanceOf(NotFoundException);
    await expect(attempt).rejects.toThrow('Project not found');
    expect(projectsRepo.findById).not.toHaveBeenCalled();
    expect(time.maskedWorkerIds).not.toHaveBeenCalled();
  });

  it('gives a member the same 404 for an id that does not exist', async () => {
    const { service, projectsRepo, time } = buildHarness('editor');
    projectsRepo.findById.mockResolvedValue(null);

    await expect(service.getProject(MISSING_ID, 'user-1')).rejects.toThrow(
      new NotFoundException('Project not found'),
    );
    expect(time.maskedWorkerIds).not.toHaveBeenCalled();
  });

  it.each([['abc'], ['project-1'], [''], [`${PROJECT_ID}x`]])(
    '404s a malformed id %p before any query runs (no 22P02 500)',
    async (id) => {
      const { service, projectsRepo, authorization, time } =
        buildHarness('owner');

      await expect(service.getProject(id, 'user-1')).rejects.toThrow(
        new NotFoundException('Project not found'),
      );
      expect(authorization.getUserProjectRole).not.toHaveBeenCalled();
      expect(projectsRepo.findById).not.toHaveBeenCalled();
      expect(time.maskedWorkerIds).not.toHaveBeenCalled();
    },
  );

  it('fails closed when the access lookup itself fails', async () => {
    const { service, projectsRepo, authorization } = buildHarness('owner');
    authorization.getUserProjectRole.mockRejectedValue(new Error('db down'));

    await expect(service.getProject(PROJECT_ID, 'user-1')).rejects.toThrow(
      'db down',
    );
    expect(projectsRepo.findById).not.toHaveBeenCalled();
  });

  it('masks the roster for an allowed viewer only after the access check', async () => {
    const { service, project, time } = buildHarness('viewer');
    time.maskedWorkerIds.mockResolvedValue(new Set(['owner-1']));

    const result = (await service.getProject(PROJECT_ID, 'client-1')) as {
      members: Array<Record<string, any>>;
    };

    expect(result).not.toBe(project);
    expect(result.members[0].user_id).toBe('masked:access-1');
    expect(result.members[0].user).toEqual({
      id: 'masked:access-1',
      email: null,
      display_name: 'Delivery team member',
      avatar_url: null,
    });
  });
});

describe('ProjectsController.getProject', () => {
  function build() {
    const projectsService = {
      getProject: jest.fn().mockResolvedValue({ id: 'project-1' }),
    };
    const dataCache = { isDebugHeadersEnabled: () => false };
    const controller = new ProjectsController(
      projectsService as never,
      dataCache as never,
    );
    return { controller, projectsService };
  }

  it('checks access as the signed-in caller', async () => {
    const { controller, projectsService } = build();
    const user: AuthenticatedUser = { id: 'user-1' };

    await expect(controller.getProject('project-1', user)).resolves.toEqual({
      id: 'project-1',
    });
    expect(projectsService.getProject).toHaveBeenCalledWith(
      'project-1',
      'user-1',
    );
  });

  it('checks a guest session against its own profile, like other project reads', async () => {
    const { controller, projectsService } = build();
    const guest: AuthenticatedUser = { id: 'guest-1', is_guest: true };

    await controller.getProject('project-1', guest);
    expect(projectsService.getProject).toHaveBeenCalledWith(
      'project-1',
      'guest-1',
    );
  });
});
