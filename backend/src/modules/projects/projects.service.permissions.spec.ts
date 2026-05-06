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
    assertPermission: jest.fn(),
    resolvePermissions: jest.fn(),
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

  it('resolves role+origin+capabilities permissions for getMyPermissions', async () => {
    // getMyPermissions now resolves the share row through the layered
    // resolver. An editor with no capability overrides sees view=true,
    // manage=false on members.
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject()),
      getMemberByProjectAndUserId: jest.fn().mockResolvedValue({
        id: 'member-row-1',
        user_id: 'member-1',
        role: 'editor',
        origin: 'invited',
        position: null,
        capabilities: {},
      }),
    };
    const service = buildService(repo);

    const result = await service.getMyPermissions('project-1', 'member-1');

    expect(result.members.manage).toBe(false);
    expect(result.members.view).toBe(true);
    expect(result.roadmap.edit).toBe(true);
  });

  it('layers consultant origin delta on top of role baseline', async () => {
    // Same editor role but consultant origin → manage_rates and
    // message_freelancers flip on via origin delta.
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject()),
      getMemberByProjectAndUserId: jest.fn().mockResolvedValue({
        id: 'member-row-1',
        user_id: 'member-1',
        role: 'editor',
        origin: 'consultant',
        position: 'Lead',
        capabilities: {},
      }),
    };
    const service = buildService(repo);

    const result = await service.getMyPermissions('project-1', 'member-1');

    expect(result.chat.message_freelancers).toBe(true);
    expect(result.members.manage).toBe(true);
  });

  it('applies capabilities overrides on top of (role, origin) baseline', async () => {
    // Viewer with explicit overrides: roadmap.view + roadmap.edit + access.roadmap
    // all true → resolved permissions show roadmap.edit true.
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject()),
      getMemberByProjectAndUserId: jest.fn().mockResolvedValue({
        id: 'member-row-1',
        user_id: 'member-1',
        role: 'viewer',
        origin: 'invited',
        position: null,
        capabilities: {
          'roadmap.edit': true,
        },
      }),
    };
    const service = buildService(repo);

    const result = await service.getMyPermissions('project-1', 'member-1');

    expect(result.roadmap.edit).toBe(true);
    // Roadmap.view is still true from the viewer baseline (deps satisfied).
    expect(result.roadmap.view).toBe(true);
  });

  it('rejects permission updates when caller lacks members.edit_permissions', async () => {
    // The capability gate is members.edit_permissions, default-granted at
    // admin+. An editor (or lower) without the override gets a Forbidden.
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject()),
    };
    const service = buildService(repo, {
      assertPermission: jest
        .fn()
        .mockRejectedValue(new ForbiddenException('Missing required permission')),
    });

    await expect(
      service.updateMemberPermissions('project-1', 'member-row-1', 'client-1', {
        roadmap: {
          edit: true,
          comment: true,
        },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows permission updates when caller has members.edit_permissions', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject({ consultant_id: undefined })),
      getMemberById: jest.fn().mockResolvedValue({
        id: 'member-row-1',
        user_id: 'member-1',
        role: 'editor',
        origin: 'invited',
        position: null,
        capabilities: {},
      }),
      updateMemberCapabilities: jest.fn().mockResolvedValue({ ok: true }),
    };
    const service = buildService(repo, {
      assertPermission: jest.fn().mockResolvedValue({}),
    });

    await expect(
      service.updateMemberPermissions(
        'project-1',
        'member-row-1',
        'consultant-1',
        {
          roadmap: {
            view: true,
            edit: true,
            comment: true,
            promote: true,
          },
          access: { roadmap: true },
        },
      ),
    ).resolves.toEqual({ ok: true });
    expect(repo.updateMemberCapabilities).toHaveBeenCalled();
  });

  it('rejects permission updates that violate dependencies', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject()),
      getMemberById: jest.fn().mockResolvedValue({
        id: 'member-row-1',
        user_id: 'member-1',
        role: 'viewer',
        origin: 'invited',
        position: null,
        capabilities: {},
      }),
      updateMemberCapabilities: jest.fn(),
    };
    const service = buildService(repo, {
      assertPermission: jest.fn().mockResolvedValue({}),
    });

    // Trying to grant roadmap.edit while turning off roadmap.view (and
    // access.roadmap) should fail dependency validation.
    await expect(
      service.updateMemberPermissions(
        'project-1',
        'member-row-1',
        'consultant-1',
        {
          access: { roadmap: false },
          roadmap: { view: false, edit: true },
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.updateMemberCapabilities).not.toHaveBeenCalled();
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
