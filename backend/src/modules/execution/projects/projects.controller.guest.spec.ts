import { ForbiddenException } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import type { CreateProjectDto } from './dto/project.dto';

/**
 * `POST /api/projects` is the door the AI agent's `create_project` tool uses
 * as the user. Guests (X-Guest-User-Id sessions) must be turned away here,
 * exactly like `POST /api/projects/from-roadmap` already does.
 */
describe('ProjectsController guest gate on create', () => {
  const dto: CreateProjectDto = { title: 'Launch site' };
  const created = {
    project: { id: 'p-1' },
    roadmap: { id: 'r-1', name: 'Launch site' },
  };

  function build() {
    const projectsService = {
      createProject: jest.fn().mockResolvedValue(created),
    };
    const dataCache = { isDebugHeadersEnabled: () => false };
    const controller = new ProjectsController(
      projectsService as never,
      dataCache as never,
    );
    return { controller, projectsService };
  }

  it('rejects a guest before touching the service', () => {
    const { controller, projectsService } = build();
    const guest: AuthenticatedUser = { id: 'guest-1', is_guest: true };
    expect(() => controller.createProject(guest, dto)).toThrow(
      ForbiddenException,
    );
    expect(projectsService.createProject).not.toHaveBeenCalled();
  });

  it('forwards a signed-in user to the service', async () => {
    const { controller, projectsService } = build();
    const user: AuthenticatedUser = { id: 'user-1' };
    await expect(controller.createProject(user, dto)).resolves.toEqual(created);
    expect(projectsService.createProject).toHaveBeenCalledWith('user-1', dto);
  });
});
