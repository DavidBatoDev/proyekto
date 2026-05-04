import { BadRequestException, ForbiddenException } from '@nestjs/common';
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

describe('ProjectsService (permissions)', () => {
  const notificationsService = {
    createNotification: jest.fn(),
  };

  // Default authorization stub: caller has no project_shares grant. Tests
  // that exercise the role-based bypass should override `getUserProjectRole`.
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
    return new ProjectsService(
      repo,
      notificationsService as any,
      authorization as any,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Tech-debt cleanup: legacy member-template behavior is gone. The
  // synthesized-permissions test below covers the equivalent behavior
  // (an editor sees view=true, manage=false on members).

  it('synthesizes role-derived permissions from project_shares for getMyPermissions', async () => {
    // Tech-debt cleanup: legacy permissions_json hydration is gone.
    // getMyPermissions now derives a permissions object from project_shares
    // role. An editor sees view=true, manage=false on members.
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject()),
    };
    const service = buildService(repo, {
      getUserProjectRole: jest.fn().mockResolvedValue('editor'),
    });

    const result = await service.getMyPermissions('project-1', 'member-1');

    expect(result.members.manage).toBe(false);
    expect(result.members.view).toBe(true);
  });

  it('rejects permission updates when caller has no admin+ role', async () => {
    // Tech-debt cleanup: gate is now role-based via assertCanManageMembers
    // → assertRole('admin'). An editor (or lower) gets ForbiddenException.
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject()),
    };
    const service = buildService(repo, {
      getUserProjectRole: jest.fn().mockResolvedValue('editor'),
      assertRole: jest
        .fn()
        .mockRejectedValue(new ForbiddenException('Insufficient role')),
    });

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
  });

  it('allows permission updates when caller has admin+ role', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject({ consultant_id: undefined })),
      getMemberById: jest.fn().mockResolvedValue({
        id: 'member-row-1',
        user_id: 'member-1',
        role: 'editor',
      }),
      updateMemberPermissions: jest.fn().mockResolvedValue({ ok: true }),
    };
    const service = buildService(repo, {
      getUserProjectRole: jest.fn().mockResolvedValue('owner'),
    });

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

  it('sends consultant notification when client (admin role) invites a freelancer', async () => {
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
    // Post-refactor: client has admin role on the project (granted at
    // project create time). The role bypass replaces the legacy client_id
    // === userId check.
    const service = buildService(repo, {
      getUserProjectRole: jest.fn().mockResolvedValue('admin'),
    });

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

  it('unassigns tasks then removes member when client (admin role) removes freelancer', async () => {
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
    const service = buildService(repo, {
      getUserProjectRole: jest.fn().mockResolvedValue('admin'),
    });

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

  // Post-refactor: privileged callers hold owner/admin role on project_shares.
  // Each reassign test below grants the caller `owner` so the role bypass
  // fires inside ProjectsService.isProjectPrivileged, then asserts the
  // downstream behavior. The auto-grant/revoke calls during reassignment are
  // stubbed via the default `grant`/`revoke` mocks.
  const ownerAuth = () => ({
    getUserProjectRole: jest.fn().mockResolvedValue('owner'),
  });

  it('allows consultant (owner role) to reassign consultant', async () => {
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
    const service = buildService(repo, ownerAuth());

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
    const service = buildService(repo, ownerAuth());

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
    const service = buildService(repo, ownerAuth());

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
    const service = buildService(repo, ownerAuth());

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
    const service = buildService(repo, ownerAuth());

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
