import { BadRequestException, ForbiddenException } from '@nestjs/common';
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

  beforeEach(() => {
    jest.clearAllMocks();
  });

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

  it('rejects permission updates when caller is project client', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject()),
      getMemberByProjectAndUserId: jest.fn().mockResolvedValue({
        id: 'client-row-1',
        user_id: 'client-1',
        role: 'client',
        permissions_json: getTemplateByKey('client'),
      }),
      getMemberById: jest.fn().mockResolvedValue({
        id: 'member-row-1',
        user_id: 'member-1',
        role: 'member',
      }),
      updateMemberPermissions: jest.fn().mockResolvedValue({}),
    };
    const service = buildService(repo);

    await expect(
      service.updateMemberPermissions('project-1', 'member-row-1', 'client-1', {
        roadmap: {
          edit: true,
          view_internal: false,
          comment: true,
          promote: false,
        },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.updateMemberPermissions).not.toHaveBeenCalled();
  });

  it('allows permission updates when caller is project consultant', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject()),
      getMemberByProjectAndUserId: jest.fn().mockResolvedValue({
        id: 'consultant-row-1',
        user_id: 'consultant-1',
        role: 'consultant',
        permissions_json: getTemplateByKey('consultant'),
      }),
      getMemberById: jest.fn().mockResolvedValue({
        id: 'member-row-1',
        user_id: 'member-1',
        role: 'member',
      }),
      updateMemberPermissions: jest.fn().mockResolvedValue({ ok: true }),
    };
    const service = buildService(repo);

    await expect(
      service.updateMemberPermissions(
        'project-1',
        'member-row-1',
        'consultant-1',
        {
          roadmap: {
            edit: true,
            view_internal: true,
            comment: true,
            promote: true,
          },
        },
      ),
    ).resolves.toEqual({ ok: true });
    expect(repo.updateMemberPermissions).toHaveBeenCalled();
  });

  it('sends consultant notification when client invites a freelancer', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject()),
      getMemberByProjectAndUserId: jest.fn().mockResolvedValue(null),
      inviteByEmail: jest.fn().mockResolvedValue({
        id: 'invite-1',
        invitee_id: null,
        invited_position: 'Backend Developer',
      }),
      getProfileDisplayName: jest.fn().mockResolvedValue('Client Owner'),
    };
    const service = buildService(repo);

    await service.inviteByEmail('project-1', 'client-1', {
      email: 'freelancer@example.com',
      position: 'Backend Developer',
    });

    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'consultant-1',
        type_name: 'project_updated',
        actor_id: 'client-1',
      }),
    );
  });

  it('unassigns tasks then removes member when client removes freelancer', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject()),
      getMemberByProjectAndUserId: jest.fn().mockResolvedValue(null),
      getMemberById: jest.fn().mockResolvedValue({
        id: 'member-row-1',
        user_id: 'member-1',
        role: 'member',
      }),
      unassignTasksForMemberInProject: jest.fn().mockResolvedValue(3),
      removeMember: jest.fn().mockResolvedValue(undefined),
      getProfileDisplayName: jest.fn().mockResolvedValue('Freelancer One'),
    };
    const service = buildService(repo);

    await service.removeMember('project-1', 'member-row-1', 'client-1');

    expect(repo.unassignTasksForMemberInProject).toHaveBeenCalledWith(
      'project-1',
      'member-1',
    );
    expect(repo.removeMember).toHaveBeenCalledWith('project-1', 'member-row-1');
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'consultant-1',
        type_name: 'project_updated',
        actor_id: 'client-1',
      }),
    );
  });

  it('rejects consultant reassignment when caller is not project owner or consultant', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject({ client_id: 'owner-1' })),
    };
    const service = buildService(repo);

    await expect(
      service.reassignProjectConsultant('project-1', 'not-owner', {
        new_consultant_id: 'member-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows consultant to reassign consultant', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(
        buildProject({ client_id: 'owner-1', consultant_id: 'consultant-1' }),
      ),
      getMemberByProjectAndUserId: jest.fn().mockResolvedValue({
        id: 'member-row-2',
        user_id: 'member-2',
        role: 'member',
      }),
      isConsultantVerified: jest.fn().mockResolvedValue(true),
      reassignConsultant: jest.fn().mockResolvedValue(
        buildProject({ consultant_id: 'member-2' }),
      ),
    };
    const service = buildService(repo);

    await expect(
      service.reassignProjectConsultant('project-1', 'consultant-1', {
        new_consultant_id: 'member-2',
      }),
    ).resolves.toBeTruthy();
  });

  it('rejects consultant reassignment when target is not a project member', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject()),
      getMemberByProjectAndUserId: jest.fn().mockResolvedValue(null),
    };
    const service = buildService(repo);

    await expect(
      service.reassignProjectConsultant('project-1', 'client-1', {
        new_consultant_id: 'outsider-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects consultant reassignment when target is not consultant-verified', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject()),
      getMemberByProjectAndUserId: jest.fn().mockResolvedValue({
        id: 'member-row-1',
        user_id: 'member-2',
        role: 'member',
      }),
      isConsultantVerified: jest.fn().mockResolvedValue(false),
    };
    const service = buildService(repo);

    await expect(
      service.reassignProjectConsultant('project-1', 'client-1', {
        new_consultant_id: 'member-2',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects consultant reassignment when selected member is already consultant', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject({ consultant_id: 'consultant-1' })),
    };
    const service = buildService(repo);

    await expect(
      service.reassignProjectConsultant('project-1', 'client-1', {
        new_consultant_id: 'consultant-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reassigns consultant when owner selects a verified project member', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject({ consultant_id: 'consultant-1' })),
      getMemberByProjectAndUserId: jest.fn().mockResolvedValue({
        id: 'member-row-2',
        user_id: 'member-2',
        role: 'member',
      }),
      isConsultantVerified: jest.fn().mockResolvedValue(true),
      reassignConsultant: jest.fn().mockResolvedValue(
        buildProject({ consultant_id: 'member-2' }),
      ),
    };
    const service = buildService(repo);

    const updated = await service.reassignProjectConsultant('project-1', 'client-1', {
      new_consultant_id: 'member-2',
    });

    expect(updated.consultant_id).toBe('member-2');
    expect(repo.reassignConsultant).toHaveBeenCalledWith(
      'project-1',
      'client-1',
      'consultant-1',
      'member-2',
    );
  });
});
